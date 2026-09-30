"""Le premier message envoyé par l'application : validé par le pont, « Allô ? » à défaut. Sans téléphone ni D-Bus."""
import unittest

from pont.appel import PREMIER_MESSAGE_PAR_DEFAUT, premier_message_valide


class PremierMessage(unittest.TestCase):
    def test_phrase_gardee_sur_une_ligne(self):
        self.assertEqual(premier_message_valide("  Oui, bonjour ?\n "), "Oui, bonjour ?")

    def test_absent_ou_invalide(self):
        for valeur in (None, "", "   ", 42, ["Allô ?"], "a" * 301):
            with self.subTest(valeur=valeur):
                self.assertEqual(premier_message_valide(valeur), PREMIER_MESSAGE_PAR_DEFAUT)

    def test_longueur_limite(self):
        self.assertEqual(premier_message_valide("a" * 300), "a" * 300)


if __name__ == "__main__":
    unittest.main()
