"""Téléphone passerelle vu par oFono : composer, suivre l'état de l'appel, raccrocher, recevoir le canal son,
repérer un appel entrant et y répondre.

Tout appel D-Bus se fait depuis le thread de la boucle GLib (dbus-python n'est pas thread-safe) :
les autres threads passent par `dans_glib`.
"""
import os
import threading
import time
from collections.abc import Callable
from typing import Any, Protocol

import dbus
import dbus.service
from gi.repository import GLib

CVSD, MSBC = 1, 2
CHEMIN_AGENT = "/autocalled/pont/audio"
# Le numéro de l'appelant (CLIP) peut suivre la première sonnerie : passé ce délai sans lui, l'appel sonne sans réponse.
DELAI_NUMERO_ENTRANT_MS = 2000
DELAI_REGLAGE_AUDIO_S = 2
DELAI_LECTURE_DBUS_S = 2


def masquer(numero: str) -> str:
    """Le numéro tel qu'il paraît au journal : ses quatre premiers et deux derniers caractères, rien d'un numéro court."""
    numero = str(numero or "")
    return numero[:4] + "…" + numero[-2:] if len(numero) >= 8 else "…"


def numero_masque(numero: str) -> bool:
    """oFono donne « withheld » pour un numéro masqué et une chaîne vide s'il ne l'a pas reçu."""
    return str(numero or "").strip().lower() in ("", "withheld")


class LigneOccupee(RuntimeError):
    """Le téléphone a déjà un appel, suivi par le pont ou entrant qui sonne : rien n'est composé."""


def dans_glib(fonction: Callable[[], Any], delai: float = 10) -> Any:
    """Exécute `fonction` dans le thread GLib et rend son résultat (ou relève son exception)."""
    fini = threading.Event()
    expire = threading.Event()
    resultat: dict[str, Any] = {}

    def _faire():
        if expire.is_set():
            return False
        try:
            resultat["valeur"] = fonction()
        except Exception as e:  # relevée dans le thread appelant
            resultat["erreur"] = e
        fini.set()
        return False

    GLib.idle_add(_faire)
    if not fini.wait(delai):
        expire.set()
        raise TimeoutError("la boucle D-Bus ne répond pas")
    if "erreur" in resultat:
        raise resultat["erreur"]
    return resultat.get("valeur")


class Suivi(Protocol):
    """Ce que le téléphone signale à l'appel en cours."""

    def etat_change(self, etat: str) -> None: ...
    def termine(self, raison: str) -> None: ...
    def nouvelle_connexion(self, fd: int, codec: int) -> None: ...


class AgentAudio(dbus.service.Object):
    """Reçoit d'oFono le descripteur du canal SCO de chaque appel."""

    def __init__(self, bus: dbus.SystemBus, nouvelle_connexion: Callable[[int, int], None]):
        super().__init__(bus, CHEMIN_AGENT)
        self._nouvelle_connexion = nouvelle_connexion

    @dbus.service.method("org.ofono.HandsfreeAudioAgent", in_signature="ohy", out_signature="")
    def NewConnection(self, card, fd, codec):
        self._nouvelle_connexion(fd.take(), int(codec))

    @dbus.service.method("org.ofono.HandsfreeAudioAgent", in_signature="", out_signature="")
    def Release(self):
        pass


class Telephone:
    """Le téléphone passerelle, un appel à la fois, sortant ou entrant. Un seul objet pour toute la vie du pont.

    Un appel entrant est repéré dès sa sonnerie : tant qu'il est là (qu'il sonne, ou que le pont l'ait pris), la
    ligne n'est pas libre. Arrivé ligne libre et numéro connu, il est annoncé à `sur_entrant(chemin, numero brut,
    génération)`, depuis le thread GLib ; la réponse vient par `repondre` (décrocher) ou `laisser_sonner`, avec la même
    génération : oFono réutilise le chemin d'un appel retiré, une décision tardive ne doit pas décrocher l'appelant
    suivant. Le pont ne raccroche jamais un entrant qu'il ne prend pas : Hangup le rejetterait, l'appelant tomberait sur
    la messagerie aussitôt.
    """

    # Valeurs par défaut au niveau de la classe : les tests construisent l'objet sans son constructeur.
    sur_entrant: Callable[[str, str, int], None] | None = None
    _entrant: str | None = None  # l'appel entrant présent sur le téléphone, du CallAdded au CallRemoved
    _entrant_generation = 0  # compte les entrants : distingue deux appels arrivés sur le même chemin
    _entrant_numero = ""  # LineIdentification brute, telle qu'oFono la donne
    _entrant_annonce = False
    _evaluation = False  # l'application décide : le canal son qui arrive est gardé, ni lu ni fermé
    _canal_en_attente: tuple[int, int] | None = None  # (fd, codec) gardé pendant la décision

    def __init__(self, bus: dbus.SystemBus, journal: Callable[..., None]):
        self._bus = bus
        self._journal = journal
        self._modem: str | None = None
        self._appel: str | None = None
        self._suivi: Suivi | None = None
        self._raison = "inconnue"
        self.sur_entrant = None
        bus.add_signal_receiver(
            self._propriete, "PropertyChanged", "org.ofono.VoiceCall", "org.ofono", path_keyword="chemin"
        )
        bus.add_signal_receiver(
            self._raison_fin, "DisconnectReason", "org.ofono.VoiceCall", "org.ofono", path_keyword="chemin"
        )
        bus.add_signal_receiver(self._retire, "CallRemoved", "org.ofono.VoiceCallManager", "org.ofono")
        bus.add_signal_receiver(self._ajoute, "CallAdded", "org.ofono.VoiceCallManager", "org.ofono")
        bus.add_signal_receiver(self._modem_retire, "ModemRemoved", "org.ofono.Manager", "org.ofono")

    # --- état ------------------------------------------------------------------------------------

    def modem(self) -> str:
        """Recalculé à chaque appel : le chemin change si le téléphone se reconnecte."""
        manager = dbus.Interface(self._bus.get_object("org.ofono", "/", introspect=False), "org.ofono.Manager")
        for chemin, proprietes in manager.GetModems(signature="", timeout=DELAI_LECTURE_DBUS_S):
            if proprietes.get("Type") == "hfp" and proprietes.get("Online"):
                return str(chemin)
        raise RuntimeError(
            "aucun téléphone passerelle en ligne : est-il connecté en Bluetooth ? (le pont le reconnecte "
            "pendant une dizaine de secondes après son démarrage)"
        )

    def etat(self) -> dict[str, Any]:
        """Pour l'application : le téléphone, son réseau, l'appel en cours. Depuis le thread GLib."""
        manager = dbus.Interface(self._bus.get_object("org.ofono", "/", introspect=False), "org.ofono.Manager")
        for chemin, p in manager.GetModems(signature="", timeout=DELAI_LECTURE_DBUS_S):
            if p.get("Type") != "hfp":
                continue
            interfaces = [str(i) for i in p.get("Interfaces", [])]
            etat: dict[str, Any] = {
                "connecte": bool(p.get("Online")),
                "nom": str(p.get("Name", "")),
                "adresse": str(chemin).rsplit("dev_", 1)[-1].replace("_", ":"),
                "appelEnCours": self._appel is not None or self._entrant is not None,
                "entrantEnCours": self.entrant_en_cours(),
            }
            objet = self._bus.get_object("org.ofono", chemin, introspect=False)
            if "org.ofono.NetworkRegistration" in interfaces:
                r = dbus.Interface(objet, "org.ofono.NetworkRegistration").GetProperties(signature="", timeout=DELAI_LECTURE_DBUS_S)
                etat.update(operateur=str(r.get("Name", "")), signal=int(r.get("Strength", 0)))
            if "org.ofono.Handsfree" in interfaces:
                h = dbus.Interface(objet, "org.ofono.Handsfree").GetProperties(signature="", timeout=DELAI_LECTURE_DBUS_S)
                etat["batterie"] = int(h.get("BatteryChargeLevel", 0)) * 20  # oFono : 0 à 5
            return etat
        return {
            "connecte": False,
            "appelEnCours": self._appel is not None or self._entrant is not None,
            "entrantEnCours": self.entrant_en_cours(),
        }

    def libre(self) -> bool:
        """Ni appel suivi ni appel entrant présent : le pont peut composer."""
        return self._suivi is None and self._entrant is None

    def en_appel(self) -> bool:
        """Un appel suivi par le pont (composé, ou entrant décroché)."""
        return self._suivi is not None

    def entrant_en_cours(self) -> bool:
        """Un appel entrant sonne sur le téléphone, ou le pont l'a pris."""
        return self._entrant is not None

    # --- commandes, depuis le thread GLib ----------------------------------------------------------

    def enregistrer_agent_audio(self) -> None:
        self._agent = AgentAudio(self._bus, self._nouvelle_connexion)
        audio = dbus.Interface(self._bus.get_object("org.ofono", "/", introspect=False), "org.ofono.HandsfreeAudioManager")
        # Le téléphone choisit le codec parmi ceux-ci ; la liste compte aussi à l'établissement de la liaison
        # mains-libres : un agent enregistré après coup n'obtient le mSBC que si la liaison l'avait déjà annoncé.
        audio.Register(CHEMIN_AGENT, dbus.Array([dbus.Byte(MSBC), dbus.Byte(CVSD)], signature="y"), signature="oay", timeout=DELAI_LECTURE_DBUS_S)

    def composer(self, numero: str, suivi: Suivi, echec: Callable[[str], None]) -> None:
        """Demande au téléphone de composer, sans attendre sa réponse : un téléphone dont la liaison s'est figée
        ne répond pas, et un appel D-Bus bloquant figeait tout le pont (29/09). `echec` est appelé si la demande
        est refusée ou reste sans réponse."""
        if self._suivi is not None:
            raise LigneOccupee("un appel est déjà en cours")
        if self._entrant is not None:
            raise LigneOccupee("un appel entrant sonne sur le téléphone")
        self._modem = self.modem()
        self._couper_traitement_du_telephone()
        self._suivi = suivi  # avant Dial : le canal son peut s'ouvrir aussitôt
        self._appel = None
        self._raison = "inconnue"
        gestionnaire = dbus.Interface(self._bus.get_object("org.ofono", self._modem, introspect=False), "org.ofono.VoiceCallManager")

        def reponse(chemin):
            if self._suivi is suivi:
                self._appel = str(chemin)

        def erreur(e):
            if self._suivi is suivi and self._appel is None:
                self._suivi = None
                echec(e.get_dbus_message() if isinstance(e, dbus.DBusException) else str(e))

        gestionnaire.Dial(numero, "default", signature="ss", reply_handler=reponse, error_handler=erreur, timeout=15)

    def repondre(
        self, chemin: str, suivi: Suivi, echec: Callable[[str], None], generation: int | None = None,
        *, annule: Callable[[], bool] | None = None,
    ) -> None:
        """Décroche l'appel entrant `chemin`, sans attendre la réponse du téléphone (comme Dial). Le canal son gardé
        pendant la décision est branché tout de suite, comme celui d'un sortant à la composition. `echec` est appelé
        si le téléphone refuse ou ne répond pas. `generation` : celle annoncée avec l'appel ; un autre appel arrivé
        depuis sur le même chemin n'est pas décroché."""
        if self._suivi is not None:
            raise RuntimeError("un appel est déjà en cours")
        if not self._entrant_present(chemin, generation):
            raise RuntimeError("l'appel entrant ne sonne plus, ou a été pris sur le téléphone")
        self._modem = self.modem()
        if annule is not None and annule():
            self.laisser_sonner(chemin, generation)
            raise RuntimeError("décroché annulé")
        self._couper_traitement_du_telephone()  # avant Answer, comme avant Dial
        if annule is not None and annule():
            self.laisser_sonner(chemin, generation)
            raise RuntimeError("décroché annulé")
        self._suivi, self._appel, self._raison = suivi, chemin, "inconnue"
        self._evaluation = False
        canal, self._canal_en_attente = self._canal_en_attente, None
        if canal is not None:
            self._journal("canal son de l'appel entrant accepté")
            suivi.nouvelle_connexion(*canal)

        def reponse():
            pass

        def erreur(e):
            if self._suivi is suivi:
                self._suivi, self._appel = None, None
                echec(e.get_dbus_message() if isinstance(e, dbus.DBusException) else str(e))

        appel = dbus.Interface(self._bus.get_object("org.ofono", chemin, introspect=False), "org.ofono.VoiceCall")
        appel.Answer(signature="", reply_handler=reponse, error_handler=erreur, timeout=15)

    def laisser_sonner(self, chemin: str, generation: int | None = None) -> None:
        """L'application ne décroche pas (numéro inconnu, pas de réponse) : ni Answer ni Hangup, le téléphone sonne
        jusqu'à sa messagerie. Le canal son gardé est rendu au téléphone."""
        if self._entrant_present(chemin, generation):
            self._journal("appel entrant laissé sans réponse : il sonne sur le téléphone")
            self._fin_d_evaluation()

    def _entrant_present(self, chemin: str, generation: int | None) -> bool:
        """L'entrant annoncé sonne encore, en attente de la décision (sans `generation` : sur ce chemin, quel qu'il soit)."""
        meme = generation is None or generation == self._entrant_generation
        return chemin == self._entrant and self._evaluation and meme

    def raccrocher(self, suivi: Suivi | None = None) -> None:
        """Depuis n'importe quel thread. L'appel suivi seulement quand il est connu : HangupAll rejetterait aussi un
        appel entrant qui sonne en attente. Avant la réponse à Dial, HangupAll reste le seul moyen d'arrêter la
        composition. `suivi` : l'appel qui demande ; s'il n'est plus celui que suit le téléphone quand la demande
        s'exécute (fini entre-temps), rien n'est raccroché, sans quoi l'appel suivant, ou un entrant qui sonne, le serait."""

        def _faire():
            if suivi is not None and self._suivi is not suivi:
                return False
            try:
                if self._appel:
                    dbus.Interface(self._bus.get_object("org.ofono", self._appel, introspect=False), "org.ofono.VoiceCall").Hangup(
                        signature="", reply_handler=lambda: None,
                        error_handler=lambda _: self._journal("raccrochage du téléphone non confirmé"), timeout=DELAI_REGLAGE_AUDIO_S,
                    )
                elif self._modem and self._suivi is not None:
                    dbus.Interface(
                        self._bus.get_object("org.ofono", self._modem, introspect=False), "org.ofono.VoiceCallManager"
                    ).HangupAll(
                        signature="", reply_handler=lambda: None,
                        error_handler=lambda _: self._journal("raccrochage du téléphone non confirmé"), timeout=DELAI_REGLAGE_AUDIO_S,
                    )
            except dbus.DBusException:
                pass
            return False

        GLib.idle_add(_faire)

    def modem_connu(self) -> str | None:
        """Le téléphone passerelle appairé, connecté ou non (pour le reconnecter à distance)."""
        manager = dbus.Interface(self._bus.get_object("org.ofono", "/", introspect=False), "org.ofono.Manager")
        for chemin, proprietes in manager.GetModems(signature="", timeout=DELAI_LECTURE_DBUS_S):
            if proprietes.get("Type") == "hfp":
                return str(chemin)
        return None

    def reconnecter(self, modem: str | None = None) -> None:
        """Déconnecte puis reconnecte le téléphone (liaison figée, canal son bloqué, ou liaison établie sans le
        mSBC). Bloquant : hors du thread GLib, sur une connexion D-Bus à part."""
        modem = modem or self._modem
        if not modem:
            return
        appareil = modem.removeprefix("/hfp")  # /hfp/org/bluez/hci1/dev_… → /org/bluez/hci1/dev_…
        bus = dbus.SystemBus(private=True)
        try:
            d = dbus.Interface(bus.get_object("org.bluez", appareil), "org.bluez.Device1")
            try:
                d.Disconnect()
            except dbus.DBusException:
                pass  # déjà déconnecté
            time.sleep(3)
            d.Connect()
            time.sleep(4)  # le temps que la liaison mains-libres se rétablisse
        finally:
            bus.close()

    def _couper_traitement_du_telephone(self) -> None:
        """Le téléphone traite par défaut ce qu'il reçoit du « micro » mains-libres (anti-écho, anti-bruit,
        prévus pour un micro de voiture). Sur une voix de synthèse propre, ce traitement hache ou abîme le
        son (constat du 27/09) ; le pont n'a pas d'écho acoustique à retirer. Réactivé à chaque reconnexion."""
        modem = self._modem

        def termine(confirme: bool):
            self._journal("traitement audio du téléphone :", "ECNR désactivé" if confirme else "désactivation ECNR non confirmée")
            self._journaliser_volumes(modem)

        try:
            hf = dbus.Interface(self._bus.get_object("org.ofono", modem, introspect=False), "org.ofono.Handsfree")
            hf.SetProperty(
                "EchoCancelingNoiseReduction", dbus.Boolean(False), signature="sv",
                reply_handler=lambda: termine(True), error_handler=lambda _: termine(False),
                timeout=DELAI_REGLAGE_AUDIO_S,
            )
        except dbus.DBusException:
            termine(False)

    def _journaliser_volumes(self, modem: str) -> None:
        def reponse(proprietes):
            try:
                micro, ecoute = int(proprietes["MicrophoneVolume"]), int(proprietes["SpeakerVolume"])
                self._journal(f"volumes du téléphone : micro {micro}, écoute {ecoute}, muet {bool(proprietes['Muted'])}")
            except (KeyError, TypeError, ValueError):
                self._journal("volumes du téléphone : réponse illisible")

        try:
            volume = dbus.Interface(self._bus.get_object("org.ofono", modem, introspect=False), "org.ofono.CallVolume")
            volume.GetProperties(
                reply_handler=reponse, error_handler=lambda _: self._journal("volumes du téléphone : lecture impossible"),
                signature="", timeout=DELAI_REGLAGE_AUDIO_S,
            )
        except dbus.DBusException:
            self._journal("volumes du téléphone : lecture impossible")

    # --- signaux ---------------------------------------------------------------------------------

    def _nouvelle_connexion(self, fd: int, codec: int) -> None:
        if self._suivi is not None:
            self._suivi.nouvelle_connexion(fd, codec)
            return
        if self._evaluation:
            # L'iPhone peut ouvrir le canal dès la sonnerie. Fermé maintenant, rien n'assure qu'il serait rouvert
            # après Answer ; lu, il serait accepté (BT_DEFER_SETUP) et le son quitterait le téléphone. On le garde
            # jusqu'à la décision. Un second canal remplace le premier, sans doute déjà abandonné par le téléphone.
            if self._canal_en_attente is not None:
                os.close(self._canal_en_attente[0])
            self._canal_en_attente = (fd, codec)
            self._journal("canal son de l'appel entrant gardé en attente de la décision")
            return
        # Appel que le pont ne suit pas (passé ou reçu à la main, entrant laissé sans réponse) : on refuse le
        # canal pour que le son reste sur le téléphone.
        self._journal("canal son refusé : appel qui n'est pas celui du pont")
        os.close(fd)

    def _ajoute(self, chemin, proprietes):
        chemin, etat = str(chemin), str(proprietes.get("State", ""))
        if etat in ("incoming", "waiting"):
            self._entrant_arrive(chemin, proprietes)
            return
        # L'appel peut être annoncé avant la réponse à Dial : on le rattache dès son apparition. Seul un appel en
        # composition peut être le nôtre ; un entrant arrivé pendant ce temps n'est pas pris pour lui.
        if (
            etat in ("dialing", "alerting")
            and self._suivi is not None
            and self._appel is None
            and chemin.startswith(str(self._modem))
        ):
            self._appel = chemin
            self._suivi.etat_change(etat)

    def _entrant_arrive(self, chemin: str, proprietes) -> None:
        numero = str(proprietes.get("LineIdentification", "") or "")
        if self._entrant is not None:
            self._journal("autre appel entrant du", masquer(numero), ": il sonne sans réponse")
            return
        self._entrant, self._entrant_numero, self._entrant_annonce = chemin, numero, False
        self._entrant_generation += 1
        if self._suivi is not None or self.sur_entrant is None:
            self._journal("appel entrant du", masquer(numero), "pendant un appel : il sonne sans réponse")
            return
        self._evaluation = True
        if numero:
            self._annoncer()
        else:
            GLib.timeout_add(DELAI_NUMERO_ENTRANT_MS, self._numero_attendu, chemin, self._entrant_generation)

    def _numero_attendu(self, chemin: str, generation: int | None = None) -> bool:
        if self._entrant_present(chemin, generation) and not self._entrant_annonce:
            self._annoncer()
        return False

    def _annoncer(self) -> None:
        self._entrant_annonce = True
        if numero_masque(self._entrant_numero):
            self._journal("appel entrant sans numéro : il sonne sans réponse")
            self._fin_d_evaluation()
            return
        self._journal("appel entrant du", masquer(self._entrant_numero), ": l'application décide")
        self.sur_entrant(self._entrant, self._entrant_numero, self._entrant_generation)

    def _fin_d_evaluation(self) -> None:
        self._evaluation = False
        canal, self._canal_en_attente = self._canal_en_attente, None
        if canal is not None:
            os.close(canal[0])

    def _oublier_entrant(self) -> None:
        self._fin_d_evaluation()
        self._entrant, self._entrant_numero, self._entrant_annonce = None, "", False

    def _propriete(self, nom, valeur, chemin=None):
        if chemin == self._appel and nom == "State" and self._suivi:
            self._suivi.etat_change(str(valeur))
        elif chemin is not None and chemin == self._entrant and nom == "LineIdentification":
            self._entrant_numero = str(valeur or "")
            if self._evaluation and not self._entrant_annonce and self._entrant_numero:
                self._annoncer()
        elif chemin is not None and chemin == self._entrant and nom == "State" and self._evaluation:
            if str(valeur) not in ("incoming", "waiting"):
                # Décroché à la main sur le téléphone pendant la décision : le son lui revient.
                self._journal("appel entrant pris sur le téléphone :", str(valeur))
                self._fin_d_evaluation()

    def _raison_fin(self, raison, chemin=None):
        if chemin == self._appel:
            self._raison = str(raison)

    def _retire(self, chemin):
        chemin = str(chemin)
        if chemin == self._appel:
            self._terminer(self._raison)
        if chemin == self._entrant:
            if self._evaluation:
                self._journal("l'appel entrant a cessé de sonner pendant la décision")
            self._oublier_entrant()

    def _modem_retire(self, chemin):
        # Téléphone déconnecté en plein appel : oFono n'annoncera pas la fin de l'appel.
        if str(chemin) == self._modem and self._suivi is not None:
            self._terminer("téléphone déconnecté")
        if self._entrant is not None and self._entrant.startswith(str(chemin) + "/"):
            self._oublier_entrant()

    def _terminer(self, raison: str) -> None:
        suivi, self._suivi, self._appel = self._suivi, None, None
        if suivi:
            suivi.termine(raison)
