"""Une session refusée coupe la ligne et retient les appels suivants, sans joindre ElevenLabs."""
import threading
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from websockets.exceptions import ConnectionClosedError
from websockets.frames import Close

from pont.appel import Appel, ConversationPont, DELAI_SESSION_S
from pont.disponibilite import AssistanteIndisponible, DisponibiliteAssistante
from pont.service import Service


def quota():
    return ConnectionClosedError(Close(3000, "[quota_exceeded] crédits épuisés (test)"), None)


class RefusSDK(unittest.TestCase):
    def test_exception_dans_le_thread_sdk_signalee(self):
        refus = mock.Mock()
        conversation = ConversationPont(
            mock.Mock(), "agent-fictif", requires_auth=False, audio_interface=mock.Mock(), client_tools=mock.Mock(),
            pont=mock.Mock(), journal=mock.Mock(), ouverte=mock.Mock(), refusee=refus,
        )
        ws = mock.MagicMock()
        ws.__enter__.return_value.send.side_effect = quota()
        with mock.patch("elevenlabs.conversational_ai.conversation.connect", return_value=ws):
            fil = threading.Thread(target=conversation._run, args=("wss://exemple.test",))
            fil.start()
            fil.join(timeout=1)
        self.assertFalse(fil.is_alive())
        refus.assert_called_once()
        self.assertTrue(refus.call_args.args[1])
        self.assertIn("quota_exceeded", refus.call_args.args[0])

    def test_quota_absorbe_par_recv_du_sdk_signale(self):
        refus = mock.Mock()
        conversation = ConversationPont(
            mock.Mock(), "agent-fictif", requires_auth=False, audio_interface=mock.Mock(), client_tools=mock.Mock(),
            pont=mock.Mock(), journal=mock.Mock(), ouverte=mock.Mock(), refusee=refus,
        )
        ws = mock.MagicMock()
        ws.__enter__.return_value.close_code = 3000
        ws.__enter__.return_value.close_reason = "[quota_exceeded] crédits épuisés (test)"
        ws.__enter__.return_value.recv.side_effect = quota()
        with mock.patch("elevenlabs.conversational_ai.conversation.connect", return_value=ws):
            conversation._run("wss://exemple.test")
        refus.assert_called_once_with("websocket 3000 : [quota_exceeded] crédits épuisés (test)", True)


class CoupureEtBlocage(unittest.TestCase):
    def setUp(self):
        dossier = self.enterContext(tempfile.TemporaryDirectory())
        pont = self.enterContext(mock.patch("pont.appel.Pont"))
        pont.return_value.premier_son_de_mina = None
        pont.return_value.fin_accueil = None
        conversation = self.enterContext(mock.patch("pont.appel.ConversationPont"))
        self.conversation = conversation.return_value
        self.telephone = mock.Mock()
        self.rappels = mock.Mock()
        self.heure = 0.0
        self.disponibilite = DisponibiliteAssistante(lambda: self.heure)
        self.appel = Appel(
            self.telephone, "+33639980001", {}, [],
            {"ELEVENLABS_API_KEY": "cle-fictive", "ELEVENLABS_AGENT_ID": "agent-fictif"},
            Path(dossier), "appel-fictif", self.rappels, disponibilite_assistante=self.disponibilite,
        )
        self.appel._en_ligne = True

    def test_quota_raccroche_et_envoie_une_seule_fin_sans_attendre_le_sdk(self):
        # La notification oFono et l'erreur SDK peuvent arriver ensemble.
        self.appel._session_ouverte = True
        self.telephone.raccrocher.side_effect = lambda _: self.appel.termine("local")
        self.appel._session_refusee(str(quota()), True)
        self.assertTrue(self.appel.attendre_fin(1))
        self.appel._session_refusee(str(quota()), True)
        self.telephone.raccrocher.assert_called_once_with(self.appel)
        self.rappels.fin.assert_called_once()
        self.assertEqual(self.rappels.fin.call_args.args[0]["raison"], "assistante indisponible")
        self.assertTrue(self.rappels.fin.call_args.args[0]["assistanteIndisponible"]["quota"])
        self.assertTrue(self.rappels.fin.call_args.args[0]["sansParole"])
        self.conversation.wait_for_session_end.assert_not_called()
        self.assertTrue(self.disponibilite.etat()["quota"])

    def test_quota_entrant_raccroche_sans_recomposition(self):
        self.appel._chemin_entrant = "/entrant-fictif"
        self.test_quota_raccroche_et_envoie_une_seule_fin_sans_attendre_le_sdk()
        self.assertEqual(self.rappels.fin.call_args.args[0]["sens"], "entrant")
        self.telephone.composer.assert_not_called()

    def test_nettoyage_sdk_bloque_ne_retient_pas_la_fin(self):
        liberation = threading.Event()
        self.conversation.end_session.side_effect = lambda: liberation.wait(2)
        self.appel._session_ouverte = True
        try:
            self.appel._session_refusee("quota_exceeded", True)
            self.assertTrue(self.appel.attendre_fin(0.5))
            self.rappels.fin.assert_called_once()
        finally:
            liberation.set()

    def test_session_sans_confirmation_coupee_au_delai(self):
        with mock.patch("pont.appel.attendre_voix", return_value=False), mock.patch("pont.appel.threading.Timer") as minuteur:
            self.appel._ouvrir_conversation()
        self.assertEqual(minuteur.call_args.args[0], DELAI_SESSION_S)
        minuteur.call_args.args[1]()
        self.assertTrue(self.appel.attendre_fin(1))
        self.telephone.raccrocher.assert_called_once_with(self.appel)
        self.assertFalse(self.rappels.fin.call_args.args[0]["assistanteIndisponible"]["quota"])
        self.assertIsNotNone(self.disponibilite.etat())

    def test_start_session_leve_avant_le_thread_la_fin_part_aussi(self):
        self.conversation.start_session.side_effect = quota()
        with mock.patch("pont.appel.attendre_voix", return_value=False), mock.patch("pont.appel.threading.Timer"):
            self.appel._ouvrir_conversation()
        self.assertTrue(self.appel.attendre_fin(1))
        self.telephone.raccrocher.assert_called_once_with(self.appel)
        self.assertTrue(self.rappels.fin.call_args.args[0]["assistanteIndisponible"]["quota"])

    def test_session_reussie_annule_le_delai_et_le_blocage(self):
        self.disponibilite.refuser("quota_exceeded", True)
        self.appel._conversation_ouverte("conversation-fictive")
        self.appel._session_non_ouverte()
        self.assertIsNone(self.disponibilite.etat())
        self.telephone.raccrocher.assert_not_called()

    def test_recomposition_verifie_aussi_le_blocage(self):
        self.disponibilite.refuser("quota_exceeded", True)
        with self.assertRaises(AssistanteIndisponible):
            self.appel.lancer()
        self.telephone.composer.assert_not_called()

    def test_quota_apparu_pendant_la_decision_entrante_laisse_sonner(self):
        self.appel._chemin_entrant = "/entrant-fictif"
        self.appel._en_ligne = False
        self.disponibilite.refuser("quota_exceeded", True)
        self.appel.decrocher()
        self.assertTrue(self.appel.attendre_fin(1))
        self.telephone.repondre.assert_not_called()
        self.telephone.raccrocher.assert_not_called()
        self.telephone.laisser_sonner.assert_called_once_with("/entrant-fictif", None)
        self.assertEqual(self.rappels.fin.call_args.args[0]["raison"], "assistante indisponible")

    def test_arret_avant_retour_url_signee_n_ouvre_pas_de_websocket(self):
        conversation = ConversationPont(
            mock.Mock(), "agent-fictif", requires_auth=False, audio_interface=mock.Mock(), client_tools=mock.Mock(),
            pont=mock.Mock(), journal=mock.Mock(), ouverte=mock.Mock(), refusee=mock.Mock(),
        )
        conversation.end_session()
        with mock.patch("elevenlabs.conversational_ai.conversation.connect") as connexion:
            conversation._run("wss://exemple.test")
        connexion.assert_not_called()

    def test_refus_compositions_et_entrants_puis_expiration(self):
        s = Service.__new__(Service)
        s._assistante = self.disponibilite
        s._verrou = threading.Lock()
        s._telephone = self.telephone
        s.journal = mock.Mock()
        s._appels = {}
        s._plafond = mock.Mock()
        s._plafond.prochain.return_value = None
        s._plafond.refus.return_value = None
        s._reglages = mock.Mock(valeurs={})
        self.telephone.etat.return_value = {}
        self.disponibilite.refuser("quota_exceeded", True)
        with mock.patch("pont.service.dans_glib", side_effect=lambda f: f()):
            self.assertEqual(s.etat()["assistanteIndisponible"], {"raison": "quota_exceeded", "quota": True})
        for _ in range(2):
            code, corps = s.appeler({"appelId": "00000000-0000-4000-8000-000000000001", "numero": "+33639980001"})
            self.assertEqual(code, 424)
            self.assertTrue(corps["assistanteIndisponible"]["quota"])
        with mock.patch.object(s, "_demander_entrant") as question, mock.patch.object(s, "_laisser_sonner") as sonner:
            s._evaluer_entrant("/entrant-fictif", "+33639980001", 1)
        question.assert_not_called()
        sonner.assert_called_once_with("/entrant-fictif", 1)
        self.telephone.composer.assert_not_called()
        self.telephone.repondre.assert_not_called()
        self.heure = 1799
        self.assertIsNotNone(self.disponibilite.etat())
        self.heure = 1800
        self.assertIsNone(self.disponibilite.etat())
