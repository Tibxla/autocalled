"""Niveaux des deux voix envoyés au suivi en direct. Lancer depuis apps/pont : python -m unittest discover"""
import json
import timeit
import unittest

import numpy as np

from pont.audio import COMPENSATION_MINA_DB, NIVEAUX_GARDES, Niveaux, dbfs, normaliser, NIVEAU_PROSPECT_DBFS

TAUX = 16000
BLOC = 120  # une trame mSBC : 7,5 ms


def sinus(amplitude: float, n: int) -> np.ndarray:
    return (amplitude * np.sin(np.arange(n) * 2 * np.pi * 440 / TAUX)).astype("<i2")


def pousser(niveaux: Niveaux, prospect: np.ndarray, mina: np.ndarray) -> None:
    for i in range(0, len(prospect), BLOC):
        niveaux.ajouter(prospect[i : i + BLOC], mina[i : i + BLOC], COMPENSATION_MINA_DB)


class Echelle(unittest.TestCase):
    def test_dbfs(self):
        x = sinus(32767, 1600).astype(np.float32)
        self.assertAlmostEqual(dbfs(float(np.dot(x, x)), len(x)), -3.0, delta=0.1)
        self.assertLess(dbfs(0.0, 800), -90)
        self.assertLess(dbfs(0.0, 0), -90)

    def test_normaliser_borne(self):
        self.assertEqual(normaliser(-100, NIVEAU_PROSPECT_DBFS), 0.0)
        self.assertEqual(normaliser(0, NIVEAU_PROSPECT_DBFS), 1.0)
        self.assertEqual(normaliser(-28, (-40.0, -16.0)), 0.5)


class Releves(unittest.TestCase):
    def test_une_fenetre_de_50_ms_par_releve_au_sample_pres(self):
        n = Niveaux(TAUX)
        pousser(n, np.zeros(1000, "<i2"), np.zeros(1000, "<i2"))  # 800 échantillons : un relevé, 200 en attente
        _, releves = n.depuis(0)
        self.assertEqual(len(releves), 1)
        pousser(n, np.zeros(600, "<i2"), np.zeros(600, "<i2"))
        self.assertEqual(len(n.depuis(0)[1]), 2)

    def test_en_cvsd_la_fenetre_suit_le_taux(self):
        n = Niveaux(TAUX)
        n.regler_taux(8000)
        pousser(n, np.zeros(800, "<i2"), np.zeros(800, "<i2"))
        self.assertEqual(len(n.depuis(0)[1]), 2)

    def test_le_bruit_du_decroche_reste_a_zero_une_voix_monte(self):
        n = Niveaux(TAUX)
        bruit = np.random.default_rng(1).normal(0, 250, 800).astype("<i2")
        pousser(n, bruit, np.zeros(800, "<i2"))
        pousser(n, sinus(4000, 800), np.zeros(800, "<i2"))  # un « allô » franc, vers −21 dBFS
        (_, mina0, prospect0), (_, _, prospect1) = n.depuis(0)[1]
        self.assertEqual(prospect0, 0.0)
        self.assertEqual(mina0, 0.0)
        self.assertGreater(prospect1, 0.6)

    def test_mina_compensee_de_son_gain_de_sortie(self):
        n = Niveaux(TAUX)
        # Mina envoyée vers −31 dBFS (RMS ≈ 920) : au niveau d'ElevenLabs, vers −13 dBFS.
        pousser(n, np.zeros(800, "<i2"), sinus(1300, 800))
        (_, mina, prospect), = n.depuis(0)[1]
        self.assertGreater(mina, 0.7)
        self.assertEqual(prospect, 0.0)

    def test_un_lecteur_ne_recoit_que_ce_qui_suit_son_arrivee(self):
        n = Niveaux(TAUX)
        pousser(n, np.zeros(1600, "<i2"), np.zeros(1600, "<i2"))
        curseur = n.curseur()
        self.assertEqual(n.depuis(curseur)[1], [])
        pousser(n, np.zeros(800, "<i2"), np.zeros(800, "<i2"))
        suivant, releves = n.depuis(curseur)
        self.assertEqual(len(releves), 1)
        self.assertEqual(n.depuis(suivant)[1], [])

    def test_file_bornee(self):
        n = Niveaux(TAUX)
        pousser(n, np.zeros(800 * (NIVEAUX_GARDES + 20), "<i2"), np.zeros(800 * (NIVEAUX_GARDES + 20), "<i2"))
        self.assertEqual(len(n.depuis(0)[1]), NIVEAUX_GARDES)

    def test_releves_serialisables(self):
        n = Niveaux(TAUX)
        pousser(n, sinus(3000, 800), sinus(1000, 800))
        t, mina, prospect = n.depuis(0)[1][0]
        self.assertIs(type(t), int)
        json.dumps({"mina": [mina], "prospect": [prospect]})

    def test_cout_par_bloc_negligeable(self):
        """Une trame mSBC tous les 7,5 ms (133 par seconde) : le relevé doit rester sous 1 % d'un cœur."""
        n = Niveaux(TAUX)
        p, m = sinus(3000, BLOC), sinus(1000, BLOC)
        tours = 20000
        par_bloc = timeit.timeit(lambda: n.ajouter(p, m, COMPENSATION_MINA_DB), number=tours) / tours
        self.assertLess(par_bloc * 133, 0.01)


if __name__ == "__main__":
    unittest.main()
