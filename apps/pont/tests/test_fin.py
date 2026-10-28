"""La fin rejoint l'application même si la reconnexion ou l'arrêt de la session échoue."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pont.appel import Appel
from pont.service import RappelsWeb


class FinApresPanne(unittest.TestCase):
    def setUp(self):
        dossier = self.enterContext(tempfile.TemporaryDirectory())
        pont = self.enterContext(mock.patch("pont.appel.Pont"))
        pont.return_value.premier_son_de_mina = None
        pont.return_value.fin_accueil = None
        conversation = self.enterContext(mock.patch("pont.appel.ConversationPont"))
        self.conversation = conversation.return_value
        self.conversation.wait_for_session_end.return_value = None
        self.telephone = mock.Mock()
        self.rappels = RappelsWeb("http://127.0.0.1:9", "secret-fictif", "00000000-0000-4000-8000-000000000001", mock.Mock())
        self.poster = self.enterContext(mock.patch.object(self.rappels, "_poster"))
        self.appel = Appel(
            self.telephone, "+33639980001", {}, [],
            {"ELEVENLABS_API_KEY": "cle-fictive", "ELEVENLABS_AGENT_ID": "agent-fictif"},
            Path(dossier), "appel-fictif", self.rappels,
        )

    def test_canal_absent_puis_reconnexion_refusee_la_fin_part(self):
        appel = self.appel
        appel._en_ligne = True
        appel._tentatives = 1
        # La session est annoncée ouverte alors que start_session attend encore l'URL signée.
        appel._session_ouverte = True
        self.conversation.wait_for_session_end.side_effect = RuntimeError("Session not started.")
        self.telephone.reconnecter.side_effect = RuntimeError("org.bluez.Error.Failed: br-connection-refused")
        appel._verifier_canal()
        self.telephone.raccrocher.assert_called_once_with(appel)
        self.assertTrue(appel._relance)
        # Même chemin qu'au retrait de l'appel par oFono, sans fil concurrent dans le test.
        with mock.patch("pont.appel.threading.Thread", side_effect=lambda target, **_: mock.Mock(start=target)):
            appel.termine("local")
        self.assertTrue(appel.attendre_fin(0))
        self.poster.assert_called_once_with("fin", {"raison": "composition impossible", "conversationId": None, "codec": None})
        appel.pont.fermer.assert_called_once()

    def test_arret_sdk_en_echec_ne_perd_pas_la_fin(self):
        self.appel._session_ouverte = True
        self.conversation.end_session.side_effect = RuntimeError("arrêt de session impossible (test)")
        self.appel._terminer("remote")
        self.assertTrue(self.appel.fini())
        self.poster.assert_called_once_with("fin", {"raison": "prospect", "conversationId": None, "codec": None})

    def test_refus_avant_conversation_envoie_la_fin_avant_les_reessais(self):
        appel = self.appel
        appel._en_ligne = True
        appel._tentatives = 1
        self.telephone.reconnecter.side_effect = RuntimeError("br-connection-refused")
        ordre = []
        self.poster.side_effect = lambda *args: ordre.append("fin")
        self.telephone.reconnecter_avec_attente.side_effect = lambda **kwargs: ordre.append("reconnexion")
        appel._verifier_canal()
        with mock.patch("pont.appel.threading.Thread", side_effect=lambda target, **_: mock.Mock(start=target)), \
                mock.patch.object(appel, "lancer") as composer:
            appel.termine("téléphone déconnecté")
        self.assertEqual(ordre, ["fin", "reconnexion"])
        self.assertTrue(appel.fini())
        self.poster.assert_called_once_with("fin", {"raison": "composition impossible", "conversationId": None, "codec": None})
        self.telephone.reconnecter_avec_attente.assert_called_once_with(apres_echec=True)
        self.conversation.end_session.assert_not_called()
        self.conversation.wait_for_session_end.assert_not_called()
        composer.assert_not_called()

    def test_conversation_terminee_identifiant_transmis(self):
        self.appel._session_ouverte = True
        self.conversation.wait_for_session_end.return_value = "conv-fictive"
        self.appel._terminer("remote")
        self.assertTrue(self.appel.fini())
        self.poster.assert_called_once_with("fin", {"raison": "prospect", "conversationId": "conv-fictive", "codec": None})


if __name__ == "__main__":
    unittest.main()
