"""Appels entrants : détection, canal son gardé pendant la décision, décroché d'un prospect connu, jamais de
recomposition ni de plafond, numéro masqué au journal, question à l'application. Sans téléphone ni D-Bus."""
import http.client
import json
import os
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from pont.appel import Appel
from pont.ofono import CVSD, LigneOccupee, Telephone, masquer
from pont.plafond import Plafond
from pont.service import Service, demander_entrant

MODEM = "/hfp/org/bluez/hci0/dev_00_11_22_33_44_55"
SORTANT = MODEM + "/voicecall01"
ENTRANT = MODEM + "/voicecall02"
NUMERO = "+33639980001"
APPEL = "00000000-0000-4000-8000-000000000002"
ACCUEIL = "Allô, oui bonjour, Lou à l'appareil."


def telephone() -> tuple[Telephone, list[str]]:
    lignes: list[str] = []
    t = Telephone.__new__(Telephone)
    t._bus = mock.Mock()
    t._journal = lambda *morceaux: lignes.append(" ".join(map(str, morceaux)))
    t._modem = None
    t._appel = None
    t._suivi = None
    t._raison = "inconnue"
    t.sur_entrant = mock.Mock()
    t.modem = lambda: MODEM
    t._couper_traitement_du_telephone = mock.Mock()
    return t, lignes


def canal() -> int:
    """Un descripteur réel, pour vérifier qu'il est fermé ou gardé (l'autre bout est fermé tout de suite)."""
    lecture, ecriture = os.pipe()
    os.close(ecriture)
    return lecture


def ouvert(fd: int) -> bool:
    try:
        os.fstat(fd)
        return True
    except OSError:
        return False


class Detection(unittest.TestCase):
    def test_entrant_pendant_une_composition_non_rattache(self):
        t, _ = telephone()
        suivi, echec = mock.Mock(), mock.Mock()
        with mock.patch("pont.ofono.dbus.Interface") as interface:
            t.composer(NUMERO, suivi, echec)
            t._ajoute(ENTRANT, {"State": "incoming", "LineIdentification": "+33639980009"})
            self.assertIsNone(t._appel)
            suivi.etat_change.assert_not_called()
            t.sur_entrant.assert_not_called()  # un sortant est en cours : il sonne sans réponse
            # Le refus de Dial arrive encore jusqu'à l'appel : l'entrant ne l'a pas masqué.
            interface.return_value.Dial.call_args.kwargs["error_handler"](Exception("refus"))
        echec.assert_called_once_with("refus")
        self.assertFalse(t.libre())  # l'entrant sonne toujours

    def test_sortant_rattache_en_composition(self):
        t, _ = telephone()
        suivi = mock.Mock()
        with mock.patch("pont.ofono.dbus.Interface"):
            t.composer(NUMERO, suivi, mock.Mock())
        t._ajoute(SORTANT, {"State": "dialing"})
        self.assertEqual(t._appel, SORTANT)
        suivi.etat_change.assert_called_once_with("dialing")
        self.assertFalse(t.entrant_en_cours())

    def test_entrant_pendant_un_sortant_actif_ignore_et_canal_refuse(self):
        t, _ = telephone()
        suivi = mock.Mock()
        t._suivi, t._appel, t._modem = suivi, SORTANT, MODEM
        t._ajoute(ENTRANT, {"State": "waiting", "LineIdentification": NUMERO})
        t._propriete("State", "incoming", chemin=ENTRANT)
        t._retire(ENTRANT + "-autre")
        suivi.etat_change.assert_not_called()
        t.sur_entrant.assert_not_called()
        t._retire(SORTANT)  # le sortant se termine, l'entrant sonne encore
        suivi.termine.assert_called_once()
        fd = canal()
        t._nouvelle_connexion(fd, CVSD)
        self.assertFalse(ouvert(fd))
        t.sur_entrant.assert_not_called()  # jamais évalué : arrivé pendant un appel
        self.assertFalse(t.libre())
        self.assertTrue(t.entrant_en_cours())
        t._retire(ENTRANT)
        self.assertTrue(t.libre())
        self.assertFalse(t.entrant_en_cours())

    def test_composer_refuse_pendant_un_entrant(self):
        t, _ = telephone()
        t._ajoute(ENTRANT, {"State": "incoming", "LineIdentification": NUMERO})
        with mock.patch("pont.ofono.dbus.Interface") as interface, self.assertRaises(RuntimeError):
            t.composer(NUMERO, mock.Mock(), mock.Mock())
        interface.return_value.Dial.assert_not_called()

    def test_numero_annonce_brut(self):
        t, _ = telephone()
        t._ajoute(ENTRANT, {"State": "incoming", "LineIdentification": "0639980001"})
        t.sur_entrant.assert_called_once_with(ENTRANT, "0639980001", 1)  # l'application normalise
        self.assertFalse(t.libre())
        self.assertTrue(t.entrant_en_cours())

    def test_numero_arrive_apres_l_appel(self):
        t, _ = telephone()
        with mock.patch("pont.ofono.GLib") as glib:
            t._ajoute(ENTRANT, {"State": "incoming"})
        t.sur_entrant.assert_not_called()
        delai = glib.timeout_add.call_args.args
        t._propriete("LineIdentification", NUMERO, chemin=ENTRANT)
        t.sur_entrant.assert_called_once_with(ENTRANT, NUMERO, 1)
        delai[1](*delai[2:])  # le délai d'attente du numéro expire ensuite : rien de plus
        t.sur_entrant.assert_called_once()

    def test_numero_masque_ou_absent_on_laisse_sonner(self):
        for identification in ("withheld", None):
            with self.subTest(identification=identification):
                t, _ = telephone()
                proprietes = {"State": "incoming"}
                if identification:
                    proprietes["LineIdentification"] = identification
                with mock.patch("pont.ofono.GLib") as glib:
                    t._ajoute(ENTRANT, proprietes)
                if not identification:
                    delai = glib.timeout_add.call_args.args
                    delai[1](*delai[2:])
                t.sur_entrant.assert_not_called()
                fd = canal()
                t._nouvelle_connexion(fd, CVSD)
                self.assertFalse(ouvert(fd))
                t._bus.get_object.assert_not_called()  # ni Answer ni Hangup : il sonne

    def test_sans_service_l_entrant_sonne(self):
        t, _ = telephone()
        t.sur_entrant = None  # commande de diagnostic : personne pour décider
        t._ajoute(ENTRANT, {"State": "incoming", "LineIdentification": NUMERO})
        fd = canal()
        t._nouvelle_connexion(fd, CVSD)
        self.assertFalse(ouvert(fd))

    def test_numero_masque_au_journal(self):
        t, lignes = telephone()
        t._ajoute(ENTRANT, {"State": "incoming", "LineIdentification": NUMERO})
        t2, lignes2 = telephone()
        t2._suivi, t2._appel = mock.Mock(), SORTANT
        t2._ajoute(ENTRANT, {"State": "waiting", "LineIdentification": "0639980001"})
        self.assertTrue(lignes and lignes2)
        for ligne in lignes + lignes2:
            self.assertNotIn("39980001", ligne)
        for numero in ("", "12", "withheld", "+33639980001"):
            with self.subTest(numero=numero):
                self.assertNotIn("39980", masquer(numero))


class MemeCheminAutreAppel(unittest.TestCase):
    """oFono réutilise le chemin d'un appel retiré : une décision tardive ne vise que l'appel qu'elle concernait."""

    def test_decision_tardive_ne_decroche_pas_l_appelant_suivant(self):
        t, _ = telephone()
        t._ajoute(ENTRANT, {"State": "incoming", "LineIdentification": NUMERO})
        premier = t.sur_entrant.call_args.args[2]
        t._retire(ENTRANT)  # il raccroche pendant la question à l'application
        t._ajoute(ENTRANT, {"State": "incoming", "LineIdentification": "+33639980009"})
        second = t.sur_entrant.call_args.args[2]
        self.assertNotEqual(premier, second)
        fd = canal()
        t._nouvelle_connexion(fd, CVSD)
        with mock.patch("pont.ofono.dbus.Interface") as interface:
            with self.assertRaises(RuntimeError):
                t.repondre(ENTRANT, mock.Mock(), mock.Mock(), premier)
            t.laisser_sonner(ENTRANT, premier)
            interface.return_value.Answer.assert_not_called()
        self.assertTrue(ouvert(fd))  # la décision du second est toujours attendue : son canal reste gardé
        suivi = mock.Mock()
        with mock.patch("pont.ofono.dbus.Interface"):
            t.repondre(ENTRANT, suivi, mock.Mock(), second)
        suivi.nouvelle_connexion.assert_called_once_with(fd, CVSD)
        os.close(fd)

    def test_numero_attendu_d_un_appel_retire(self):
        t, _ = telephone()
        with mock.patch("pont.ofono.GLib") as glib:
            t._ajoute(ENTRANT, {"State": "incoming"})
        delai = glib.timeout_add.call_args.args
        t._retire(ENTRANT)
        t._ajoute(ENTRANT, {"State": "incoming", "LineIdentification": NUMERO})
        t.sur_entrant.reset_mock()
        t._entrant_annonce = False
        delai[1](*delai[2:])  # le délai du premier expire : il n'annonce pas le second
        t.sur_entrant.assert_not_called()


class CanalPendantLaDecision(unittest.TestCase):
    def setUp(self):
        self.t, _ = telephone()
        self.t._ajoute(ENTRANT, {"State": "incoming", "LineIdentification": NUMERO})

    def test_garde_puis_branche_au_decroche(self):
        t = self.t
        fd = canal()
        t._nouvelle_connexion(fd, CVSD)
        self.assertTrue(ouvert(fd))  # ni fermé ni lu : la décision est en cours
        ordre: list[str] = []
        t._couper_traitement_du_telephone.side_effect = lambda: ordre.append("traitement coupé")
        suivi = mock.Mock()
        suivi.nouvelle_connexion.side_effect = lambda *_: ordre.append("canal branché")
        with mock.patch("pont.ofono.dbus.Interface") as interface:
            interface.return_value.Answer.side_effect = lambda **_: ordre.append("Answer")
            t.repondre(ENTRANT, suivi, mock.Mock())
        self.assertEqual(ordre, ["traitement coupé", "canal branché", "Answer"])
        suivi.nouvelle_connexion.assert_called_once_with(fd, CVSD)
        self.assertEqual(interface.call_args.args[1], "org.ofono.VoiceCall")
        t._bus.get_object.assert_called_with("org.ofono", ENTRANT, introspect=False)
        kwargs = interface.return_value.Answer.call_args.kwargs
        self.assertIn("reply_handler", kwargs)  # asynchrone, comme Dial
        self.assertIn("error_handler", kwargs)
        self.assertEqual(t._appel, ENTRANT)
        self.assertFalse(t.libre())
        self.assertTrue(t.entrant_en_cours())
        t._propriete("State", "active", chemin=ENTRANT)
        suivi.etat_change.assert_called_once_with("active")
        fd2 = canal()
        t._nouvelle_connexion(fd2, CVSD)  # canal rouvert après Answer : le cas normal
        suivi.nouvelle_connexion.assert_called_with(fd2, CVSD)
        os.close(fd)
        os.close(fd2)
        t._retire(ENTRANT)
        suivi.termine.assert_called_once()
        self.assertTrue(t.libre())
        self.assertFalse(t.entrant_en_cours())

    def test_echec_d_answer_signale(self):
        suivi, echec = mock.Mock(), mock.Mock()
        with mock.patch("pont.ofono.dbus.Interface") as interface:
            self.t.repondre(ENTRANT, suivi, echec)
            interface.return_value.Answer.call_args.kwargs["error_handler"](Exception("refus"))
        echec.assert_called_once_with("refus")
        self.assertFalse(self.t.libre())  # il sonne peut-être encore : la ligne reste occupée jusqu'à sa fin
        self.t._retire(ENTRANT)
        suivi.termine.assert_not_called()  # l'appel a déjà su l'échec
        self.assertTrue(self.t.libre())

    def test_appelant_parti_pendant_answer(self):
        suivi, echec = mock.Mock(), mock.Mock()
        with mock.patch("pont.ofono.dbus.Interface") as interface:
            self.t.repondre(ENTRANT, suivi, echec)
            self.t._retire(ENTRANT)
            interface.return_value.Answer.call_args.kwargs["error_handler"](Exception("plus d'appel"))
        suivi.termine.assert_called_once()
        echec.assert_not_called()  # une seule fin
        self.assertTrue(self.t.libre())

    def test_ferme_quand_on_laisse_sonner(self):
        fd = canal()
        self.t._nouvelle_connexion(fd, CVSD)
        self.t.laisser_sonner(ENTRANT)
        self.assertFalse(ouvert(fd))
        self.t._bus.get_object.assert_not_called()  # pas de Hangup : il sonne jusqu'à la messagerie
        self.assertFalse(self.t.libre())
        fd2 = canal()
        self.t._nouvelle_connexion(fd2, CVSD)
        self.assertFalse(ouvert(fd2))
        self.t._retire(ENTRANT)
        self.assertTrue(self.t.libre())

    def test_ferme_si_l_appelant_raccroche_pendant_la_decision(self):
        fd = canal()
        self.t._nouvelle_connexion(fd, CVSD)
        self.t._retire(ENTRANT)
        self.assertFalse(ouvert(fd))
        self.assertTrue(self.t.libre())
        with self.assertRaises(RuntimeError):
            self.t.repondre(ENTRANT, mock.Mock(), mock.Mock())

    def test_ferme_si_le_telephone_se_deconnecte(self):
        fd = canal()
        self.t._nouvelle_connexion(fd, CVSD)
        self.t._modem_retire(MODEM)
        self.assertFalse(ouvert(fd))
        self.assertTrue(self.t.libre())

    def test_pris_a_la_main_pendant_la_decision(self):
        fd = canal()
        self.t._nouvelle_connexion(fd, CVSD)
        self.t._propriete("State", "active", chemin=ENTRANT)
        self.assertFalse(ouvert(fd))  # le son reste sur le téléphone
        with self.assertRaises(RuntimeError):
            self.t.repondre(ENTRANT, mock.Mock(), mock.Mock())
        self.assertFalse(self.t.libre())
        self.t._retire(ENTRANT)
        self.assertTrue(self.t.libre())

    def test_garde_le_plus_recent(self):
        ancien, recent = canal(), canal()
        self.t._nouvelle_connexion(ancien, CVSD)
        self.t._nouvelle_connexion(recent, CVSD)
        self.assertFalse(ouvert(ancien))
        self.assertTrue(ouvert(recent))
        self.t.laisser_sonner(ENTRANT)
        self.assertFalse(ouvert(recent))


class Raccrocher(unittest.TestCase):
    def test_raccroche_l_appel_suivi_seulement(self):
        t, _ = telephone()
        t._suivi, t._appel, t._modem = mock.Mock(), SORTANT, MODEM
        t._ajoute(ENTRANT, {"State": "waiting", "LineIdentification": NUMERO})
        with mock.patch("pont.ofono.GLib") as glib, mock.patch("pont.ofono.dbus.Interface") as interface:
            glib.idle_add.side_effect = lambda f: f()
            t.raccrocher()
        t._bus.get_object.assert_called_once_with("org.ofono", SORTANT, introspect=False)
        self.assertEqual(interface.call_args.args[1], "org.ofono.VoiceCall")
        interface.return_value.Hangup.assert_called_once()
        interface.return_value.HangupAll.assert_not_called()

    def test_demande_perimee_ne_touche_pas_l_entrant_decroche(self):
        t, _ = telephone()
        ancien = mock.Mock()
        t._modem = MODEM  # reste posé après chaque appel
        t._ajoute(ENTRANT, {"State": "incoming", "LineIdentification": NUMERO})
        with mock.patch("pont.ofono.dbus.Interface"):
            t.repondre(ENTRANT, mock.Mock(), mock.Mock(), t._entrant_generation)
        with mock.patch("pont.ofono.GLib") as glib, mock.patch("pont.ofono.dbus.Interface") as interface:
            glib.idle_add.side_effect = lambda f: f()
            t.raccrocher(ancien)  # l'appel précédent, fini, finit de vider sa phrase de fin
        interface.return_value.Hangup.assert_not_called()
        interface.return_value.HangupAll.assert_not_called()

    def test_demande_perimee_ne_rejette_pas_l_entrant_qui_sonne(self):
        for suivi in (mock.Mock(), None):
            with self.subTest(avec_suivi=suivi is not None):
                t, _ = telephone()
                t._modem = MODEM
                t._ajoute(ENTRANT, {"State": "incoming", "LineIdentification": NUMERO})
                with mock.patch("pont.ofono.GLib") as glib, mock.patch("pont.ofono.dbus.Interface") as interface:
                    glib.idle_add.side_effect = lambda f: f()
                    t.raccrocher(suivi)
                interface.return_value.HangupAll.assert_not_called()
                interface.return_value.Hangup.assert_not_called()

    def test_avant_la_reponse_a_dial_hangupall(self):
        t, _ = telephone()
        suivi = mock.Mock()
        with mock.patch("pont.ofono.dbus.Interface"):
            t.composer(NUMERO, suivi, mock.Mock())
        with mock.patch("pont.ofono.GLib") as glib, mock.patch("pont.ofono.dbus.Interface") as interface:
            glib.idle_add.side_effect = lambda f: f()
            t.raccrocher(suivi)
        interface.return_value.HangupAll.assert_called_once()


def appel_entrant(plafond: Plafond | None = None) -> tuple[Appel, mock.Mock, list[str]]:
    lignes: list[str] = []
    appel = Appel.__new__(Appel)
    telephone_ = mock.Mock()
    appel._telephone = telephone_
    appel._numero = NUMERO
    appel._chemin_entrant = ENTRANT
    appel._plafond = plafond
    appel._annule = False
    appel._tentatives = 0
    appel._en_ligne = False
    appel._canal = False
    appel._relance = False
    appel._canal_absent = False
    appel._conversation = mock.Mock()
    appel._premier_message = ACCUEIL
    appel.journal = lambda *morceaux: lignes.append(" ".join(map(str, morceaux)))
    appel.evenements = []
    appel._nouveau = threading.Condition()
    appel._termine = threading.Event()
    appel._terminer = mock.Mock()
    appel._rappels = mock.Mock()
    return appel, telephone_, lignes


class ModeEntrant(unittest.TestCase):
    def setUp(self):
        self._dossier = tempfile.TemporaryDirectory()
        self.plafond = Plafond(Path(self._dossier.name) / "historique.json", 1, 1)

    def tearDown(self):
        self._dossier.cleanup()

    def test_decroche_hors_plafond(self):
        appel, tel, lignes = appel_entrant(self.plafond)
        with mock.patch("pont.appel.GLib"):
            appel.decrocher()
        tel.repondre.assert_called_once_with(ENTRANT, appel, appel._decroche_echoue, None, annule=mock.ANY)
        self.assertFalse(tel.repondre.call_args.kwargs["annule"]())
        tel.composer.assert_not_called()
        self.assertIsNone(self.plafond.refus())  # un entrant ne compte pas
        self.assertTrue(appel._en_ligne)
        self.assertEqual(appel.sens, "entrant")
        self.assertFalse(any("39980001" in l for l in lignes), lignes)
        self.assertTrue(any("…01" in l for l in lignes), lignes)

    def test_ne_se_compose_jamais(self):
        appel, tel, _ = appel_entrant(self.plafond)
        with mock.patch("pont.appel.GLib"), self.assertRaises(RuntimeError):
            appel.lancer()
        tel.composer.assert_not_called()
        self.assertIsNone(self.plafond.refus())

    def test_canal_absent_termine_sans_recomposer(self):
        appel, tel, _ = appel_entrant()
        appel._en_ligne = True
        with mock.patch("pont.appel.threading.Thread") as fil:
            appel._verifier_canal()
            self.assertFalse(appel._relance)
            self.assertTrue(appel._canal_absent)
            tel.raccrocher.assert_called_once()
            appel.termine("local")
        self.assertIs(fil.call_args.kwargs["target"], appel._terminer)
        tel.composer.assert_not_called()
        tel.reconnecter.assert_not_called()

    def test_echec_du_decroche_termine_sans_recomposer(self):
        for echec in ("_decroche_echoue", "_composition_echouee"):
            with self.subTest(echec=echec):
                appel, tel, _ = appel_entrant()
                with mock.patch("pont.appel.threading.Thread") as fil:
                    getattr(appel, echec)("refus")
                fil.assert_called_once()
                self.assertIs(fil.call_args.kwargs["target"], appel._terminer)
                self.assertEqual(fil.call_args.kwargs["args"], ("décroché impossible",))
                tel.composer.assert_not_called()
                tel.reconnecter.assert_not_called()

    def test_relance_impossible(self):
        appel, tel, _ = appel_entrant()
        with mock.patch("pont.appel.dans_glib") as glib:
            appel._reconnecter_et_relancer()
        glib.assert_not_called()
        tel.reconnecter.assert_not_called()
        appel._terminer.assert_called_once()

    def test_appelant_parti_avant_le_decroche_la_fin_part(self):
        appel, tel, _ = appel_entrant()
        tel.repondre.side_effect = RuntimeError("l'appel entrant ne sonne plus")
        with mock.patch("pont.appel.GLib"), mock.patch("pont.appel.threading.Thread") as fil:
            appel.decrocher()
        fil.assert_called_once()
        self.assertEqual(fil.call_args.kwargs["args"], ("décroché impossible",))
        self.assertFalse(appel._en_ligne)
        tel.laisser_sonner.assert_called_once_with(ENTRANT, None)

    def test_annule_une_seule_fin(self):
        appel, tel, _ = appel_entrant()
        with mock.patch("pont.appel.GLib"), mock.patch("pont.appel.threading.Thread") as fil:
            appel.annuler()  # la boucle D-Bus a tardé : le service abandonne
            appel.decrocher()  # puis le décroché programmé finit par passer
            appel.termine("remote")
        fil.assert_called_once()  # une seule fin vers l'application
        tel.repondre.assert_not_called()
        tel.laisser_sonner.assert_called_once_with(ENTRANT, None)  # le canal gardé revient au téléphone

    def test_ouverture_immediate_par_l_accueil(self):
        appel, _, _ = appel_entrant()
        appel._pont = mock.Mock()
        appel._verrou = threading.Lock()
        appel._prise_en_main = None
        appel._conversation.config.conversation_config_override = {}
        appel._ouvrir_conversation()
        appel._pont.prospect_parle.wait.assert_not_called()  # c'est Mina qui décroche : pas d'attente
        appel._pont.oublier_accueil.assert_called_once()  # un « allô » dit pendant l'ouverture couperait l'accueil
        self.assertEqual(appel._conversation.config.conversation_config_override["agent"], {"first_message": ACCUEIL})
        appel._conversation.start_session.assert_called_once()

    def test_bilan_porte_le_sens(self):
        appel, _, _ = appel_entrant()
        del appel._terminer
        appel._session_ouverte = False
        appel._pont = mock.Mock(premier_son_de_mina=None, fin_accueil=None)
        appel._codec = None
        appel._decroche = None
        appel._ouverture_prise = "premier message"
        appel._prise_en_main = None
        appel._enregistrement = "/inexistant/appel.wav"
        appel._pings = []
        appel._terminer("remote")
        bilan = appel._rappels.fin.call_args.args[0]
        self.assertEqual(bilan["sens"], "entrant")
        self.assertEqual(bilan["raison"], "prospect")

    def test_fin_de_mina_apres_le_raccroche_du_prospect(self):
        appel, tel, _ = appel_entrant()
        appel._verrou = threading.Lock()
        appel._fin_session = False
        appel._prise_en_main = None
        appel._en_ligne = True
        appel._pont = mock.Mock()
        appel._pont.sortie_vide.return_value = False

        def le_prospect_raccroche(_):
            appel._en_ligne = False

        with (
            mock.patch("pont.appel.threading.Thread", side_effect=lambda target, **_: mock.Mock(start=target)),
            mock.patch("pont.appel.time.sleep", side_effect=le_prospect_raccroche),
            mock.patch("pont.appel.time.monotonic", side_effect=[0, 0, 9]),
        ):
            appel._fin_de_session()
        tel.raccrocher.assert_not_called()  # l'appel est fini : rien à raccrocher, surtout pas l'appel suivant

    def test_raccrochage_lie_a_l_appel(self):
        appel, tel, _ = appel_entrant()
        appel.raccrocher()
        tel.raccrocher.assert_called_once_with(appel)

    def test_sortant_inchange(self):
        appel = Appel.__new__(Appel)
        self.assertFalse(appel.entrant)
        self.assertEqual(appel.sens, "sortant")


class FausseApplication:
    """L'application web, réduite à sa route `/api/pont/entrants`."""

    def __init__(self, code: int = 200, corps: dict | None = None, attente: float = 0):
        self.requetes: list[tuple[str, str, dict]] = []
        application = self

        class Gestionnaire(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                longueur = int(self.headers.get("content-length", 0))
                application.requetes.append((self.path, self.headers.get("authorization"), json.loads(self.rfile.read(longueur))))
                time.sleep(attente)
                donnees = json.dumps(corps or {}).encode()
                try:
                    self.send_response(code)
                    self.send_header("content-type", "application/json")
                    self.send_header("content-length", str(len(donnees)))
                    self.end_headers()
                    self.wfile.write(donnees)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.serveur = ThreadingHTTPServer(("127.0.0.1", 0), Gestionnaire)
        self.serveur.daemon_threads = True
        threading.Thread(target=self.serveur.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.serveur.server_address[1]}"

    def fermer(self):
        self.serveur.shutdown()
        self.serveur.server_close()


DECROCHER = {"decrocher": True, "appelId": APPEL, "variables": {"prospect_nom": "Gîte Exemple"}, "motsCles": ["Exemple"], "premierMessage": ACCUEIL}


class QuestionALApplication(unittest.TestCase):
    def interroger(self, **fausse) -> tuple[dict | None, FausseApplication]:
        application = FausseApplication(**fausse)
        try:
            return demander_entrant(application.url, "s", NUMERO, delai=0.5)[0], application
        finally:
            application.fermer()

    def test_prospect_connu(self):
        reponse, application = self.interroger(corps=DECROCHER)
        self.assertEqual(application.requetes, [("/api/pont/entrants", "Bearer s", {"numero": NUMERO})])
        self.assertEqual(reponse["appelId"], APPEL)
        self.assertEqual(reponse["variables"], {"prospect_nom": "Gîte Exemple"})
        self.assertEqual(reponse["motsCles"], ["Exemple"])
        self.assertEqual(reponse["premierMessage"], ACCUEIL)

    def test_inconnu_ou_erreur_on_laisse_sonner(self):
        for fausse in (
            {"corps": {"decrocher": False}},
            {"code": 500, "corps": {"erreur": "x"}},
            {"code": 401, "corps": DECROCHER},
            {"corps": {**DECROCHER, "appelId": "pas-un-uuid"}},
            {"corps": {**DECROCHER, "decrocher": "oui"}},
        ):
            with self.subTest(fausse=fausse):
                self.assertIsNone(self.interroger(**fausse)[0])

    def test_delai_depasse(self):
        debut = time.monotonic()
        self.assertIsNone(self.interroger(corps=DECROCHER, attente=2)[0])
        self.assertLess(time.monotonic() - debut, 1.9)

    def test_application_absente(self):
        self.assertIsNone(demander_entrant("http://127.0.0.1:9", "s", NUMERO, delai=0.5)[0])

    def test_reponse_tronquee(self):
        with mock.patch("pont.service.urllib.request.urlopen", side_effect=http.client.IncompleteRead(b"{")):
            self.assertIsNone(demander_entrant("http://127.0.0.1:9", "s", NUMERO, delai=0.5)[0])


def service(web: str) -> tuple[Service, list[str]]:
    lignes: list[str] = []
    s = Service.__new__(Service)
    s._web = web
    s._secret = "s"
    s._cles = {"ELEVENLABS_API_KEY": "k", "ELEVENLABS_AGENT_ID": "a"}
    s._dossier = Path(tempfile.mkdtemp())
    s._appels = {}
    s._verrou = threading.Lock()
    s._telephone = mock.Mock()
    s._telephone.en_appel.return_value = False
    s._plafond = mock.Mock()
    s.journal = lambda *morceaux: lignes.append(" ".join(map(str, morceaux)))
    return s, lignes


def executer(fonction, delai=10):
    return fonction()


class Decision(unittest.TestCase):
    def evaluer(self, s: Service) -> mock.Mock:
        with mock.patch("pont.service.dans_glib", side_effect=executer), mock.patch("pont.service.Appel") as fabrique:
            fabrique.return_value.fini.return_value = False
            fabrique.return_value.attendre_fin.return_value = True
            s._evaluer_entrant(ENTRANT, NUMERO, 1)
        return fabrique

    def test_prospect_connu_decroche(self):
        application = FausseApplication(corps=DECROCHER)
        s, lignes = service(application.url)
        fabrique = self.evaluer(s)
        application.fermer()
        fabrique.assert_called_once()
        self.assertEqual(fabrique.call_args.kwargs["entrant"], ENTRANT)
        self.assertEqual(fabrique.call_args.kwargs["generation"], 1)
        self.assertNotIn("plafond", fabrique.call_args.kwargs)  # le plafond ne compte que les sortants
        self.assertEqual(fabrique.call_args.args[1], NUMERO)
        self.assertEqual(fabrique.call_args.args[6], APPEL)
        fabrique.return_value.decrocher.assert_called_once()
        s._telephone.laisser_sonner.assert_not_called()
        self.assertFalse(any("39980001" in l for l in lignes), lignes)

    def test_inconnu_ou_erreur_on_laisse_sonner(self):
        for fausse in ({"corps": {"decrocher": False}}, {"code": 503, "corps": {}}):
            with self.subTest(fausse=fausse):
                application = FausseApplication(**fausse)
                s, lignes = service(application.url)
                fabrique = self.evaluer(s)
                application.fermer()
                fabrique.assert_not_called()
                s._telephone.laisser_sonner.assert_called_once_with(ENTRANT, 1)
                s._telephone.repondre.assert_not_called()
                self.assertEqual(s._appels, {})
                self.assertFalse(any("39980001" in l for l in lignes), lignes)

    def test_telephone_occupe_sans_question(self):
        application = FausseApplication(corps=DECROCHER)
        s, _ = service(application.url)
        s._telephone.en_appel.return_value = True
        fabrique = self.evaluer(s)
        application.fermer()
        self.assertEqual(application.requetes, [])  # aucune ligne `appels` créée pour rien
        fabrique.assert_not_called()
        s._telephone.laisser_sonner.assert_called_once_with(ENTRANT, 1)

    def test_appel_precedent_pas_encore_clos(self):
        application = FausseApplication(corps=DECROCHER)
        s, _ = service(application.url)
        precedent = mock.Mock()
        precedent.fini.return_value = False
        s._appels["00000000-0000-4000-8000-000000000003"] = precedent
        self.evaluer(s)
        application.fermer()
        self.assertEqual(application.requetes, [])
        s._telephone.laisser_sonner.assert_called_once_with(ENTRANT, 1)

    def test_decroche_trop_lent_annule(self):
        application = FausseApplication(corps=DECROCHER)
        s, _ = service(application.url)

        def boucle_figee(fonction, delai=10):
            if getattr(fonction, "__name__", "") == "<lambda>":
                return fonction()
            raise TimeoutError("la boucle D-Bus ne répond pas")

        with mock.patch("pont.service.dans_glib", side_effect=boucle_figee), mock.patch("pont.service.Appel") as fabrique:
            fabrique.return_value.attendre_fin.return_value = True
            s._evaluer_entrant(ENTRANT, NUMERO)
        application.fermer()
        fabrique.return_value.annuler.assert_called_once()  # sa fin part vers l'application

    def test_composition_refusee_pendant_un_entrant(self):
        s, _ = service("http://127.0.0.1:9")
        s._telephone.libre.return_value = False
        s._telephone.entrant_en_cours.return_value = True
        code, corps = s.appeler({"appelId": APPEL, "numero": NUMERO})
        self.assertEqual(code, 409)
        self.assertIn("entrant", corps["erreur"])

    def test_entrant_arrive_juste_avant_la_composition(self):
        """Libre à la lecture, l'entrant arrive avant que la boucle GLib ne compose : 409, pas 503, rien de compté."""
        s, _ = service("http://127.0.0.1:9")
        s._telephone.libre.return_value = True
        s._plafond.refus.return_value = None
        with mock.patch("pont.service.Appel") as fabrique, mock.patch("pont.service.dans_glib", side_effect=LigneOccupee("un appel entrant sonne")):
            code, corps = s.appeler({"appelId": APPEL, "numero": NUMERO})
        self.assertEqual(code, 409)
        self.assertIn("entrant", corps["erreur"])
        self.assertEqual(s._appels, {})
        fabrique.return_value.annuler.assert_not_called()


class LancerPendantUnEntrant(unittest.TestCase):
    def test_ne_compte_pas_au_plafond(self):
        with tempfile.TemporaryDirectory() as dossier:
            plafond = Plafond(Path(dossier) / "historique.json", 1, 1)
            appel, tel, _ = appel_entrant(plafond)
            appel._chemin_entrant = None  # un sortant
            tel.libre.return_value = False  # un prospect rappelle entre-temps
            with mock.patch("pont.appel.GLib"), self.assertRaises(LigneOccupee):
                appel.lancer()
            tel.composer.assert_not_called()
            self.assertIsNone(plafond.refus())
            self.assertEqual(appel._tentatives, 0)


if __name__ == "__main__":
    unittest.main()
