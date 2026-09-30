"""L'outil etape_script : numéro lu et borné, événement `etape` dans le fil, rien vers l'application.

Sans téléphone ni D-Bus : l'appel est construit sans son constructeur.
"""
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from pont.appel import ETAPE_MAX, Appel, numero_d_etape


class Numero(unittest.TestCase):
    def test_numeros_lisibles(self):
        for valeur, attendu in ((2, 2), ("3", 3), (" 4 ", 4), (2.0, 2), (1, 1), (ETAPE_MAX, ETAPE_MAX)):
            with self.subTest(valeur=valeur):
                self.assertEqual(numero_d_etape(valeur), attendu)

    def test_hors_du_plan_ou_illisible(self):
        for valeur in (0, -1, ETAPE_MAX + 1, 47, 2.5, "abc", "", "²", "2.0", None, True, False, [2], {"n": 2}):
            with self.subTest(valeur=valeur):
                self.assertIsNone(numero_d_etape(valeur))


class RappelsEspions:
    def __init__(self):
        self.evenements = []
        self.outils = []

    def evenement(self, type_, donnees):
        self.evenements.append((type_, donnees))

    def outil(self, nom, parametres):
        self.outils.append(nom)
        return ""

    def conversation_ouverte(self, conversation_id):
        pass

    def fin(self, bilan):
        pass


def appel_sans_telephone() -> tuple[Appel, RappelsEspions]:
    appel = Appel.__new__(Appel)
    rappels = RappelsEspions()
    appel._rappels = rappels
    appel.journal = lambda *morceaux: None
    appel.evenements = []
    appel._nouveau = threading.Condition()
    appel._termine = threading.Event()
    return appel, rappels


class Gestionnaire(unittest.TestCase):
    def test_etape_dans_le_fil(self):
        appel, rappels = appel_sans_telephone()
        self.assertEqual(appel._etape({"numero": 2, "tool_call_id": "x"}), "")
        self.assertEqual(len(appel.evenements), 1)
        e = appel.evenements[0]
        self.assertEqual({k: v for k, v in e.items() if k != "t"}, {"type": "etape", "numero": 2})
        self.assertIsInstance(e["t"], int)
        self.assertEqual(appel.suivre(0, delai=0), [e])
        self.assertEqual(rappels.outils, [])  # aucun aller-retour vers l'application

    def test_etape_illisible_ignoree(self):
        appel, rappels = appel_sans_telephone()
        for parametres in ({"numero": 0}, {"numero": "deux"}, {}):
            with self.subTest(parametres=parametres):
                self.assertEqual(appel._etape(parametres), "")
        self.assertEqual(appel.evenements, [])
        self.assertEqual(rappels.evenements, [])


class Enregistrement(unittest.TestCase):
    def test_outil_enregistre_aupres_du_sdk(self):
        with tempfile.TemporaryDirectory() as dossier, mock.patch("pont.appel.Pont"), mock.patch("pont.appel.ElevenLabs"), mock.patch(
            "pont.appel.ConversationPont"
        ) as conversation:
            appel = Appel(
                telephone=mock.Mock(),
                numero="+33600000000",
                variables={},
                mots_cles=[],
                cles={"ELEVENLABS_API_KEY": "k", "ELEVENLABS_AGENT_ID": "a"},
                dossier=Path(dossier),
                nom="essai",
                rappels=RappelsEspions(),
            )
            outils = conversation.call_args.kwargs["client_tools"]
            self.assertEqual(set(outils.tools), {"proposer_creneaux", "reserver_creneau", "etape_script"})
            gestionnaire, asynchrone = outils.tools["etape_script"]
            self.assertFalse(asynchrone)
            self.assertEqual(gestionnaire({"numero": 3}), "")
            self.assertEqual(appel.evenements[-1]["numero"], 3)


if __name__ == "__main__":
    unittest.main()
