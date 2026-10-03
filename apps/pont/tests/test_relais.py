"""La ligne prêtée à un autre service local : agent et adresse de rappel par appel, appel hors plafond, outils client
relayés quel que soit leur nom, appels entrants de certains numéros demandés d'abord à ce service. Sans D-Bus."""
import os
import tempfile
import threading
import time
import unittest
import wave
from pathlib import Path
from unittest import mock

from pont.appel import OutilsClient
from pont.service import (
    RappelsWeb,
    adresse_locale,
    demander_entrant,
    forme_e164,
    lire_relais_entrants,
    options_de_l_appel,
)
from tests.test_entrant import APPEL, DECROCHER, ENTRANT, NUMERO, FausseApplication, appel_entrant, executer, service

AGENT = "agent_0000test0000"
RAPPELS = "http://127.0.0.1:3040/pont/appels"
PRETE = {**DECROCHER, "agentId": AGENT, "rappels": RAPPELS, "horsPlafond": True}


class AdresseLocale(unittest.TestCase):
    def test_locales(self):
        for valeur, attendu in (
            ("http://127.0.0.1:3040/pont/appels", "http://127.0.0.1:3040/pont/appels"),
            ("http://localhost:3040/pont/appels/", "http://localhost:3040/pont/appels"),
            ("http://127.0.0.1:3040", "http://127.0.0.1:3040"),
            ("http://127.0.0.1:65535/a_b-c.d~e", "http://127.0.0.1:65535/a_b-c.d~e"),
        ):
            with self.subTest(valeur=valeur):
                self.assertEqual(adresse_locale(valeur), attendu)

    def test_tout_le_reste_refuse(self):
        for valeur in (
            "https://127.0.0.1:3040/pont",
            "http://exemple.com:3040/pont",
            "http://127.0.0.2:3040/pont",
            "http://0.0.0.0:3040/pont",
            "http://127.0.0.1/pont",  # port obligatoire
            "http://127.0.0.1:0/pont",
            "http://127.0.0.1:70000/pont",
            "http://127.0.0.1:3040@exemple.com/pont",
            "http://jeton@127.0.0.1:3040/pont",
            "http://localhost.exemple.com:3040/pont",
            "http://127.0.0.1:3040/pont?x=1",
            "http://127.0.0.1:3040/pont#x",
            "http://127.0.0.1:3040/po nt",
            "http://127.0.0.1:3040/pont\n",
            "http://127.0.0.1:3040/" + "a" * 200,
            "",
            None,
            3040,
            ["http://127.0.0.1:3040/pont"],
        ):
            with self.subTest(valeur=valeur):
                self.assertIsNone(adresse_locale(valeur))


class Options(unittest.TestCase):
    def test_absentes_comportement_actuel(self):
        for corps in ({}, {"agentId": None, "rappels": None, "horsPlafond": None}, {"horsPlafond": False}):
            with self.subTest(corps=corps):
                self.assertEqual(options_de_l_appel(corps), {"agentId": None, "rappels": None, "horsPlafond": False})

    def test_appel_prete(self):
        self.assertEqual(
            options_de_l_appel({"agentId": AGENT, "rappels": RAPPELS + "/", "horsPlafond": True}),
            {"agentId": AGENT, "rappels": RAPPELS, "horsPlafond": True},
        )

    def test_invalides(self):
        for corps in (
            {"agentId": ""},
            {"agentId": 12},
            {"agentId": "agent ../x"},
            {"agentId": "a" * 101},
            {"rappels": "https://exemple.com/pont"},
            {"rappels": "http://127.0.0.1:3040@exemple.com/"},
            {"rappels": ""},
            {"horsPlafond": "oui"},
            {"horsPlafond": 1},
        ):
            with self.subTest(corps=corps), self.assertRaises(ValueError):
                options_de_l_appel(corps)


class FormeE164(unittest.TestCase):
    def test_formes_du_meme_numero(self):
        for brut in ("+33639980001", "0639980001", "06 39 98 00 01", "06.39.98.00.01", "0033639980001", "+33 6 39 98 00 01"):
            with self.subTest(brut=brut):
                self.assertEqual(forme_e164(brut), NUMERO)

    def test_illisibles(self):
        for brut in ("", "withheld", None, "3240", "0039", "+0639980001", "06399800011", "*#21#"):
            with self.subTest(brut=brut):
                self.assertIsNone(forme_e164(brut))


class RelaisEntrants(unittest.TestCase):
    def test_absente(self):
        for valeur in (None, "", "  "):
            with self.subTest(valeur=valeur):
                self.assertIsNone(lire_relais_entrants(valeur))

    def test_un_ou_plusieurs_numeros(self):
        self.assertEqual(
            lire_relais_entrants(f"{NUMERO}=http://127.0.0.1:3040/pont/entrants"),
            (frozenset({NUMERO}), "http://127.0.0.1:3040/pont/entrants"),
        )
        self.assertEqual(
            lire_relais_entrants(f" {NUMERO} , +33639980002,=http://localhost:3040/pont/entrants/ "),
            (frozenset({NUMERO, "+33639980002"}), "http://localhost:3040/pont/entrants"),
        )

    def test_mal_ecrite_sans_citer_de_numero(self):
        for valeur in (
            NUMERO,
            f"{NUMERO}=",
            "=http://127.0.0.1:3040/pont/entrants",
            "0639980001=http://127.0.0.1:3040/pont/entrants",
            f"{NUMERO};+33639980002=http://127.0.0.1:3040/pont/entrants",
            f"{NUMERO}=https://exemple.com/pont/entrants",
            f"{NUMERO}=http://127.0.0.1:3040/pont/entrants=x",
        ):
            with self.subTest(valeur=valeur), self.assertRaises(ValueError) as erreur:
                lire_relais_entrants(valeur)
            self.assertNotIn("39980001", str(erreur.exception))


class Rappels(unittest.TestCase):
    def test_vers_le_service_local(self):
        local = FausseApplication(corps={"resultat": "Noté."})
        try:
            rappels = RappelsWeb("http://127.0.0.1:9", "s", APPEL, lambda *m: None, base=f"{local.url}/pont/appels")
            rappels.fin({"raison": "prospect", "conversationId": "conv"})
            rappels.conversation_ouverte("conv")
            self.assertEqual(rappels.outil("repondre_par_ecrit", {}), "Noté.")
        finally:
            local.fermer()
        self.assertEqual(
            local.requetes,
            [
                (f"/pont/appels/{APPEL}/fin", "Bearer s", {"raison": "prospect", "conversationId": "conv"}),
                (f"/pont/appels/{APPEL}/conversation", "Bearer s", {"conversationId": "conv"}),
                (f"/pont/appels/{APPEL}/outils", "Bearer s", {"outil": "repondre_par_ecrit", "parametres": {}}),
            ],
        )

    def test_sans_adresse_l_application(self):
        application = FausseApplication(corps={"resultat": "[]"})
        try:
            RappelsWeb(application.url, "s", APPEL, lambda *m: None).outil("proposer_creneaux", {})
        finally:
            application.fermer()
        self.assertEqual(application.requetes[0][0], f"/api/pont/appels/{APPEL}/outils")

    def test_repli_selon_l_outil(self):
        rappels = RappelsWeb("http://127.0.0.1:9", "s", APPEL, lambda *m: None, base="http://127.0.0.1:9/pont/appels")
        self.assertIn("agenda", rappels.outil("proposer_creneaux", {}))
        self.assertNotIn("agenda", rappels.outil("repondre_par_ecrit", {}))


class Outils(unittest.TestCase):
    def executer(self, nom):
        relayes: list[tuple[str, dict]] = []

        def relayer(nom_outil):
            def executer(parametres):
                relayes.append((nom_outil, parametres))
                return "relayé"

            return executer

        outils = OutilsClient(relayer)
        outils.register("etape_script", lambda parametres: "local")
        outils.start()
        recu, fini = [], threading.Event()
        try:
            outils.execute_tool(nom, {"tool_call_id": "t1"}, lambda reponse: (recu.append(reponse), fini.set()))
            self.assertTrue(fini.wait(5))
        finally:
            outils.stop()
        return recu[0], relayes

    def test_outil_inconnu_relaye(self):
        reponse, relayes = self.executer("repondre_par_ecrit")
        self.assertEqual(relayes, [("repondre_par_ecrit", {"tool_call_id": "t1"})])
        self.assertEqual((reponse["result"], reponse["is_error"], reponse["tool_call_id"]), ("relayé", False, "t1"))

    def test_outil_enregistre_traite_ici(self):
        reponse, relayes = self.executer("etape_script")
        self.assertEqual(relayes, [])
        self.assertEqual(reponse["result"], "local")

    def test_nom_illisible_refuse(self):
        for nom in (None, "", "outil inconnu", "a" * 65):
            with self.subTest(nom=nom):
                reponse, relayes = self.executer(nom)
                self.assertEqual(relayes, [])
                self.assertTrue(reponse["is_error"])


class AppelPrete(unittest.TestCase):
    def appeler(self, corps, refus=None):
        s, lignes = service("http://127.0.0.1:9")
        s._telephone.libre.return_value = True
        s._plafond.refus.return_value = refus
        with mock.patch("pont.service.dans_glib", side_effect=executer), mock.patch("pont.service.Appel") as fabrique:
            fabrique.return_value.attendre_fin.return_value = True
            code, reponse = s.appeler({"appelId": APPEL, "numero": NUMERO, **corps})
        return code, reponse, fabrique, s

    def test_agent_rappels_et_hors_plafond(self):
        code, _, fabrique, s = self.appeler({"agentId": AGENT, "rappels": RAPPELS, "horsPlafond": True}, refus="Plafond atteint.")
        self.assertEqual(code, 202)
        kwargs = fabrique.call_args.kwargs
        self.assertEqual(kwargs["agent_id"], AGENT)
        self.assertIsNone(kwargs["plafond"])  # ni refusé ni compté, recomposition comprise
        self.assertEqual(fabrique.call_args.args[7]._base, f"{RAPPELS}/{APPEL}")
        self.assertIs(kwargs["garder_enregistrement"], False)  # son effacé une fois la fin envoyée
        fabrique.return_value.lancer.assert_called_once()

    def test_sans_options_comme_avant(self):
        code, _, fabrique, s = self.appeler({})
        self.assertEqual(code, 202)
        self.assertIsNone(fabrique.call_args.kwargs["agent_id"])
        self.assertIs(fabrique.call_args.kwargs["plafond"], s._plafond)
        self.assertIs(fabrique.call_args.kwargs["garder_enregistrement"], True)
        self.assertEqual(fabrique.call_args.args[7]._base, f"http://127.0.0.1:9/api/pont/appels/{APPEL}")
        code, reponse, fabrique, _ = self.appeler({}, refus="Plafond atteint.")
        self.assertEqual((code, reponse), (429, {"erreur": "Plafond atteint."}))
        fabrique.assert_not_called()

    def test_options_invalides_400(self):
        for corps in (
            {"rappels": "https://exemple.com/pont/appels"},
            {"rappels": "http://127.0.0.1:3040@exemple.com/pont/appels"},
            {"agentId": "../agents"},
            {"horsPlafond": "oui"},
        ):
            with self.subTest(corps=corps):
                code, _, fabrique, s = self.appeler(corps)
                self.assertEqual(code, 400)
                fabrique.assert_not_called()
                self.assertEqual(s._appels, {})


class EntrantRelaye(unittest.TestCase):
    def setUp(self):
        self.relais_ = FausseApplication(corps=PRETE)
        self.web = FausseApplication(corps=DECROCHER)

    def tearDown(self):
        self.relais_.fermer()
        self.web.fermer()

    def relais(self, **fausse):
        self.relais_.fermer()
        self.relais_ = FausseApplication(**fausse)

    def evaluer(self, numero=NUMERO, liste=(NUMERO,), adresse=None):
        s, lignes = service(self.web.url)
        s._relais = (frozenset(liste), adresse or f"{self.relais_.url}/pont/entrants")
        with mock.patch("pont.service.dans_glib", side_effect=executer), mock.patch("pont.service.Appel") as fabrique:
            fabrique.return_value.fini.return_value = False
            fabrique.return_value.attendre_fin.return_value = True
            s._evaluer_entrant(ENTRANT, numero, 1)
        self.assertFalse(any("39980001" in l for l in lignes), lignes)
        return fabrique, s

    def test_pris_par_le_service_local(self):
        fabrique, s = self.evaluer()
        self.assertEqual(self.relais_.requetes, [("/pont/entrants", "Bearer s", {"numero": NUMERO})])
        self.assertEqual(self.web.requetes, [])
        kwargs = fabrique.call_args.kwargs
        self.assertEqual(kwargs["agent_id"], AGENT)
        self.assertEqual(kwargs["entrant"], ENTRANT)
        self.assertNotIn("plafond", kwargs)
        self.assertEqual(fabrique.call_args.args[7]._base, f"{RAPPELS}/{APPEL}")
        self.assertIs(kwargs["garder_enregistrement"], False)
        fabrique.return_value.decrocher.assert_called_once()

    def test_numero_national_demande_en_e164(self):
        self.evaluer(numero="06 39 98 00 01")
        self.assertEqual(self.relais_.requetes, [("/pont/entrants", "Bearer s", {"numero": NUMERO})])
        self.assertEqual(self.web.requetes, [])

    def test_hors_liste_le_service_local_n_est_pas_demande(self):
        fabrique, _ = self.evaluer(liste=("+33639980002",))
        self.assertEqual(self.relais_.requetes, [])
        self.assertEqual(self.web.requetes, [("/api/pont/entrants", "Bearer s", {"numero": NUMERO})])
        self.assertIsNone(fabrique.call_args.kwargs["agent_id"])
        self.assertIs(fabrique.call_args.kwargs["garder_enregistrement"], True)
        self.assertEqual(fabrique.call_args.args[7]._base, f"{self.web.url}/api/pont/appels/{APPEL}")

    def test_sans_decision_l_application_decide(self):
        for fausse in (
            {"corps": {"decrocher": False}},
            {"code": 500, "corps": {}},
            {"corps": {**PRETE, "rappels": "https://exemple.com/pont/appels"}},
            {"corps": {**PRETE, "agentId": 12}},
        ):
            with self.subTest(fausse=fausse):
                self.relais(**fausse)
                self.web.requetes.clear()
                fabrique, _ = self.evaluer(numero="0639980001")
                self.assertEqual(len(self.relais_.requetes), 1)
                self.assertEqual(self.web.requetes, [("/api/pont/entrants", "Bearer s", {"numero": "0639980001"})])  # brut
                self.assertIsNone(fabrique.call_args.kwargs["agent_id"])

    def test_service_local_absent(self):
        self.evaluer(adresse="http://127.0.0.1:9/pont/entrants")
        self.assertEqual(len(self.web.requetes), 1)

    def test_service_local_lent_l_application_dans_le_meme_delai(self):
        self.relais(corps=PRETE, attente=2)
        debut = time.monotonic()
        with mock.patch("pont.service.DELAI_RELAIS_S", 0.3):
            fabrique, _ = self.evaluer()
        self.assertLess(time.monotonic() - debut, 1.9)
        self.assertEqual(len(self.web.requetes), 1)
        self.assertIsNone(fabrique.call_args.kwargs["agent_id"])

    def test_delai_total_inchange(self):
        """Le service local prend sa part, l'application le reste : jamais plus de DELAI_ENTRANT_S en tout."""
        self.relais(corps=PRETE, attente=5)
        self.web.fermer()
        self.web = FausseApplication(corps=DECROCHER, attente=5)
        debut = time.monotonic()
        with mock.patch("pont.service.DELAI_RELAIS_S", 0.3), mock.patch("pont.service.DELAI_ENTRANT_S", 0.8):
            fabrique, s = self.evaluer()
        self.assertLess(time.monotonic() - debut, 1.5)
        fabrique.assert_not_called()
        s._telephone.laisser_sonner.assert_called_once_with(ENTRANT, 1)


class EnregistrementPrete(unittest.TestCase):
    """Un appel prêté ne laisse pas son son dans data/pont : aucune conservation d'Autocalled ne le connaît."""

    def setUp(self):
        self._dossier = tempfile.TemporaryDirectory()
        self.wav = Path(self._dossier.name) / f"{APPEL}.wav"
        with wave.open(str(self.wav), "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(b"\x00" * 6400)

    def tearDown(self):
        self._dossier.cleanup()

    def terminer(self, garder=None):
        appel, _, _ = appel_entrant()
        if garder is not None:
            appel._garder_enregistrement = garder
        self.terminer_avec(appel)
        return appel._rappels.fin.call_args.args[0]

    def test_prete_son_efface_apres_la_fin(self):
        bilan = self.terminer(garder=False)
        self.assertNotIn("enregistrement", bilan)
        self.assertIn("tempsDeReponseS", bilan)
        self.assertFalse(self.wav.exists())

    def test_prete_son_efface_meme_si_la_fin_echoue(self):
        appel, _, _ = appel_entrant()
        appel._garder_enregistrement = False
        appel._rappels.fin.side_effect = RuntimeError("service local en panne (test)")
        with self.assertRaises(RuntimeError):
            self.terminer_avec(appel)
        self.assertFalse(self.wav.exists())

    def terminer_avec(self, appel):
        del appel._terminer
        appel._session_ouverte = False
        appel._pont = mock.Mock(premier_son_de_mina=None, fin_accueil=None)
        appel._codec = None
        appel._decroche = None
        appel._ouverture_prise = None
        appel._prise_en_main = None
        appel._enregistrement = str(self.wav)
        appel._pings = []
        appel._terminer("remote")

    def test_appel_d_autocalled_garde_son_son(self):
        bilan = self.terminer()
        self.assertEqual(bilan["enregistrement"], str(self.wav))
        self.assertTrue(os.path.exists(self.wav))


class QuestionAuServiceLocal(unittest.TestCase):
    def test_contrat_de_l_application(self):
        local = FausseApplication(corps=PRETE)
        try:
            decision, motif = demander_entrant("http://127.0.0.1:9", "s", NUMERO, delai=0.5, adresse=f"{local.url}/pont/entrants")
        finally:
            local.fermer()
        self.assertEqual(local.requetes, [("/pont/entrants", "Bearer s", {"numero": NUMERO})])
        self.assertEqual((decision["agentId"], decision["rappels"], decision["horsPlafond"]), (AGENT, RAPPELS, True))
        self.assertEqual(motif, "pris par le service local")

    def test_l_application_n_envoie_pas_d_options(self):
        application = FausseApplication(corps=DECROCHER)
        try:
            decision, motif = demander_entrant(application.url, "s", NUMERO, delai=0.5)
        finally:
            application.fermer()
        self.assertEqual((decision["agentId"], decision["rappels"], decision["horsPlafond"]), (None, None, False))
        self.assertEqual(motif, "prospect reconnu")


if __name__ == "__main__":
    unittest.main()
