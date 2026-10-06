"""Égalisation de la voix de Mina pour la ligne téléphonique. Sans téléphone ni D-Bus."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from pont.appel import Appel
from pont.audio import GAIN_SORTIE, Pont, _Egaliseur, filtre_egalisation, profil_egalisation
from pont.service import Service

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
        for taux in (8000, 16000, 44100):
            for profil in ("historique", "douce", "aucune"):
                with self.subTest(taux=taux, profil=profil):
                    tout = _Egaliseur(taux, profil)(x)
                    e = _Egaliseur(taux, profil)
                    morceaux = np.concatenate([e(x[i : i + 333]) for i in range(0, len(x), 333)])
                    self.assertEqual(len(morceaux), len(x))
                    np.testing.assert_allclose(morceaux, tout, rtol=1e-4, atol=1e-2)

    def test_douce_conserve_graves_et_retire_bosse_aigus(self):
        historique = filtre_egalisation(TAUX)
        douce = filtre_egalisation(TAUX, profil="douce")
        for frequence in (100, 300, 1000):
            self.assertAlmostEqual(gain_db(douce, frequence), gain_db(historique, frequence), delta=0.1)
        for frequence in (2500, 3000, 3600):
            self.assertAlmostEqual(gain_db(douce, frequence), 0, delta=0.1)

    def test_pas_de_saturation_numerique_meme_sur_signal_pleine_echelle(self):
        # La norme L1 borne chaque échantillon filtré, même pour un signal plus extrême qu'une voix.
        self.assertAlmostEqual(20 * np.log10(GAIN_SORTIE), -18)
        for profil in ("historique", "douce", "aucune"):
            with self.subTest(profil=profil):
                self.assertLess(np.abs(filtre_egalisation(TAUX, profil=profil)).sum() * GAIN_SORTIE, 1)

    def test_sans_egalisation_garde_exactement_le_gain_anti_saturation(self):
        p = Pont("inutilise.wav", lambda *_: None, egalisation="aucune")
        try:
            x = np.array([-32768, -12000, 0, 12000, 32767], dtype="<i2")
            p.output(x.tobytes())
            attendu = (x.astype(np.float32) * GAIN_SORTIE).astype("<i2").tobytes()
            self.assertEqual(p._pcm_sortant(len(attendu)), attendu)
            self.assertIsNone(p._egaliseur)
            p.regler_formats("pcm_16000", "pcm_44100")
            self.assertIsNone(p._egaliseur)
        finally:
            p.fermer()

    def test_profil_garde_apres_negociation_format(self):
        p = Pont("inutilise.wav", lambda *_: None, egalisation="douce")
        try:
            p.regler_formats("pcm_16000", "pcm_44100")
            np.testing.assert_array_equal(p._egaliseur._filtre, filtre_egalisation(44100, profil="douce"))
            self.assertEqual(p.egalisation, "douce")
        finally:
            p.fermer()

    def test_historique_par_defaut_et_valeur_invalide_refusee(self):
        p = Pont("inutilise.wav", lambda *_: None)
        try:
            self.assertEqual(p.egalisation, "historique")
            np.testing.assert_array_equal(p._egaliseur._filtre, filtre_egalisation(TAUX))
        finally:
            p.fermer()
        for valeur in ("", "inconnue", "Douce"):
            with self.subTest(valeur=valeur), self.assertRaisesRegex(ValueError, "PONT_EGALISATION"):
                profil_egalisation(valeur)
        # Rejet avant toute initialisation D-Bus, composition ou écriture de données.
        with self.assertRaisesRegex(ValueError, "PONT_EGALISATION"):
            Service({"PONT_EGALISATION": "inconnue"}, Path("inutilise"))

    def test_profil_env_transmis_a_un_appel(self):
        for valeur in (None, "douce", "aucune"):
            with (
                self.subTest(valeur=valeur),
                tempfile.TemporaryDirectory() as dossier,
                mock.patch("pont.appel.Journal"),
                mock.patch("pont.appel.ElevenLabs"),
                mock.patch("pont.appel.ConversationPont"),
            ):
                cles = {"ELEVENLABS_API_KEY": "k", "ELEVENLABS_AGENT_ID": "a"}
                if valeur is not None:
                    cles["PONT_EGALISATION"] = valeur
                appel = Appel(
                    telephone=mock.Mock(), numero="+33639980001", variables={}, mots_cles=[], cles=cles,
                    dossier=Path(dossier), nom="essai", rappels=mock.Mock(),
                )
                try:
                    self.assertEqual(appel._pont.egalisation, valeur or "historique")
                finally:
                    appel._pont.fermer()


if __name__ == "__main__":
    unittest.main()
