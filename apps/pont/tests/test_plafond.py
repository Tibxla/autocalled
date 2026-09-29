"""Plafond d'appels et ce que /etat en dit (heure du prochain appel possible, décroché). Sans téléphone ni D-Bus."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from pont.plafond import Plafond
from pont.service import decroche_le, etat_du_plafond

T0 = 1_800_000_000.0  # un instant fixe, en secondes depuis l'epoch


class PlafondTest(unittest.TestCase):
    def setUp(self):
        self._dossier = tempfile.TemporaryDirectory()
        self.fichier = Path(self._dossier.name) / "historique-appels.json"

    def tearDown(self):
        self._dossier.cleanup()

    def plafond(self, par_heure: int, par_jour: int, appels: list[float]) -> Plafond:
        p = Plafond(self.fichier, par_heure, par_jour)
        for t in appels:
            p.compter(t)
        return p

    def test_sous_le_plafond(self):
        p = self.plafond(3, 10, [T0 - 600, T0 - 300])
        self.assertIsNone(p.prochain(T0))
        self.assertEqual(etat_du_plafond(p, T0), {"plafond": None, "plafondJusqua": None})

    def test_plafond_horaire_heure_du_prochain_appel(self):
        # Trois appels dans l'heure, le plus ancien il y a 40 min : le prochain part dans 20 min.
        p = self.plafond(3, 10, [T0 - 2400, T0 - 1200, T0 - 60])
        self.assertEqual(p.prochain(T0), T0 - 2400 + 3600)
        etat = etat_du_plafond(p, T0)
        self.assertEqual(etat["plafondJusqua"], int((T0 + 1200) * 1000))
        self.assertIn("dans 21 min", etat["plafond"])

    def test_le_plafond_qui_bloque_le_plus_longtemps_l_emporte(self):
        # L'heure glissante se libère dans 50 min, mais le jour est plein jusqu'à ce que l'appel d'il y a 23 h sorte.
        appels = [T0 - 23 * 3600, T0 - 20 * 3600, T0 - 600]
        p = self.plafond(1, 3, appels)
        self.assertEqual(p.prochain(T0), T0 - 23 * 3600 + 86400)
        self.assertIn("par jour", p.refus(T0))

    def test_historique_relu_apres_redemarrage(self):
        self.plafond(1, 5, [T0 - 60])
        self.assertEqual(Plafond(self.fichier, 1, 5).prochain(T0), T0 - 60 + 3600)


class DecrocheTest(unittest.TestCase):
    def test_premier_etat_active(self):
        appel = SimpleNamespace(
            evenements=[
                {"type": "etat", "etat": "composition", "t": 1},
                {"type": "etat", "etat": "active", "t": 5},
                {"type": "tour", "role": "agent", "texte": "…", "t": 6},
                {"type": "etat", "etat": "active", "t": 9},
            ]
        )
        self.assertEqual(decroche_le(appel), 5)

    def test_pas_encore_decroche(self):
        self.assertIsNone(decroche_le(SimpleNamespace(evenements=[{"type": "etat", "etat": "alerting", "t": 1}])))


if __name__ == "__main__":
    unittest.main()
