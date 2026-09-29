"""Un appel de Mina sur la ligne Bluetooth, de la composition au bilan de fin.

Ce que l'appel doit faire savoir au reste du produit passe par des `Rappels` : l'application web pour le
service, des bouchons pour la commande de diagnostic.
"""
import os
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from elevenlabs.client import ElevenLabs
from elevenlabs.conversational_ai.conversation import ClientTools, Conversation, ConversationInitiationData
from gi.repository import GLib

from .audio import Pont, temps_de_reponse
from .ofono import Telephone, dans_glib

SILENCE_AU_DECROCHE_S = 2.0  # sans voix du prospect passé ce délai, l'assistante ouvre par son premier message
PREMIER_MESSAGE_PAR_DEFAUT = "Allô ?"
PREMIER_MESSAGE_MAX = 300  # au-delà, ce n'est plus une phrase d'ouverture : on reprend « Allô ? »
# Le canal son s'ouvre entre 0,5 s (réseau mobile) et 3,5 s (appels Wi-Fi) après la composition : on ne conclut à
# une panne qu'après 10 s, ou 3 s après le décroché (constat du 28/09).
DELAI_CANAL_SON_S = 10.0
DELAI_CANAL_APRES_DECROCHE_S = 3.0
DUREE_MAX_S = 6 * 60  # au-delà du plafond de l'agent (300 s) : filet si la fin de session se perd
DUREE_MAX_OPERATEUR_S = 60 * 60  # après une prise de main, l'opérateur parle aussi longtemps qu'il veut


def premier_message_valide(valeur: Any) -> str:
    """La phrase dite quand le prospect se tait au décroché, telle que l'application l'envoie (déjà composée).

    Absente, vide, trop longue ou d'un autre type : « Allô ? ». Une application plus ancienne ne l'envoie pas.
    """
    if not isinstance(valeur, str):
        return PREMIER_MESSAGE_PAR_DEFAUT
    texte = " ".join(valeur.split())
    if not texte or len(texte) > PREMIER_MESSAGE_MAX:
        return PREMIER_MESSAGE_PAR_DEFAUT
    return texte


class Rappels(Protocol):
    def conversation_ouverte(self, conversation_id: str) -> None: ...
    def outil(self, nom: str, parametres: dict[str, Any]) -> str: ...
    def evenement(self, type_: str, donnees: dict[str, Any]) -> None: ...
    def fin(self, bilan: dict[str, Any]) -> None: ...


class Journal:
    def __init__(self, fichier: Path | None = None):
        self._fichier = fichier.open("a", encoding="utf-8") if fichier else None
        self.t0 = time.monotonic()

    def __call__(self, *morceaux) -> None:
        ligne = f"{time.strftime('%H:%M:%S')} +{time.monotonic() - self.t0:6.2f}s " + " ".join(map(str, morceaux))
        print(ligne, flush=True)
        if self._fichier:
            self._fichier.write(ligne + "\n")
            self._fichier.flush()


class ConversationPont(Conversation):
    """Récupère l'URL signée pendant la sonnerie, et lit les formats audio que le SDK ignore."""

    def __init__(self, *args, pont: Pont, journal: Journal, ouverte: Callable[[str], None], **kwargs):
        super().__init__(*args, **kwargs)
        self._pont = pont
        self._journal = journal
        self._ouverte = ouverte
        self._url: str | None = None
        self._url_prete = threading.Event()

    def precharger_url(self) -> None:
        def _charger():
            try:
                self._url = super(ConversationPont, self)._get_signed_url()
            except Exception as e:  # la session la redemandera
                self._journal("URL signée indisponible :", e)
            self._url_prete.set()

        threading.Thread(target=_charger, daemon=True).start()

    def _get_signed_url(self):
        self._url_prete.wait(timeout=10)
        url, self._url = self._url, None  # une URL signée ne sert qu'une fois
        return url or super()._get_signed_url()

    def _handle_message(self, message, ws):
        if message.get("type") == "conversation_initiation_metadata":
            ev = message["conversation_initiation_metadata_event"]
            entree, sortie = ev.get("user_input_audio_format"), ev.get("agent_output_audio_format")
            self._journal("conversation ouverte | entrée", entree, "| sortie", sortie)
            self._pont.regler_formats(entree, sortie)
            threading.Thread(target=self._ouverte, args=(ev.get("conversation_id"),), daemon=True).start()
        super()._handle_message(message, ws)


class Appel:
    def __init__(
        self,
        telephone: Telephone,
        numero: str,
        variables: dict[str, str],
        mots_cles: list[str],
        cles: dict[str, str],
        dossier: Path,
        nom: str,
        rappels: Rappels,
        premier_message: str = PREMIER_MESSAGE_PAR_DEFAUT,
    ):
        self._telephone = telephone
        self._numero = numero
        self._premier_message = premier_message_valide(premier_message)
        self._rappels = rappels
        dossier.mkdir(parents=True, exist_ok=True)
        self.journal = Journal(dossier / f"{nom}.log")
        self._enregistrement = str(dossier / f"{nom}.wav")
        self._pont = Pont(self._enregistrement, self.journal)
        self._verrou = threading.Lock()
        self._decroche: float | None = None
        self._session = False  # décroché : la conversation va s'ouvrir (ou l'opérateur a pris la main avant)
        self._session_ouverte = False  # start_session a vraiment été appelé
        self._fin_session = False
        self._prise_en_main: float | None = None
        self._en_ligne = False
        self._canal = False
        self._relance = False
        self._canal_absent = False  # abandon après reconnexion : l'appel finira en échec explicite
        self._tentatives = 0
        self._termine = threading.Event()
        self._pings: list[int] = []
        self._codec: int | None = None
        # Fil de l'appel pour la page en direct : états du téléphone et tours de parole, rejoués à qui arrive tard.
        self.evenements: list[dict[str, Any]] = []
        self._nouveau = threading.Condition()

        outils = ClientTools()
        for nom_outil in ("proposer_creneaux", "reserver_creneau"):
            outils.register(nom_outil, self._outil(nom_outil))
        self._conversation = ConversationPont(
            ElevenLabs(api_key=cles["ELEVENLABS_API_KEY"]),
            cles["ELEVENLABS_AGENT_ID"],
            requires_auth=True,
            audio_interface=self._pont,
            config=ConversationInitiationData(
                dynamic_variables=variables,
                conversation_config_override={"asr": {"keywords": mots_cles}},
            ),
            client_tools=outils,
            callback_agent_response=lambda t: self._tour("agent", t),
            callback_user_transcript=lambda t: self._tour("prospect", t),
            callback_latency_measurement=self._pings.append,
            callback_end_session=self._fin_de_session,
            pont=self._pont,
            journal=self.journal,
            ouverte=rappels.conversation_ouverte,
        )

    # --- suivi en direct -------------------------------------------------------------------------

    def _evenement(self, type_: str, donnees: dict[str, Any]) -> None:
        # `t` : heure du pont (ms depuis l'epoch) ; l'historique rejoué à la connexion garde ainsi ses vraies heures.
        with self._nouveau:
            self.evenements.append({"type": type_, **donnees, "t": int(time.time() * 1000)})
            self._nouveau.notify_all()
        self._rappels.evenement(type_, donnees)

    def suivre(self, depuis: int, delai: float = 15) -> list[dict[str, Any]]:
        """Les événements à partir de l'indice `depuis`, en attendant qu'il y en ait (jusqu'à `delai`)."""
        with self._nouveau:
            self._nouveau.wait_for(lambda: len(self.evenements) > depuis or self._termine.is_set(), delai)
            return self.evenements[depuis:]

    def fini(self) -> bool:
        return self._termine.is_set()

    @property
    def pont(self) -> Pont:
        return self._pont

    # --- commandes -------------------------------------------------------------------------------

    def lancer(self) -> None:
        """Depuis le thread GLib."""
        self._tentatives += 1
        self.journal("composition du", self._numero[:4] + "…" + self._numero[-2:])
        self._telephone.composer(self._numero, self, self._composition_echouee)
        self._en_ligne = True
        self._conversation.precharger_url()
        self._evenement("etat", {"etat": "composition"})
        GLib.timeout_add(int(DELAI_CANAL_SON_S * 1000), self._verifier_canal)
        GLib.timeout_add_seconds(DUREE_MAX_S, self._duree_max)

    def prendre_la_main(self) -> None:
        """L'opérateur remplace Mina (ADR 0008) : la conversation ElevenLabs se ferme sans raccrocher."""
        if not self._en_ligne or self._decroche is None:
            raise ValueError("l'appel n'est pas décroché")
        with self._verrou:
            if self._prise_en_main is not None:
                return  # reconnexion de l'opérateur : il a déjà la main
            self._prise_en_main = time.monotonic()
            fermer = self._session_ouverte and not self._fin_session
        self._pont.prendre_la_main()
        GLib.timeout_add_seconds(DUREE_MAX_OPERATEUR_S, self._duree_max_operateur)
        self.journal("l'opérateur prend la main")
        self._evenement("etat", {"etat": "prise-en-main"})
        if fermer:
            self._conversation.end_session()  # hors du verrou : il rappelle _fin_de_session, qui le prend

    def _duree_max_operateur(self) -> bool:
        if self._en_ligne:
            self.journal("durée maximale atteinte après la prise de main")
            self._telephone.raccrocher()
        return False

    @property
    def main_prise(self) -> bool:
        return self._prise_en_main is not None

    def raccrocher(self) -> None:
        self.journal("raccrochage demandé")
        self._telephone.raccrocher()

    def attendre_fin(self, delai: float | None = None) -> bool:
        return self._termine.wait(delai)

    # --- signaux du téléphone ----------------------------------------------------------------------

    def nouvelle_connexion(self, fd: int, codec: int) -> None:
        self._canal = True
        self._codec = codec
        self._pont.brancher(fd, codec)

    def etat_change(self, etat: str) -> None:
        self.journal("appel :", etat)
        self._evenement("etat", {"etat": etat})
        if etat == "active" and not self._canal:
            GLib.timeout_add(int(DELAI_CANAL_APRES_DECROCHE_S * 1000), self._verifier_canal)
        if etat == "active" and not self._session:
            self._decroche = time.monotonic()
            self._session = True
            self._pont.decroche()
            threading.Thread(target=self._ouvrir_conversation, daemon=True).start()

    def termine(self, raison: str) -> None:
        self._en_ligne = False
        if self._relance:
            self._relance = False
            threading.Thread(target=self._reconnecter_et_relancer, daemon=True).start()
            return
        qui = {"remote": "le prospect", "local": "nous"}.get(raison, raison)
        self.journal("appel terminé, raccroché par :", qui)
        threading.Thread(target=self._terminer, args=(raison,), daemon=True).start()

    # --- déroulé ---------------------------------------------------------------------------------

    def _composition_echouee(self, raison: str) -> None:
        """Le téléphone a refusé la composition ou n'a pas répondu : liaison figée, le plus souvent. On le
        reconnecte et on recompose une fois, comme pour un canal son absent."""
        self._en_ligne = False
        self.journal("le téléphone n'a pas composé :", raison)
        if self._tentatives < 2:
            threading.Thread(target=self._reconnecter_et_relancer, daemon=True).start()
        else:
            self._canal_absent = False
            threading.Thread(target=self._terminer, args=("composition impossible",), daemon=True).start()

    def _verifier_canal(self) -> bool:
        if self._en_ligne and not self._canal and not self._relance and not self._canal_absent:
            if self._tentatives < 2:
                self.journal("canal son absent : on raccroche, on reconnecte le téléphone et on recompose")
                self._relance = True
            else:
                self.journal("canal son toujours absent : abandon")
                self._canal_absent = True
            self._telephone.raccrocher()
        return False

    def _reconnecter_et_relancer(self) -> None:
        self._evenement("etat", {"etat": "reconnexion"})
        try:
            self._telephone.reconnecter()
            # La liaison mains-libres met quelques secondes à revenir après la reconnexion.
            limite = time.monotonic() + 12
            while True:
                try:
                    dans_glib(self._telephone.modem)
                    break
                except RuntimeError:
                    if time.monotonic() > limite:
                        raise
                    time.sleep(1)
            dans_glib(self.lancer)
        except Exception as e:
            self.journal("relance impossible :", e)
            self._terminer("composition impossible")

    def _duree_max(self) -> bool:
        if self._en_ligne and self._prise_en_main is None:
            self.journal("durée maximale atteinte")
            self._telephone.raccrocher()
        return False

    def _ouvrir_conversation(self) -> None:
        # Le prospect parle d'habitude le premier : on attend sa voix pour ouvrir (son « allô » est gardé et
        # transmis). S'il se tait, c'est à l'assistante de parler, par le premier message de la conversation
        # (« Allô ? » par défaut, réglé dans l'application).
        if self._pont.prospect_parle.wait(SILENCE_AU_DECROCHE_S):
            self.journal("le prospect parle : ouverture de la conversation")
        else:
            self.journal(f"silence depuis {SILENCE_AU_DECROCHE_S:.0f} s : l'assistante ouvre par « {self._premier_message} »")
            self._conversation.config.conversation_config_override["agent"] = {"first_message": self._premier_message}
        with self._verrou:
            if self._prise_en_main is not None:
                return  # l'opérateur a pris la main avant que Mina ne parle
            self._session_ouverte = True
        self._conversation.start_session()

    def _tour(self, role: str, texte: str) -> None:
        self.journal("assistante :" if role == "agent" else "prospect :", texte)
        self._evenement("tour", {"role": role, "texte": texte})

    def _outil(self, nom: str) -> Callable[[dict[str, Any]], str]:
        def executer(parametres: dict[str, Any]) -> str:
            utiles = {k: v for k, v in parametres.items() if k != "tool_call_id"}
            self.journal("outil", nom, utiles)
            return self._rappels.outil(nom, utiles)

        return executer

    def _fin_de_session(self) -> None:
        # Mina a terminé (end_call ou plafond de durée) : laisser partir la fin de sa phrase, puis raccrocher.
        with self._verrou:
            if self._fin_session:  # le SDK peut signaler la fin deux fois
                return
            self._fin_session = True
        if not self._en_ligne or self._prise_en_main is not None:
            return  # fin voulue par la prise de main : l'appel continue avec l'opérateur

        def _raccrocher_apres_vidage():
            limite = time.monotonic() + 8
            while not self._pont.sortie_vide() and time.monotonic() < limite:
                time.sleep(0.05)
            time.sleep(0.4)
            self.journal("Mina a terminé : on raccroche")
            self._telephone.raccrocher()

        threading.Thread(target=_raccrocher_apres_vidage, daemon=True).start()

    def _terminer(self, raison: str) -> None:
        conversation_id = None
        if self._session_ouverte:
            if not self._fin_session:
                self._conversation.end_session()
            conversation_id = self._conversation.wait_for_session_end()
        self._pont.fermer()
        if self._canal_absent:
            raison = "canal son absent"
        bilan: dict[str, Any] = {
            "raison": {"remote": "prospect", "local": "pont"}.get(raison, raison),
            "conversationId": conversation_id,
            "codec": {1: "CVSD", 2: "mSBC"}.get(self._codec or 0),
        }
        if self._decroche and self._pont.premier_son_de_mina:
            bilan["decrocheVersPremierSonS"] = round(self._pont.premier_son_de_mina - self._decroche, 2)
        if self._prise_en_main is not None and self._decroche:
            bilan["priseEnMainApresS"] = round(self._prise_en_main - self._decroche, 1)
        if os.path.exists(self._enregistrement):
            bilan["enregistrement"] = self._enregistrement
            bilan["tempsDeReponseS"] = [round(x, 2) for x in temps_de_reponse(self._enregistrement)]
        if self._pings:
            bilan["pingMedianMs"] = sorted(self._pings)[len(self._pings) // 2]
        self.journal("bilan :", bilan)
        self._evenement("etat", {"etat": "termine"})
        try:
            self._rappels.fin(bilan)
        finally:
            with self._nouveau:
                self._termine.set()
                self._nouveau.notify_all()
