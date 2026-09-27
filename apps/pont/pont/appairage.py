"""Appairage du téléphone passerelle depuis l'application (ADR 0007).

Une fenêtre de trois minutes, filtrée sur l'adresse du téléphone : le serveur devient visible et
appairable, un agent BlueZ accepte cette seule adresse et refuse les autres, le code à six chiffres est
affiché dans l'application pour être comparé à celui du téléphone. Dès que l'appairage aboutit, le
téléphone est marqué de confiance (il se reconnectera seul) et la fenêtre se referme.

Tout se passe dans le thread GLib.
"""
import re
import time
from collections.abc import Callable
from typing import Any

import dbus
import dbus.service
from gi.repository import GLib

CHEMIN_AGENT = "/autocalled/pont/appairage"
DUREE_S = 180
ADRESSE = re.compile(r"^[0-9A-F]{2}(:[0-9A-F]{2}){5}$")


class _Refus(dbus.DBusException):
    _dbus_error_name = "org.bluez.Error.Rejected"


class _Agent(dbus.service.Object):
    def __init__(self, bus, appairage: "Appairage"):
        super().__init__(bus, CHEMIN_AGENT)
        self._a = appairage

    def _verifier(self, appareil):
        if not str(appareil).endswith(self._a.suffixe):
            self._a.journal("appairage refusé :", str(appareil).rsplit("/", 1)[-1])
            raise _Refus("appareil non autorisé")

    @dbus.service.method("org.bluez.Agent1", in_signature="", out_signature="")
    def Release(self):
        pass

    @dbus.service.method("org.bluez.Agent1", in_signature="os", out_signature="")
    def AuthorizeService(self, appareil, uuid):
        self._verifier(appareil)

    @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="s")
    def RequestPinCode(self, appareil):
        self._verifier(appareil)
        return "0000"

    @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="u")
    def RequestPasskey(self, appareil):
        self._verifier(appareil)
        return dbus.UInt32(0)

    @dbus.service.method("org.bluez.Agent1", in_signature="ouq", out_signature="")
    def DisplayPasskey(self, appareil, code, saisi):
        self._a.code = f"{int(code):06d}"

    @dbus.service.method("org.bluez.Agent1", in_signature="os", out_signature="")
    def DisplayPinCode(self, appareil, code):
        self._a.code = str(code)

    @dbus.service.method("org.bluez.Agent1", in_signature="ou", out_signature="")
    def RequestConfirmation(self, appareil, code):
        self._verifier(appareil)
        self._a.code = f"{int(code):06d}"

    @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="")
    def RequestAuthorization(self, appareil):
        self._verifier(appareil)

    @dbus.service.method("org.bluez.Agent1", in_signature="", out_signature="")
    def Cancel(self):
        pass


class Appairage:
    def __init__(self, bus: dbus.SystemBus, journal: Callable[..., None]):
        self._bus = bus
        self.journal = journal
        self._agent: _Agent | None = None
        self._minuteur: int | None = None
        self.etat = "ferme"  # ferme, ouvert, reussi, expire
        self.adresse: str | None = None
        self.suffixe = ""
        self.code: str | None = None
        self._fin = 0.0
        bus.add_signal_receiver(
            self._proprietes, "PropertiesChanged", "org.freedesktop.DBus.Properties", "org.bluez", path_keyword="chemin"
        )

    def _adaptateur(self) -> str:
        objets = dbus.Interface(self._bus.get_object("org.bluez", "/"), "org.freedesktop.DBus.ObjectManager")
        for chemin, interfaces in objets.GetManagedObjects().items():
            if "org.bluez.Adapter1" in interfaces and interfaces["org.bluez.Adapter1"].get("Powered"):
                return str(chemin)
        raise RuntimeError("aucune clé Bluetooth allumée")

    def _regler(self, **proprietes) -> None:
        adaptateur = dbus.Interface(self._bus.get_object("org.bluez", self._adaptateur()), "org.freedesktop.DBus.Properties")
        for nom, valeur in proprietes.items():
            adaptateur.Set("org.bluez.Adapter1", nom, valeur)

    def resume(self) -> dict[str, Any]:
        resume: dict[str, Any] = {"etat": self.etat, "adresse": self.adresse, "code": self.code}
        if self.etat == "ouvert":
            resume["restantS"] = max(0, round(self._fin - time.monotonic()))
        return resume

    def ouvrir(self, adresse: str) -> dict[str, Any]:
        adresse = adresse.strip().upper()
        if not ADRESSE.match(adresse):
            raise ValueError("adresse Bluetooth attendue sous la forme 12:34:56:78:9A:BC")
        self.fermer()
        self.adresse, self.suffixe, self.code = adresse, "dev_" + adresse.replace(":", "_"), None
        self._agent = _Agent(self._bus, self)
        gestionnaire = dbus.Interface(self._bus.get_object("org.bluez", "/org/bluez"), "org.bluez.AgentManager1")
        gestionnaire.RegisterAgent(CHEMIN_AGENT, "DisplayYesNo")
        gestionnaire.RequestDefaultAgent(CHEMIN_AGENT)
        self._regler(
            PairableTimeout=dbus.UInt32(DUREE_S),
            DiscoverableTimeout=dbus.UInt32(DUREE_S),
            Pairable=dbus.Boolean(True),
            Discoverable=dbus.Boolean(True),
        )
        self.etat = "ouvert"
        self._fin = time.monotonic() + DUREE_S
        self._minuteur = GLib.timeout_add_seconds(DUREE_S, self._expirer)
        self.journal("appairage ouvert pour", adresse)
        return self.resume()

    def fermer(self, etat: str = "ferme") -> dict[str, Any]:
        if self._minuteur:
            GLib.source_remove(self._minuteur)
            self._minuteur = None
        try:
            self._regler(Discoverable=dbus.Boolean(False), Pairable=dbus.Boolean(False))
        except (dbus.DBusException, RuntimeError):
            pass
        if self._agent:
            try:
                dbus.Interface(
                    self._bus.get_object("org.bluez", "/org/bluez"), "org.bluez.AgentManager1"
                ).UnregisterAgent(CHEMIN_AGENT)
            except dbus.DBusException:
                pass
            self._agent.remove_from_connection()
            self._agent = None
        if self.etat == "ouvert":
            self.etat = etat
        return self.resume()

    def oublier(self, adresse: str) -> None:
        adresse = adresse.strip().upper()
        if not ADRESSE.match(adresse):
            raise ValueError("adresse Bluetooth invalide")
        adaptateur = self._adaptateur()
        chemin = f"{adaptateur}/dev_{adresse.replace(':', '_')}"
        dbus.Interface(self._bus.get_object("org.bluez", adaptateur), "org.bluez.Adapter1").RemoveDevice(chemin)
        self.journal("téléphone oublié :", adresse)

    def _expirer(self) -> bool:
        self._minuteur = None
        self.journal("fenêtre d'appairage expirée")
        self.fermer("expire")
        return False

    def _proprietes(self, interface, changees, invalidees, chemin=None):
        if (
            self.etat == "ouvert"
            and interface == "org.bluez.Device1"
            and str(chemin).endswith(self.suffixe)
            and changees.get("Paired")
        ):
            dbus.Interface(self._bus.get_object("org.bluez", chemin), "org.freedesktop.DBus.Properties").Set(
                "org.bluez.Device1", "Trusted", dbus.Boolean(True)
            )
            self.journal("téléphone appairé et marqué de confiance :", self.adresse)
            self.fermer("reussi")
