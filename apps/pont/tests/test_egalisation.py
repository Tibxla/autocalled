"""Égalisation de la voix de Mina pour la ligne téléphonique. Sans téléphone ni D-Bus."""
import unittest

import numpy as np

from pont.audio import _Egaliseur, filtre_egalisation

TAUX = 16000


def gain_db(filtre: np.ndarray, frequence: float) -> float:
    reponse = np.abs(np.fft.rfft(filtre, 8192))
    return float(20 * np.log10(reponse[int(round(frequence * 8192 / TAUX))]))


class Egalisation(unittest.TestCase):
    def test_graves_baissees_presence_remontee(self):
        f = filtre_egalisation(TAUX)
        self.assertLess(gain_db(f, 100), -12)
        self.assertAlmostEqual(gain_db(f, 1000), 0, delta=0.5)
        self.assertAlmostEqual(gain_db(f, 3000), 5, delta=0.5)

    def test_en_flux_comme_d_un_bloc(self):
        x = np.random.default_rng(0).normal(0, 1000, 5000).astype(np.float32)
        tout = _Egaliseur(TAUX)(x)
        e = _Egaliseur(TAUX)
        morceaux = np.concatenate([e(x[i : i + 333]) for i in range(0, len(x), 333)])
        self.assertEqual(len(morceaux), len(x))
        np.testing.assert_allclose(morceaux, tout, rtol=1e-4, atol=1e-2)


if __name__ == "__main__":
    unittest.main()
