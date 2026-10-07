"""Un téléphone lent ne bloque pas la boucle D-Bus ni ne décroche après un abandon."""
import unittest
from unittest import mock

import dbus
from dbus.proxies import ProxyObject

from pont.ofono import Telephone, dans_glib

MODEM = "/hfp/org/bluez/hci0/dev_00_11_22_33_44_55"
ENTRANT = MODEM + "/voicecall02"


class BusSansReponseDIntrospection:
    def __init__(self):
        self.messages = []

    def activate_name_owner(self, nom):
        return ":1.123"

    def get_object(self, nom, chemin, **kwargs):
        return ProxyObject(self, nom, chemin, **kwargs)

    def call_async(self, service, chemin, interface, methode, signature, args, reponse, erreur, **kwargs):
        message = dbus.lowlevel.MethodCallMessage(service, chemin, interface, methode)
        message.append(*args, signature=signature)
        self.messages.append(methode)
        attente = mock.Mock()
        attente.block.side_effect = AssertionError("l'introspection sans réponse bloque GLib")
        return attente

    def call_blocking(self, service, chemin, interface, methode, signature, args, **kwargs):
        self.messages.append(methode)
        if methode == "GetModems":
            return [(MODEM, {"Type": "hfp", "Online": True})]
        raise AssertionError("aucune autre méthode ne doit attendre sa réponse")


class DecrocheSansAttendreLeReglage(unittest.TestCase):
    def telephone(self):
        telephone = Telephone.__new__(Telephone)
        telephone._bus = mock.Mock()
        telephone._journal = mock.Mock()
        telephone._suivi = telephone._appel = telephone._modem = None
        telephone.modem = lambda: MODEM
        telephone.sur_entrant = mock.Mock()
        telephone._ajoute(ENTRANT, {"State": "incoming", "LineIdentification": "+33639980001"})
        return telephone

    def test_reglage_audio_sans_reponse_ne_retarde_pas_answer(self):
        telephone = self.telephone()
        hf, appel = mock.Mock(), mock.Mock()
        hf.GetProperties.return_value = {"EchoCancelingNoiseReduction": True}

        def reglage(*args, **kwargs):
            self.assertTrue(callable(kwargs.get("reply_handler")), "le réglage attend sa réponse dans GLib")
            self.assertTrue(callable(kwargs.get("error_handler")))
            self.assertLessEqual(kwargs["timeout"], 2)
            # Le téléphone ne répond pas : Answer doit tout de même partir.

        hf.SetProperty.side_effect = reglage
        with mock.patch("pont.ofono.dbus.Interface", side_effect=lambda _, nom: hf if nom == "org.ofono.Handsfree" else appel):
            telephone.repondre(ENTRANT, mock.Mock(), mock.Mock())
        appel.Answer.assert_called_once()

    def test_abandon_pendant_la_lecture_du_modem_ne_decroche_pas(self):
        telephone = self.telephone()
        abandon = False

        def modem():
            nonlocal abandon
            abandon = True
            return MODEM

        telephone.modem = modem
        with mock.patch("pont.ofono.dbus.Interface") as interface:
            with self.assertRaises(RuntimeError):
                telephone.repondre(ENTRANT, mock.Mock(), mock.Mock(), annule=lambda: abandon)
            interface.return_value.Answer.assert_not_called()
        self.assertIsNone(telephone._suivi)

    def test_lecture_du_modem_bornee_avant_answer(self):
        telephone = self.telephone()
        del telephone.modem
        manager, hf, appel = mock.Mock(), mock.Mock(), mock.Mock()

        def lire_modems(**kwargs):
            self.assertLessEqual(kwargs.get("timeout", 25), 2)
            return [(MODEM, {"Type": "hfp", "Online": True})]

        manager.GetModems.side_effect = lire_modems
        interfaces = {"org.ofono.Manager": manager, "org.ofono.Handsfree": hf, "org.ofono.VoiceCall": appel}
        with mock.patch("pont.ofono.dbus.Interface", side_effect=lambda _, nom: interfaces[nom]):
            telephone.repondre(ENTRANT, mock.Mock(), mock.Mock())
        appel.Answer.assert_called_once()

    def test_echec_ecnr_et_volumes_journalises_sans_identifiants(self):
        telephone = self.telephone()
        hf, volume, appel = mock.Mock(), mock.Mock(), mock.Mock()
        interfaces = {"org.ofono.Handsfree": hf, "org.ofono.CallVolume": volume, "org.ofono.VoiceCall": appel}
        with mock.patch("pont.ofono.dbus.Interface", side_effect=lambda _, nom: interfaces[nom]):
            telephone.repondre(ENTRANT, mock.Mock(), mock.Mock())
            hf.SetProperty.call_args.kwargs["error_handler"](Exception("réponse privée du téléphone"))
            lecture = volume.GetProperties.call_args.kwargs
            self.assertTrue(callable(lecture["reply_handler"]))
            self.assertLessEqual(lecture["timeout"], 2)
            lecture["reply_handler"]({"MicrophoneVolume": 50, "SpeakerVolume": 25, "Muted": False, "Prive": "réponse privée"})
        appel.Answer.assert_called_once()
        journal = str(telephone._journal.call_args_list)
        self.assertIn("ECNR non confirmée", journal)
        self.assertIn("micro 50", journal)
        self.assertIn("écoute 25", journal)
        self.assertNotIn("privée", journal)
        self.assertNotIn("dev_", journal)

    def test_proxies_dbus_sans_introspection_ne_different_pas_answer(self):
        telephone = self.telephone()
        del telephone.modem
        bus = BusSansReponseDIntrospection()
        telephone._bus = bus
        telephone.repondre(ENTRANT, mock.Mock(), mock.Mock())
        self.assertEqual(bus.messages, ["GetModems", "SetProperty", "Answer"])

    def test_proxies_dbus_sans_introspection_ne_different_pas_dial(self):
        telephone = self.telephone()
        telephone._retire(ENTRANT)
        del telephone.modem
        bus = BusSansReponseDIntrospection()
        telephone._bus = bus
        telephone.composer("+33639980001", mock.Mock(), mock.Mock())
        self.assertEqual(bus.messages, ["GetModems", "SetProperty", "Dial"])

    def test_raccrochage_sans_introspection_et_sans_attente(self):
        telephone = self.telephone()
        bus = BusSansReponseDIntrospection()
        telephone._bus = bus
        suivi = telephone._suivi = mock.Mock()
        telephone._appel = ENTRANT
        with mock.patch("pont.ofono.GLib.idle_add", side_effect=lambda callback: callback()):
            telephone.raccrocher(suivi)
        self.assertEqual(bus.messages, ["Hangup"])


class TravailExpire(unittest.TestCase):
    def test_decroche_en_file_expire_ne_part_pas_quand_glib_reprend(self):
        callbacks = []
        decrocher = mock.Mock()
        with mock.patch("pont.ofono.GLib.idle_add", side_effect=lambda callback: callbacks.append(callback)):
            with self.assertRaises(TimeoutError):
                dans_glib(decrocher, delai=0)
        callbacks[0]()  # la boucle repart après l'abandon du service
        decrocher.assert_not_called()


if __name__ == "__main__":
    unittest.main()
