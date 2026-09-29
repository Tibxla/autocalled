"""Pont Bluetooth d'Autocalled.

    .venv/bin/python -m pont servir
        le service permanent, piloté par l'application (ADR 0007) ; installé par scripts/installer-pont.sh

Diagnostic, service arrêté (un seul programme peut tenir l'agent audio d'oFono). Le fichier de préparation contient
le numéro et le contexte du prospect (données personnelles) : il ne vaut que dix minutes, le consentement étant
vérifié au moment où il est produit, et il est effacé après usage.

    cd apps/web && node --env-file=../../.env --conditions=react-server --import ./scripts/resolution.ts \\
        scripts/variables-appel.ts <prospectId> > ../../data/variables.json
    .venv/bin/python -m pont appeler ../../data/variables.json
        un appel de Mina hors de l'application, outils d'agenda bouchonnés
    .venv/bin/python -m pont tester-son ../../data/variables.json son.wav
        joue un WAV mono 16 bits au décroché puis raccroche, sans ElevenLabs : sépare un défaut de la
        ligne d'un défaut de la conversation
"""
import json
import os
import signal
import sys
import threading
import time
from pathlib import Path
from typing import Any

import dbus
import dbus.mainloop.glib
from gi.repository import GLib, GLibUnix

from .appel import Appel, Journal
from .ofono import Telephone
from .plafond import Plafond
from .reglages import Reglages
from .service import numero_valide, preparer_dossier

RACINE = Path(__file__).resolve().parents[3]


def lire_cles() -> dict[str, str]:
    """`.env` à la racine du dépôt, surchargé par l'environnement du processus."""
    cles: dict[str, str] = {}
    fichier = RACINE / ".env"
    if fichier.exists():
        for ligne in fichier.read_text().splitlines():
            if "=" in ligne and not ligne.lstrip().startswith("#"):
                cle, valeur = ligne.split("=", 1)
                cles[cle.strip()] = valeur.strip().strip('"').strip("'")
    cles.update({k: v for k, v in os.environ.items() if k.startswith(("ELEVENLABS_", "PONT_", "WEB_"))})
    return cles


class RappelsLocaux:
    """Diagnostic : pas d'application, outils d'agenda bouchonnés."""

    def __init__(self):
        self.journal: Journal | None = None

    def conversation_ouverte(self, conversation_id: str) -> None:
        self.journal("conversation ElevenLabs :", conversation_id)

    def outil(self, nom: str, parametres: dict[str, Any]) -> str:
        return "L'agenda n'est pas branché pour ce test : propose au prospect qu'on le recontacte pour fixer un moment."

    def evenement(self, type_: str, donnees: dict[str, Any]) -> None:
        pass

    def fin(self, bilan: dict[str, Any]) -> None:
        pass


def _boucle_et_telephone() -> tuple[GLib.MainLoop, Telephone, Journal]:
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    journal = Journal()
    telephone = Telephone(dbus.SystemBus(), journal)
    telephone.enregistrer_agent_audio()
    return GLib.MainLoop(), telephone, journal


FRAICHEUR_PREPARATION_S = 600


def lire_preparation(fichier: str, maintenant: float | None = None) -> dict[str, Any]:
    """Le fichier produit par scripts/variables-appel.ts, s'il date de moins de dix minutes, puis effacé : le
    consentement se vérifie juste avant de composer, jamais en avance (un numéro peut avoir été révoqué depuis)."""
    chemin = Path(fichier)
    preparation = json.loads(chemin.read_text())
    prepare_le = preparation.get("prepareLe")
    if not isinstance(prepare_le, (int, float)):
        raise SystemExit("préparation sans date (prepareLe) : la refaire avec scripts/variables-appel.ts")
    age = (maintenant or time.time()) - prepare_le / 1000
    if not 0 <= age <= FRAICHEUR_PREPARATION_S:
        raise SystemExit("préparation de plus de dix minutes : la refaire, le consentement doit être vérifié juste avant l'appel")
    if not numero_valide(preparation.get("numero")):
        raise SystemExit("numéro illisible dans la préparation")
    chemin.unlink(missing_ok=True)
    return preparation


def appeler(fichier_variables: str) -> int:
    preparation = lire_preparation(fichier_variables)
    cles = lire_cles()
    dossier = RACINE / "data" / "pont"
    preparer_dossier(dossier)
    reglages = Reglages(dossier / "reglages.json", cles)
    plafond = Plafond(dossier / "historique-appels.json", reglages.valeurs["appelsParHeure"], reglages.valeurs["appelsParJour"])
    if raison := plafond.refus():
        raise SystemExit(raison)
    boucle, telephone, _ = _boucle_et_telephone()
    rappels = RappelsLocaux()
    appel = Appel(
        telephone,
        preparation["numero"],
        preparation["variables"],
        preparation.get("motsCles", []),
        cles,
        dossier,
        "appel-" + time.strftime("%Y%m%d-%H%M%S"),
        rappels,
        plafond=plafond,
    )
    rappels.journal = appel.journal
    appel.lancer()
    GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, lambda: (appel.raccrocher(), True)[-1])
    threading.Thread(target=lambda: (appel.attendre_fin(), GLib.idle_add(boucle.quit)), daemon=True).start()
    boucle.run()
    return 0


def tester_son(fichier_variables: str, fichier_son: str) -> int:
    import wave

    import numpy as np
    import soxr

    from .audio import GAIN_SORTIE, Pont

    with wave.open(fichier_son) as w:
        if (w.getnchannels(), w.getsampwidth()) != (1, 2):
            raise SystemExit("le son de test doit être un WAV mono 16 bits")
        taux = w.getframerate()
        son = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32)
    son16 = soxr.resample(son, taux, 16000) if taux != 16000 else son
    son16 = (son16 / GAIN_SORTIE).clip(-32768, 32767).astype("<i2").tobytes()  # le pont réapplique le gain

    numero = lire_preparation(fichier_variables)["numero"]
    boucle, telephone, journal = _boucle_et_telephone()
    pont = Pont(str(RACINE / "data" / "pont" / "test-son-enregistrement.wav"), journal)

    class Suivi:
        def nouvelle_connexion(self, fd, codec):
            pont.brancher(fd, codec)

        def etat_change(self, etat):
            journal("appel :", etat)
            if etat == "active":
                pont.decroche()
                pont.output(son16)

                def raccrocher_a_la_fin():
                    time.sleep(0.5)
                    while not pont.sortie_vide():
                        time.sleep(0.05)
                    journal("son joué : on raccroche")
                    telephone.raccrocher()

                threading.Thread(target=raccrocher_a_la_fin, daemon=True).start()

        def termine(self, raison):
            journal("appel terminé")
            pont.fermer()
            boucle.quit()

    telephone.composer(numero, Suivi(), lambda raison: (journal("composition impossible :", raison), boucle.quit()))
    GLib.timeout_add_seconds(90, lambda: (telephone.raccrocher(), False)[-1])
    boucle.run()
    return 0


def main() -> int:
    os.umask(0o077)  # journaux et enregistrements d'appels : au seul compte qui lance le pont
    arguments = sys.argv[1:]
    if arguments == ["servir"]:
        from .service import servir

        return servir(lire_cles(), RACINE)
    if len(arguments) == 2 and arguments[0] == "appeler":
        return appeler(arguments[1])
    if len(arguments) == 3 and arguments[0] == "tester-son":
        return tester_son(arguments[1], arguments[2])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
