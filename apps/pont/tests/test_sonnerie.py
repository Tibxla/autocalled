"""Un standard qui prend la ligne puis fait sonner : la tonalité n'est pas une voix, et tant qu'elle revient, le pont
attend la vraie voix avant d'ouvrir la conversation. Sans téléphone ni D-Bus."""
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from pont import appel as module_appel
from pont.appel import attendre_voix
from pont.audio import Pont
from tests.test_accueil import BLOC, TAUX, son, voix


def tonalite(secondes: float, frequence: float = 440, amplitude: float = 7300) -> np.ndarray:
    """Une note pure (vers −13 dBFS par défaut), comme la tonalité de retour d'appel jouée par un standard."""
    n = int(TAUX * secondes)
    return (amplitude * np.sin(np.arange(n) * 2 * np.pi * frequence / TAUX)).astype("<i2")


def sonnerie(salves: int, frequence: float = 440) -> np.ndarray:
    """La cadence française : 1,5 s de tonalité, 3,5 s de silence."""
    return np.concatenate([np.concatenate([tonalite(1.5, frequence), son(("silence", 3.5))]) for _ in range(salves)])


class Tonalite(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.TemporaryDirectory()
        self.pont = Pont(str(Path(self.dossier.name) / "a.wav"), lambda *_: None)

    def tearDown(self):
        self.pont.fermer()
        self.dossier.cleanup()

    def entendre(self, pcm: np.ndarray) -> None:
        for i in range(0, len(pcm), BLOC):
            self.pont._entrant(pcm[i : i + BLOC].tobytes())

    def test_la_sonnerie_n_est_pas_une_voix(self):
        self.entendre(sonnerie(3))
        self.assertFalse(self.pont.prospect_parle.is_set())

    def test_une_tonalite_faible_apres_un_silence_n_est_pas_une_voix(self):
        # Le silence qui précède dilue la fenêtre de 100 ms : le niveau se juge sur la trame (revue du 24/10).
        for amplitude in (900, 1000, 2000):
            with self.subTest(amplitude=amplitude):
                pont = Pont(str(Path(self.dossier.name) / f"{amplitude}.wav"), lambda *_: None)
                pcm = np.concatenate([son(("silence", 0.2)), tonalite(1.5, amplitude=amplitude), son(("silence", 1.0))])
                for i in range(0, len(pcm), BLOC):
                    pont._entrant(pcm[i : i + BLOC].tobytes())
                self.assertFalse(pont.prospect_parle.is_set())
                pont.fermer()

    def test_une_tonalite_qui_commence_est_en_cours_avant_d_etre_reconnue(self):
        self.entendre(tonalite(0.2))
        self.assertTrue(self.pont.tonalite_en_cours())
        self.assertFalse(self.pont.sonnerie_recente())

    def test_la_sonnerie_est_reconnue(self):
        self.entendre(tonalite(1.5))
        self.assertTrue(self.pont.sonnerie_recente())

    def test_les_tonalites_europeennes_aussi(self):
        for frequence in (425, 450):
            with self.subTest(frequence=frequence):
                pont = Pont(str(Path(self.dossier.name) / f"{frequence}.wav"), lambda *_: None)
                for i in range(0, int(TAUX * 1.5), BLOC):
                    pont._entrant(tonalite(1.5, frequence)[i : i + BLOC].tobytes())
                self.assertFalse(pont.prospect_parle.is_set())
                self.assertTrue(pont.sonnerie_recente())
                pont.fermer()

    def test_un_bip_tres_court_n_arme_pas_la_sonnerie(self):
        self.entendre(tonalite(0.12))
        self.assertFalse(self.pont.sonnerie_recente())
        self.assertFalse(self.pont.prospect_parle.is_set())

    def test_la_voix_n_est_pas_une_sonnerie(self):
        self.entendre(son(("voix", 1.5)))
        self.assertFalse(self.pont.sonnerie_recente())
        self.assertTrue(self.pont.prospect_parle.is_set())

    def test_la_sonnerie_oubliee_apres_quelques_secondes(self):
        self.entendre(tonalite(1.5))
        with mock.patch("pont.audio.time.monotonic", return_value=time.monotonic() + 6):
            self.assertFalse(self.pont.sonnerie_recente())

    def test_une_salve_courte_rafraichit_une_sonnerie_reconnue(self):
        self.entendre(tonalite(1.5))
        avant = self.pont._derniere_tonalite
        self.entendre(son(("silence", 3.5)))
        self.entendre(tonalite(0.7))  # la dernière salve, coupée par le décroché
        self.assertGreater(self.pont._derniere_tonalite, avant)
        self.assertFalse(self.pont.prospect_parle.is_set())

    def test_l_accueil_apres_la_sonnerie(self):
        self.entendre(sonnerie(2))
        self.entendre(son(("voix", 1.4), ("silence", 0.6)))
        self.assertTrue(self.pont.prospect_parle.is_set())
        self.assertTrue(self.pont.accueil_fini.is_set())
        self.assertAlmostEqual(self.pont.duree_accueil_s, 1.4, delta=0.15)

    def test_un_bip_dans_la_voix_ne_change_rien(self):
        self.entendre(np.concatenate([son(("voix", 0.6)), tonalite(0.2), son(("voix", 0.6), ("silence", 0.6))]))
        self.assertTrue(self.pont.accueil_fini.is_set())
        self.assertAlmostEqual(self.pont.duree_accueil_s, 1.4, delta=0.15)
        self.assertFalse(self.pont.sonnerie_recente())


class FauxPont:
    def __init__(self):
        self.prospect_parle = threading.Event()
        self.sonne = False

    def sonnerie_recente(self) -> bool:
        return self.sonne

    def tonalite_en_cours(self) -> bool:
        return False


@mock.patch.object(module_appel, "SILENCE_AU_DECROCHE_S", 0.2)
@mock.patch.object(module_appel, "ATTENTE_SONNERIE_MAX_S", 0.8)
class AttenteDeLaVoix(unittest.TestCase):
    def setUp(self):
        self.pont = FauxPont()
        self.lignes: list[str] = []

    def attendre(self, en_ligne=lambda: True) -> tuple[bool, float]:
        debut = time.monotonic()
        resultat = attendre_voix(self.pont, en_ligne, lambda *m: self.lignes.append(" ".join(map(str, m))))
        return resultat, time.monotonic() - debut

    def plus_tard(self, secondes: float, geste) -> None:
        threading.Timer(secondes, geste).start()

    def test_la_voix_arrive_vite(self):
        self.plus_tard(0.05, self.pont.prospect_parle.set)
        resultat, duree = self.attendre()
        self.assertTrue(resultat)
        self.assertLess(duree, 0.2)

    def test_le_silence_rend_la_main_au_delai_habituel(self):
        resultat, duree = self.attendre()
        self.assertFalse(resultat)
        self.assertAlmostEqual(duree, 0.2, delta=0.15)

    def test_la_sonnerie_prolonge_l_attente(self):
        self.pont.sonne = True
        self.plus_tard(0.5, self.pont.prospect_parle.set)
        resultat, duree = self.attendre()
        self.assertTrue(resultat)
        self.assertGreater(duree, 0.4)
        self.assertTrue(any("sonnerie" in ligne for ligne in self.lignes))

    def test_l_attente_de_la_sonnerie_est_bornee(self):
        self.pont.sonne = True
        resultat, duree = self.attendre()
        self.assertFalse(resultat)
        self.assertAlmostEqual(duree, 0.8, delta=0.15)

    def test_la_sonnerie_finie_rend_la_main(self):
        self.pont.sonne = True
        self.plus_tard(0.3, lambda: setattr(self.pont, "sonne", False))
        resultat, duree = self.attendre()
        self.assertFalse(resultat)
        self.assertGreater(duree, 0.25)
        self.assertLess(duree, 0.7)

    def test_un_appel_raccroche_n_attend_pas(self):
        self.pont.sonne = True
        resultat, duree = self.attendre(en_ligne=lambda: False)
        self.assertFalse(resultat)
        self.assertLess(duree, 0.2)


class Horloge:
    """Le temps de l'audio : chaque attente de l'ouverture fait entendre au vrai détecteur le son correspondant."""

    def __init__(self, pont: Pont, pcm: np.ndarray):
        self.pont, self.pcm, self.t, self.lu = pont, pcm, 0.0, 0

    def __call__(self) -> float:
        return self.t

    def attendre(self, delai: float) -> bool:
        fin = min(len(self.pcm), self.lu + int(TAUX * delai))
        for i in range(self.lu, fin, BLOC):
            self.pont._entrant(self.pcm[i : min(i + BLOC, fin)].tobytes())
        self.lu = fin
        self.t += delai
        return self.pont.prospect_parle.is_set()


@mock.patch.object(module_appel, "SILENCE_AU_DECROCHE_S", 2.0)
@mock.patch.object(module_appel, "ATTENTE_SONNERIE_MAX_S", 60.0)
class OuvertureApresUnStandard(unittest.TestCase):
    """Le son entendu après « active », rejoué au rythme de l'attente : quand la conversation s'ouvrirait-elle ?"""

    def ouvrir(self, pcm: np.ndarray) -> tuple[bool, float, Pont]:
        dossier = tempfile.TemporaryDirectory()
        self.addCleanup(dossier.cleanup)
        pont = Pont(str(Path(dossier.name) / "o.wav"), lambda *_: None)
        self.addCleanup(pont.fermer)
        horloge = Horloge(pont, pcm)
        with mock.patch("pont.audio.time.monotonic", horloge):
            voix_entendue = attendre_voix(pont, lambda: True, lambda *_: None, horloge=horloge, attendre=horloge.attendre)
        return voix_entendue, horloge.t, pont

    def test_le_standard_du_23_10(self):
        # Une salve entamée, huit salves entières, puis l'accueil : l'ouverture attend la voix.
        pcm = np.concatenate([tonalite(1.4), son(("silence", 3.5)), sonnerie(8), son(("voix", 1.4), ("silence", 1.0))])
        voix_entendue, t, _ = self.ouvrir(pcm)
        self.assertTrue(voix_entendue)
        self.assertGreater(t, 45)

    def test_une_salve_tronquee_au_decroche(self):
        # « active » alors qu'il reste 0,7 s de salve, puis 3,5 s de silence et la salve suivante (revue du 24/10).
        pcm = np.concatenate([tonalite(0.7), son(("silence", 3.5)), sonnerie(2), son(("voix", 1.2), ("silence", 1.0))])
        voix_entendue, t, _ = self.ouvrir(pcm)
        self.assertTrue(voix_entendue)
        self.assertGreater(t, 14)

    def test_une_salve_tres_tronquee_au_decroche(self):
        # Il ne reste que 0,3 s de salve à « active » (contre-relecture du 24/10).
        pcm = np.concatenate([tonalite(0.3), son(("silence", 3.5)), sonnerie(2), son(("voix", 1.2), ("silence", 1.0))])
        voix_entendue, t, _ = self.ouvrir(pcm)
        self.assertTrue(voix_entendue)
        self.assertGreater(t, 13)

    def test_une_sonnerie_qui_commence_tard(self):
        # La première salve part 1,2 s après « active » : à 2 s elle sonne déjà (revue du 24/10).
        pcm = np.concatenate([son(("silence", 1.2)), sonnerie(2), son(("voix", 1.2), ("silence", 1.0))])
        voix_entendue, t, _ = self.ouvrir(pcm)
        self.assertTrue(voix_entendue)
        self.assertGreater(t, 11)

    def test_une_sonnerie_sans_reponse_rend_la_main(self):
        pcm = np.concatenate([sonnerie(2), son(("silence", 10.0))])
        voix_entendue, t, _ = self.ouvrir(pcm)
        self.assertFalse(voix_entendue)
        self.assertAlmostEqual(t, 1.5 + 3.5 + 1.5 + module_appel.SILENCE_AU_DECROCHE_S + 3.0, delta=1.0)

    def test_un_accueil_sans_sonnerie_ne_change_pas(self):
        voix_entendue, t, pont = self.ouvrir(son(("silence", 0.4), ("voix", 1.3), ("silence", 1.0)))
        self.assertTrue(voix_entendue)
        self.assertLess(t, 0.7)

    def test_le_silence_sans_sonnerie_ne_change_pas(self):
        voix_entendue, t, _ = self.ouvrir(son(("silence", 5.0)))
        self.assertFalse(voix_entendue)
        self.assertAlmostEqual(t, 2.0, delta=0.15)


class PasDeSessionApresLaFin(unittest.TestCase):
    def appel(self) -> module_appel.Appel:
        appel = module_appel.Appel.__new__(module_appel.Appel)
        appel._verrou = threading.Lock()
        appel._prise_en_main = None
        appel._session_ouverte = False
        appel._fin_lancee_appel = False
        appel._en_ligne = True
        appel._chemin_entrant = None
        appel._ouverture = None
        appel._premier_message = "Allô ?"
        appel._conversation = mock.Mock()
        appel._conversation.config.conversation_config_override = {}
        appel._pont = FauxPont()
        appel.journal = lambda *_: None
        return appel

    @mock.patch.object(module_appel, "SILENCE_AU_DECROCHE_S", 0.2)
    def test_raccroche_pendant_l_attente(self):
        appel = self.appel()
        threading.Timer(0.1, lambda: setattr(appel, "_en_ligne", False)).start()
        appel._ouvrir_conversation()
        appel._conversation.start_session.assert_not_called()
        self.assertFalse(appel._session_ouverte)

    @mock.patch.object(module_appel, "SILENCE_AU_DECROCHE_S", 0.2)
    def test_fin_deja_lancee(self):
        appel = self.appel()
        appel._fin_lancee_appel = True  # _terminer est passé pendant l'attente, la ligne semble encore là
        appel._ouvrir_conversation()
        appel._conversation.start_session.assert_not_called()

    @mock.patch.object(module_appel, "SILENCE_AU_DECROCHE_S", 0.2)
    def test_appel_en_ligne_ouvre(self):
        appel = self.appel()
        appel._ouvrir_conversation()
        appel._conversation.start_session.assert_called_once()


if __name__ == "__main__":
    unittest.main()
