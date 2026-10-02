"""Début et fin de l'accueil du prospect au décroché, lus dans le son de la ligne. Sans téléphone ni D-Bus."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from pont.appel import ouverture_valide
from pont.audio import Pont

TAUX = 16000
BLOC = 120  # une trame mSBC : 7,5 ms


def son(*morceaux: tuple[str, float]) -> np.ndarray:
    """("voix" | "silence", secondes)… : une voix à 440 Hz vers −20 dBFS, un silence de décroché (bruit faible)."""
    rng = np.random.default_rng(0)
    parties = []
    for nature, s in morceaux:
        n = int(TAUX * s)
        if nature == "voix":
            parties.append(3000 * np.sin(np.arange(n) * 2 * np.pi * 440 / TAUX))
        else:
            parties.append(rng.normal(0, 150, n))
    return np.concatenate(parties).astype("<i2")


class Accueil(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.TemporaryDirectory()
        self.pont = Pont(str(Path(self.dossier.name) / "a.wav"), lambda *_: None)

    def tearDown(self):
        self.pont.fermer()
        self.dossier.cleanup()

    def entendre(self, pcm: np.ndarray) -> None:
        for i in range(0, len(pcm), BLOC):
            self.pont._entrant(pcm[i : i + BLOC].tobytes())

    def test_accueil_court_fini_apres_500_ms_de_silence(self):
        self.entendre(son(("silence", 0.3), ("voix", 1.5), ("silence", 0.4)))
        self.assertTrue(self.pont.prospect_parle.is_set())
        self.assertFalse(self.pont.accueil_fini.is_set())
        self.entendre(son(("silence", 0.2)))
        self.assertTrue(self.pont.accueil_fini.is_set())
        self.assertAlmostEqual(self.pont.duree_accueil_s, 1.5, delta=0.1)

    def test_une_respiration_dans_l_accueil_ne_le_termine_pas(self):
        self.entendre(son(("voix", 0.8), ("silence", 0.3), ("voix", 0.7), ("silence", 0.6)))
        self.assertTrue(self.pont.accueil_fini.is_set())
        self.assertAlmostEqual(self.pont.duree_accueil_s, 1.8, delta=0.1)

    def test_pas_de_fin_tant_qu_il_parle(self):
        self.entendre(son(("voix", 4.0)))
        self.assertTrue(self.pont.prospect_parle.is_set())
        self.assertFalse(self.pont.accueil_fini.is_set())

    def test_le_silence_seul_n_est_pas_un_accueil(self):
        self.entendre(son(("silence", 3.0)))
        self.assertFalse(self.pont.prospect_parle.is_set())
        self.assertFalse(self.pont.accueil_fini.is_set())

    def test_accueil_jete_a_l_ouverture(self):
        envoye = []
        self.entendre(son(("voix", 1.0), ("silence", 0.6)))
        self.pont.oublier_accueil()
        self.pont.start(envoye.append)
        self.entendre(son(("silence", 0.2)))
        # Seuls les 200 ms arrivés après l'ouverture partent (au rééchantillonnage près), pas l'accueil.
        self.assertLess(sum(len(b) for b in envoye), TAUX * 2 * 0.25)


class Ouverture(unittest.TestCase):
    def test_phrase_gardee_sur_une_ligne(self):
        self.assertEqual(ouverture_valide("  Oui bonjour,\n je m'appelle Mina. "), "Oui bonjour, je m'appelle Mina.")

    def test_absente_ou_invalide(self):
        for valeur in (None, "", "   ", 42, ["Bonjour"], "a" * 301):
            with self.subTest(valeur=valeur):
                self.assertIsNone(ouverture_valide(valeur))


if __name__ == "__main__":
    unittest.main()
