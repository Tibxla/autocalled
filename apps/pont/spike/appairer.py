#!/usr/bin/env python3
"""Agent BlueZ qui n'accepte que l'adresse passée en argument (spike).

Usage : python3 -u appairer.py <adresse du téléphone passerelle>, puis ouvrir une
fenêtre courte (bluetoothctl discoverable-timeout 180, pairable on, discoverable on),
appairer depuis le téléphone, comparer le code affiché avec le journal, refermer
(pairable off, discoverable off), bluetoothctl trust <adresse>, et arrêter l'agent.
"""
import sys
import dbus
import dbus.service
import dbus.mainloop.glib
from gi.repository import GLib

CHEMIN = "/autocalled/agent"
AUTORISE = "dev_" + sys.argv[1].upper().replace(":", "_")


class Refus(dbus.DBusException):
    _dbus_error_name = "org.bluez.Error.Rejected"


def verifier(device):
    if not str(device).endswith(AUTORISE):
        print("REFUSÉ", device, flush=True)
        raise Refus("appareil non autorisé")


class Agent(dbus.service.Object):
    def _log(self, *a):
        print(*a, flush=True)

    @dbus.service.method("org.bluez.Agent1", in_signature="", out_signature="")
    def Release(self):
        self._log("Release")

    @dbus.service.method("org.bluez.Agent1", in_signature="os", out_signature="")
    def AuthorizeService(self, device, uuid):
        verifier(device)
        self._log("AuthorizeService", device, uuid)

    @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="s")
    def RequestPinCode(self, device):
        verifier(device)
        self._log("RequestPinCode", device)
        return "0000"

    @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="u")
    def RequestPasskey(self, device):
        verifier(device)
        self._log("RequestPasskey", device)
        return dbus.UInt32(0)

    @dbus.service.method("org.bluez.Agent1", in_signature="ouq", out_signature="")
    def DisplayPasskey(self, device, passkey, entered):
        self._log("DisplayPasskey", device, passkey)

    @dbus.service.method("org.bluez.Agent1", in_signature="os", out_signature="")
    def DisplayPinCode(self, device, code):
        self._log("DisplayPinCode", device, code)

    @dbus.service.method("org.bluez.Agent1", in_signature="ou", out_signature="")
    def RequestConfirmation(self, device, passkey):
        verifier(device)
        self._log("RequestConfirmation", device, f"{passkey:06d}")

    @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="")
    def RequestAuthorization(self, device):
        verifier(device)
        self._log("RequestAuthorization", device)

    @dbus.service.method("org.bluez.Agent1", in_signature="", out_signature="")
    def Cancel(self):
        self._log("Cancel")


dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
bus = dbus.SystemBus()
Agent(bus, CHEMIN)
gestionnaire = dbus.Interface(bus.get_object("org.bluez", "/org/bluez"), "org.bluez.AgentManager1")
gestionnaire.RegisterAgent(CHEMIN, "DisplayYesNo")
gestionnaire.RequestDefaultAgent(CHEMIN)
print("agent prêt", flush=True)
GLib.MainLoop().run()
