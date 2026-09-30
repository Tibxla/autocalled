"""Gardes du pont : numéro composé, origine de la prise de main, plafond à chaque composition, préparation datée,
journal sans données du prospect. Sans téléphone ni D-Bus."""
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from pont.__main__ import lire_preparation
from pont.appel import Appel
from pont.plafond import Plafond
from pont.service import numero_valide, preparer_dossier, prise_de_main_autorisee

OPERATEUR = "operateur@exemple.test"
ORIGINE = "https://serveur.tailnet-exemple.ts.net:8449"


class Numero(unittest.TestCase):
    def test_e164_seulement(self):
        for bon in ("+33600000000", "+14155550123", "+441234567890"):
            with self.subTest(bon=bon):
                self.assertTrue(numero_valide(bon))
        for mauvais in ("**21*+33600000000#", "*#06#", "0600000000", "+0600000000", "+33 6 00 00 00 00", "+336", "", None, 33600000000):
            with self.subTest(mauvais=mauvais):
                self.assertFalse(numero_valide(mauvais))


class PriseDeMain(unittest.TestCase):
    def test_identite_et_origine(self):
        self.assertTrue(prise_de_main_autorisee(OPERATEUR, ORIGINE, OPERATEUR, ORIGINE))
        self.assertTrue(prise_de_main_autorisee(OPERATEUR.upper(), ORIGINE + "/", OPERATEUR, ORIGINE))

    def test_origine_absente_ou_etrangere_refusee(self):
        for origine in (None, "", "https://piege.exemple", "https://serveur.tailnet-exemple.ts.net", "null"):
            with self.subTest(origine=origine):
                self.assertFalse(prise_de_main_autorisee(OPERATEUR, origine, OPERATEUR, ORIGINE))

    def test_sans_origine_configuree_tout_est_refuse(self):
        self.assertFalse(prise_de_main_autorisee(OPERATEUR, ORIGINE, OPERATEUR, None))

    def test_autre_identite_refusee(self):
        self.assertFalse(prise_de_main_autorisee("autre@exemple.test", ORIGINE, OPERATEUR, ORIGINE))
        self.assertFalse(prise_de_main_autorisee(None, ORIGINE, OPERATEUR, ORIGINE))
        self.assertFalse(prise_de_main_autorisee(OPERATEUR, ORIGINE, "", ORIGINE))


def appel_a_composer(plafond: Plafond) -> tuple[Appel, mock.Mock]:
    appel = Appel.__new__(Appel)
    telephone = mock.Mock()
    appel._telephone = telephone
    appel._numero = "+33600000000"
    appel._plafond = plafond
    appel._annule = False
    appel._tentatives = 0
    appel._en_ligne = False
    appel._conversation = mock.Mock()
    appel.journal = lambda *morceaux: None
    appel.evenements = []
    appel._nouveau = threading.Condition()
    appel._termine = threading.Event()
    appel._terminer = mock.Mock()
    appel._rappels = mock.Mock()
    return appel, telephone


class PlafondACompositions(unittest.TestCase):
    def setUp(self):
        self._dossier = tempfile.TemporaryDirectory()
        self.plafond = Plafond(Path(self._dossier.name) / "historique.json", 2, 10)

    def tearDown(self):
        self._dossier.cleanup()

    def test_chaque_composition_compte(self):
        appel, telephone = appel_a_composer(self.plafond)
        with mock.patch("pont.appel.GLib"):
            appel.lancer()
            appel.lancer()  # recomposition après un canal son absent
        self.assertEqual(telephone.composer.call_count, 2)
        self.assertIsNotNone(self.plafond.refus())

    def test_recomposition_refusee_au_plafond(self):
        self.plafond.compter()
        appel, telephone = appel_a_composer(self.plafond)
        with mock.patch("pont.appel.GLib"), mock.patch("pont.appel.threading.Thread") as fil:
            appel.lancer()  # première : la deuxième place du plafond
            appel.lancer()  # recomposition : plafond atteint, on termine sans composer
        self.assertEqual(telephone.composer.call_count, 1)
        self.assertEqual(fil.call_args.kwargs["args"], ("plafond atteint",))

    def test_premiere_composition_refusee_au_plafond(self):
        self.plafond.compter()
        self.plafond.compter()
        appel, telephone = appel_a_composer(self.plafond)
        with mock.patch("pont.appel.GLib"), self.assertRaises(RuntimeError):
            appel.lancer()
        telephone.composer.assert_not_called()

    def test_annule_ne_compose_pas(self):
        appel, telephone = appel_a_composer(self.plafond)
        appel.annuler()
        with mock.patch("pont.appel.GLib"):
            appel.lancer()
        telephone.composer.assert_not_called()
        self.assertTrue(appel.fini())
        self.assertIsNone(self.plafond.refus())


class Preparation(unittest.TestCase):
    def ecrire(self, dossier: str, **champs) -> str:
        chemin = os.path.join(dossier, "variables.json")
        Path(chemin).write_text(json.dumps({"numero": "+33600000000", "variables": {}, **champs}))
        return chemin

    def test_fraiche_puis_effacee(self):
        with tempfile.TemporaryDirectory() as dossier:
            chemin = self.ecrire(dossier, prepareLe=time.time() * 1000)
            self.assertEqual(lire_preparation(chemin)["numero"], "+33600000000")
            self.assertFalse(os.path.exists(chemin))

    def test_perimee_ou_sans_date_refusee(self):
        with tempfile.TemporaryDirectory() as dossier:
            for champs in ({}, {"prepareLe": (time.time() - 3600) * 1000}, {"prepareLe": "hier"}):
                with self.subTest(champs=champs):
                    with self.assertRaises(SystemExit):
                        lire_preparation(self.ecrire(dossier, **champs))


class Dossier(unittest.TestCase):
    def test_dossier_prive(self):
        with tempfile.TemporaryDirectory() as racine:
            dossier = Path(racine) / "data" / "pont"
            dossier.mkdir(parents=True, mode=0o775)
            os.chmod(dossier, 0o775)
            preparer_dossier(dossier)
            self.assertEqual(dossier.stat().st_mode & 0o777, 0o700)


class JournalSansDonnees(unittest.TestCase):
    def test_tour_et_outil_sans_contenu(self):
        lignes = []
        appel = Appel.__new__(Appel)
        appel.journal = lambda *morceaux: lignes.append(" ".join(map(str, morceaux)))
        appel.evenements = []
        appel._nouveau = threading.Condition()
        appel._rappels = mock.Mock()
        appel._rappels.outil.return_value = ""
        appel._tour("prospect", "mon adresse est prenom.nom@exemple.test")
        appel._outil("reserver_creneau")({"email": "prenom.nom@exemple.test", "debut": "x", "tool_call_id": "t"})
        self.assertFalse(any("exemple.test" in l for l in lignes), lignes)
        self.assertEqual(appel.evenements[0]["texte"], "mon adresse est prenom.nom@exemple.test")  # le fil, lui, garde le texte


if __name__ == "__main__":
    unittest.main()
