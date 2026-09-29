"""Le fil SSE d'un appel : états et tours numérotés, niveaux glissés sans `id:`. Sans téléphone ni D-Bus."""
import json
import threading
import time
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from types import SimpleNamespace

import numpy as np

from pont.audio import COMPENSATION_MINA_DB, Niveaux
from pont.service import Service, lot_de_niveaux

APPEL = "00000000-0000-4000-8000-000000000001"


class FauxAppel:
    def __init__(self):
        self.evenements = [{"type": "etat", "etat": "active", "t": 1}]
        self.pont = SimpleNamespace(niveaux=Niveaux(16000))
        self._fini = threading.Event()

    def suivre(self, depuis, delai=15):
        time.sleep(min(delai, 0.05))
        return self.evenements[depuis:]

    def fini(self):
        return self._fini.is_set()


class Fil(unittest.TestCase):
    def test_lot(self):
        self.assertEqual(
            lot_de_niveaux([(1000, 0.4, 0.0), (1050, 0.1, 0.07)]),
            {"type": "niveaux", "t": 1050, "pasMs": 50, "mina": [0.4, 0.1], "prospect": [0.0, 0.07]},
        )

    def test_niveaux_relayes_sans_id(self):
        service = Service.__new__(Service)
        service._secret = "s"
        appel = FauxAppel()
        service._appels = {APPEL: appel}
        serveur = ThreadingHTTPServer(("127.0.0.1", 0), service._gestionnaire())
        threading.Thread(target=serveur.serve_forever, daemon=True).start()

        def produire():
            time.sleep(0.2)
            voix = (3000 * np.sin(np.arange(1600) / 5)).astype("<i2")
            appel.pont.niveaux.ajouter(voix, voix, COMPENSATION_MINA_DB)
            time.sleep(0.2)
            appel.evenements.append({"type": "tour", "role": "agent", "texte": "Bonjour", "t": 2})
            appel.evenements.append({"type": "etat", "etat": "termine", "t": 3})
            appel._fini.set()

        threading.Thread(target=produire, daemon=True).start()
        requete = urllib.request.Request(
            f"http://127.0.0.1:{serveur.server_address[1]}/appels/{APPEL}/evenements", headers={"authorization": "Bearer s"}
        )
        with urllib.request.urlopen(requete, timeout=5) as r:
            texte = r.read().decode()
        serveur.shutdown()
        messages = [m for m in texte.split("\n\n") if m.strip()]
        self.assertNotIn(": toujours la", texte)  # pas de battement toutes les 0,1 s
        niveaux = [m for m in messages if '"niveaux"' in m]
        self.assertTrue(niveaux)
        self.assertTrue(all(not m.startswith("id:") for m in niveaux))
        lot = json.loads(niveaux[0].removeprefix("data: "))
        self.assertEqual(len(lot["mina"]), 2)
        numerotes = [m.split("\n")[0] for m in messages if m.startswith("id:")]
        self.assertEqual(numerotes, ["id: 1", "id: 2", "id: 3"])


if __name__ == "__main__":
    unittest.main()
