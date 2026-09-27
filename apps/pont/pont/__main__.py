"""Un appel de Mina sur la ligne Bluetooth.

    cd apps/web && node --env-file=../../.env --conditions=react-server --import ./scripts/resolution.ts \\
        scripts/variables-appel.ts <prospectId> > ../../data/variables.json
    cd apps/pont && .venv/bin/python -m pont appeler ../../data/variables.json
    cd apps/pont && .venv/bin/python -m pont tester-son ../../data/variables.json son.wav   (diagnostic)

Compose le numéro (déjà vérifié autorisé par `variables-appel.ts`), ne lance la conversation qu'au
décroché, raccroche quand Mina termine, et journalise les étapes horodatées dans data/pont/.
Les outils d'agenda sont des bouchons à ce stade : aucun créneau n'est proposé.
"""
import json
import os
import signal
import sys
import threading
import time
from pathlib import Path

import dbus
import dbus.mainloop.glib
from elevenlabs.client import ElevenLabs
from elevenlabs.conversational_ai.conversation import ClientTools, Conversation, ConversationInitiationData
from gi.repository import GLib, GLibUnix

from .audio import GAIN_SORTIE, Pont, temps_de_reponse
from .ofono import AgentAudio, Telephone, premier_modem_hfp

RACINE = Path(__file__).resolve().parents[3]
DUREE_MAX_S = 6 * 60  # au-delà du plafond de l'agent (300 s) : filet si la fin de session se perd


def lire_env(chemin: Path) -> dict[str, str]:
    env = {}
    for ligne in chemin.read_text().splitlines():
        if "=" in ligne and not ligne.lstrip().startswith("#"):
            cle, valeur = ligne.split("=", 1)
            env[cle.strip()] = valeur.strip().strip('"').strip("'")
    return env


class Journal:
    def __init__(self, fichier: Path):
        self._fichier = fichier.open("a", encoding="utf-8")
        self.t0 = time.monotonic()

    def __call__(self, *morceaux) -> None:
        ligne = f"{time.strftime('%H:%M:%S')} +{time.monotonic() - self.t0:6.2f}s " + " ".join(map(str, morceaux))
        print(ligne, flush=True)
        self._fichier.write(ligne + "\n")
        self._fichier.flush()


class ConversationPont(Conversation):
    """Récupère l'URL signée pendant la sonnerie, et lit les formats audio que le SDK ignore."""

    def __init__(self, *args, pont: Pont, journal: Journal, **kwargs):
        super().__init__(*args, **kwargs)
        self._pont = pont
        self._journal = journal
        self._url: str | None = None
        self._url_prete = threading.Event()

    def precharger_url(self) -> None:
        def _charger():
            try:
                self._url = super(ConversationPont, self)._get_signed_url()
                self._journal("URL signée obtenue")
            except Exception as e:  # la session la redemandera
                self._journal("URL signée indisponible :", e)
            self._url_prete.set()

        threading.Thread(target=_charger, daemon=True).start()

    def _get_signed_url(self):
        self._url_prete.wait(timeout=10)
        return self._url or super()._get_signed_url()

    def _handle_message(self, message, ws):
        if message.get("type") == "conversation_initiation_metadata":
            ev = message["conversation_initiation_metadata_event"]
            entree, sortie = ev.get("user_input_audio_format"), ev.get("agent_output_audio_format")
            self._journal("conversation ouverte", ev.get("conversation_id"), "| entrée", entree, "| sortie", sortie)
            self._pont.regler_formats(entree, sortie)
        super()._handle_message(message, ws)


def outils_bouchons(journal: Journal) -> ClientTools:
    outils = ClientTools()

    def proposer(parametres):
        journal("outil proposer_creneaux", {k: v for k, v in parametres.items() if k != "tool_call_id"})
        return "Aucun créneau n'est disponible pour l'instant. Propose de rappeler le prospect plus tard."

    def reserver(parametres):
        journal("outil reserver_creneau", {k: v for k, v in parametres.items() if k != "tool_call_id"})
        return "La réservation n'a pas pu être faite. Dis au prospect qu'on le recontactera pour fixer le rendez-vous."

    outils.register("proposer_creneaux", proposer)
    outils.register("reserver_creneau", reserver)
    return outils


def appeler(fichier_variables: str) -> int:
    preparation = json.loads(Path(fichier_variables).read_text())
    env = lire_env(RACINE / ".env")
    dossier = RACINE / "data" / "pont"
    dossier.mkdir(parents=True, exist_ok=True)
    horodatage = time.strftime("%Y%m%d-%H%M%S")
    journal = Journal(dossier / f"appel-{horodatage}.log")

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    boucle = GLib.MainLoop()
    enregistrement = str(dossier / f"appel-{horodatage}.wav")
    pont = Pont(enregistrement, journal)

    etat = {"decroche": None, "session": False, "fin_session": False, "appel_en_cours": True}
    pings: list[int] = []

    def fin_de_session():
        # Mina a terminé (end_call ou plafond de durée) : laisser partir la fin de sa phrase, puis raccrocher.
        if etat["fin_session"]:  # le SDK peut signaler la fin deux fois
            return
        etat["fin_session"] = True
        if not etat["appel_en_cours"]:
            return

        def _raccrocher_apres_vidage():
            limite = time.monotonic() + 8
            while not pont.sortie_vide() and time.monotonic() < limite:
                time.sleep(0.05)
            time.sleep(0.4)
            journal("Mina a terminé : on raccroche")
            telephone.raccrocher()

        threading.Thread(target=_raccrocher_apres_vidage, daemon=True).start()

    def transcription_prospect(texte):
        journal("prospect :", texte)

    conversation = ConversationPont(
        ElevenLabs(api_key=env["ELEVENLABS_API_KEY"]),
        env["ELEVENLABS_AGENT_ID"],
        requires_auth=True,
        audio_interface=pont,
        config=ConversationInitiationData(
            dynamic_variables=preparation["variables"],
            conversation_config_override={"asr": {"keywords": preparation.get("motsCles", [])}},
        ),
        client_tools=outils_bouchons(journal),
        callback_agent_response=lambda texte: journal("Mina :", texte),
        callback_user_transcript=transcription_prospect,
        callback_latency_measurement=pings.append,
        callback_end_session=fin_de_session,
        pont=pont,
        journal=journal,
    )

    def etat_change(nouvel_etat):
        journal("appel :", nouvel_etat)
        if nouvel_etat == "active" and not etat["session"]:
            etat["decroche"] = time.monotonic()
            etat["session"] = True
            pont.decroche()
            threading.Thread(target=conversation.start_session, daemon=True).start()

    def terminer():
        if etat["session"]:
            if not etat["fin_session"]:
                conversation.end_session()
            identifiant = conversation.wait_for_session_end()
        else:
            identifiant = None
        pont.fermer()
        bilan(identifiant)
        GLib.idle_add(boucle.quit)

    def appel_termine(raison):
        etat["appel_en_cours"] = False
        journal("appel terminé, raccroché par :", {"remote": "le prospect", "local": "nous"}.get(raison, raison))
        threading.Thread(target=terminer, daemon=True).start()

    def bilan(identifiant):
        journal("conversation ElevenLabs :", identifiant)
        if etat["decroche"] and pont.premier_son_de_mina:
            journal(f"décroché → premier son de Mina : {pont.premier_son_de_mina - etat['decroche']:.2f} s (elle attend le « Allô »)")
        l = sorted(temps_de_reponse(enregistrement)) if os.path.exists(enregistrement) else []
        if l:
            journal(
                f"fin de phrase du prospect → réponse de Mina : médiane {l[len(l) // 2]:.2f} s, "
                f"max {l[-1]:.2f} s sur {len(l)} tours"
            )
        if pings:
            journal(f"aller-retour réseau ElevenLabs : médiane {sorted(pings)[len(pings) // 2]} ms")

    modem = premier_modem_hfp(bus)
    telephone = Telephone(bus, modem, etat_change, appel_termine)
    telephone.enregistrer_agent_audio(AgentAudio(bus, pont.brancher))
    telephone.couper_traitement_du_telephone()

    numero = preparation["numero"]
    journal("composition du", numero[:4] + "…" + numero[-2:])
    telephone.composer(numero)
    conversation.precharger_url()

    GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, lambda: (journal("interruption"), telephone.raccrocher(), True)[-1])
    GLib.timeout_add_seconds(DUREE_MAX_S, lambda: (journal("durée maximale atteinte"), telephone.raccrocher(), False)[-1])
    boucle.run()
    return 0


def tester_son(fichier_variables: str, fichier_son: str) -> int:
    """Diagnostic sans ElevenLabs : au décroché, joue un WAV mono 16 bits sur la ligne par le même
    chemin que la voix de Mina, puis raccroche. Sert à séparer un défaut de la ligne d'un défaut de
    la conversation."""
    import wave

    import numpy as np
    import soxr

    with wave.open(fichier_son) as w:
        if (w.getnchannels(), w.getsampwidth()) != (1, 2):
            raise SystemExit("le son de test doit être un WAV mono 16 bits")
        taux = w.getframerate()
        son = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32)
    son16 = np.clip(soxr.resample(son, taux, 16000) if taux != 16000 else son, -32768, 32767).astype("<i2")
    son16 = (son16.astype(np.float32) / GAIN_SORTIE).clip(-32768, 32767).astype("<i2").tobytes()  # le pont réapplique le gain

    numero = json.loads(Path(fichier_variables).read_text())["numero"]
    dossier = RACINE / "data" / "pont"
    journal = Journal(dossier / "test-son.log")
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    boucle = GLib.MainLoop()
    pont = Pont(str(dossier / "test-son-enregistrement.wav"), journal)

    def etat_change(e):
        journal("appel :", e)
        if e == "active":
            pont.decroche()
            pont.output(son16)

            def raccrocher_a_la_fin():
                time.sleep(0.5)
                while not pont.sortie_vide():
                    time.sleep(0.05)
                journal("son joué : on raccroche")
                telephone.raccrocher()

            threading.Thread(target=raccrocher_a_la_fin, daemon=True).start()

    def termine(_raison):
        journal("appel terminé")
        pont.fermer()
        boucle.quit()

    telephone = Telephone(bus, premier_modem_hfp(bus), etat_change, termine)
    telephone.enregistrer_agent_audio(AgentAudio(bus, pont.brancher))
    telephone.couper_traitement_du_telephone()
    journal("composition")
    telephone.composer(numero)
    GLib.timeout_add_seconds(90, lambda: (telephone.raccrocher(), False)[-1])
    boucle.run()
    return 0


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "appeler":
        return appeler(sys.argv[2])
    if len(sys.argv) == 4 and sys.argv[1] == "tester-son":
        return tester_son(sys.argv[2], sys.argv[3])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
