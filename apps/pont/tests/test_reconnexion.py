"""Une panne Bluetooth laisse le pont vivant et la ligne récupérable."""
import unittest
from unittest import mock

import dbus

from pont.ofono import Telephone
from pont.service import Service

MODEM = "/hfp/org/bluez/hci0/dev_00_11_22_33_44_55"


class ReconnexionBluetooth(unittest.TestCase):
    def setUp(self):
        self.telephone = Telephone(mock.Mock(), mock.Mock())

    def test_fermeture_du_bus_prive_ne_quitte_pas_le_processus(self):
        bus = mock.Mock()
        appareil = mock.Mock()
        appareil.Connect.side_effect = dbus.DBusException("br-connection-refused")
        with mock.patch("pont.ofono.dbus.SystemBus", return_value=bus), \
                mock.patch("pont.ofono.dbus.Interface", return_value=appareil), \
                mock.patch("pont.ofono.time.sleep"):
            with self.assertRaises(dbus.DBusException):
                self.telephone.reconnecter(MODEM)
        self.assertEqual(bus.method_calls[0], mock.call.set_exit_on_disconnect(False))
        bus.close.assert_called_once()

    def test_retrait_du_modem_signale_une_seule_fin(self):
        telephone = self.telephone
        telephone._modem = MODEM
        telephone._appel = MODEM + "/voicecall01"
        suivi = telephone._suivi = mock.Mock()
        telephone._modem_retire(MODEM)
        telephone._retire(MODEM + "/voicecall01")
        suivi.termine.assert_called_once_with("téléphone déconnecté")
        self.assertIsNone(telephone._suivi)

    def test_demarrage_hors_ligne_reconnecte_le_telephone_appaire(self):
        service = Service.__new__(Service)
        service.journal = mock.Mock()
        service._telephone = mock.Mock()
        service._telephone.modem.side_effect = RuntimeError("hors ligne")
        service._telephone.modem_connu.return_value = MODEM
        with mock.patch("pont.service.dans_glib", side_effect=lambda f: f()):
            service._annoncer_msbc()
        service._telephone.reconnecter_avec_attente.assert_called_once_with(MODEM)

    def test_reessais_croissants_puis_periodiques_jusqu_au_retour(self):
        telephone = self.telephone
        telephone.libre = mock.Mock(return_value=True)
        telephone.modem_connu = mock.Mock(return_value=MODEM)
        telephone.modem = mock.Mock(side_effect=[RuntimeError("hors ligne")] * 6 + [MODEM])
        telephone.reconnecter = mock.Mock(side_effect=[RuntimeError("refus")] * 6 + [None])
        with mock.patch("pont.ofono.dans_glib", side_effect=lambda f: f()), \
                mock.patch("pont.ofono.time.sleep") as attendre:
            telephone.reconnecter_avec_attente(MODEM)
        self.assertEqual(attendre.call_args_list, [mock.call(s) for s in (5, 15, 30, 60, 120, 120)])
        self.assertEqual(telephone.reconnecter.call_count, 7)
        self.assertFalse(telephone._reconnexion.locked())

    def test_apres_echec_attend_et_ne_coupe_pas_un_telephone_revenu(self):
        telephone = self.telephone
        telephone.libre = mock.Mock(return_value=True)
        telephone.modem = mock.Mock(return_value=MODEM)
        telephone.reconnecter = mock.Mock()
        with mock.patch("pont.ofono.dans_glib", side_effect=lambda f: f()), \
                mock.patch("pont.ofono.time.sleep") as attendre:
            telephone.reconnecter_avec_attente(apres_echec=True)
        attendre.assert_called_once_with(5)
        telephone.reconnecter.assert_not_called()

    def test_un_appel_en_cours_differe_la_reconnexion(self):
        telephone = self.telephone
        telephone.libre = mock.Mock(side_effect=[False, True])
        telephone.modem = mock.Mock(return_value=MODEM)
        telephone.reconnecter = mock.Mock()
        with mock.patch("pont.ofono.dans_glib", side_effect=lambda f: f()), \
                mock.patch("pont.ofono.time.sleep") as attendre:
            telephone.reconnecter_avec_attente(MODEM)
        attendre.assert_called_once_with(5)
        telephone.reconnecter.assert_not_called()

    def test_une_seule_boucle_de_reconnexion(self):
        with self.telephone._reconnexion, mock.patch("pont.ofono.dans_glib") as executer:
            self.telephone.reconnecter_avec_attente(MODEM)
        executer.assert_not_called()

    def test_pas_de_telephone_appaire_pas_de_reconnexion(self):
        telephone = self.telephone
        telephone.libre = mock.Mock(return_value=True)
        telephone.modem_connu = mock.Mock(return_value=None)
        telephone.reconnecter = mock.Mock()
        with mock.patch("pont.ofono.dans_glib", side_effect=lambda f: f()):
            telephone.reconnecter_avec_attente()
        telephone.reconnecter.assert_not_called()

    def test_telephone_appaire_retrouve_dans_bluez_sans_modem_ofono(self):
        manager = mock.Mock()
        manager.GetModems.return_value = []
        manager.GetManagedObjects.return_value = {
            "/org/bluez/hci0/dev_00_11_22_33_44_00": {"org.bluez.Device1": {"Paired": True, "UUIDs": []}},
            MODEM.removeprefix("/hfp"): {"org.bluez.Device1": {
                "Paired": True, "UUIDs": ["0000111f-0000-1000-8000-00805f9b34fb"],
            }},
        }
        with mock.patch("pont.ofono.dbus.Interface", return_value=manager):
            self.assertEqual(self.telephone.modem_connu(), MODEM)
