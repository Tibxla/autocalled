"""Téléphone passerelle vu par oFono : composer, suivre l'état de l'appel, raccrocher, recevoir le canal son.

Tout appel D-Bus se fait depuis le thread de la boucle GLib (dbus-python n'est pas thread-safe) :
les autres threads passent par `dans_glib`.
"""
import os
import threading
import time
from collections.abc import Callable
from typing import Any, Protocol

import dbus
import dbus.service
from gi.repository import GLib

CVSD, MSBC = 1, 2
CHEMIN_AGENT = "/autocalled/pont/audio"


def dans_glib(fonction: Callable[[], Any], delai: float = 10) -> Any:
    """Exécute `fonction` dans le thread GLib et rend son résultat (ou relève son exception)."""
    fini = threading.Event()
    resultat: dict[str, Any] = {}

    def _faire():
        try:
            resultat["valeur"] = fonction()
        except Exception as e:  # relevée dans le thread appelant
            resultat["erreur"] = e
        fini.set()
        return False

    GLib.idle_add(_faire)
    if not fini.wait(delai):
        raise TimeoutError("la boucle D-Bus ne répond pas")
    if "erreur" in resultat:
        raise resultat["erreur"]
    return resultat.get("valeur")


class Suivi(Protocol):
    """Ce que le téléphone signale à l'appel en cours."""

    def etat_change(self, etat: str) -> None: ...
    def termine(self, raison: str) -> None: ...
    def nouvelle_connexion(self, fd: int, codec: int) -> None: ...


class AgentAudio(dbus.service.Object):
    """Reçoit d'oFono le descripteur du canal SCO de chaque appel."""

    def __init__(self, bus: dbus.SystemBus, nouvelle_connexion: Callable[[int, int], None]):
        super().__init__(bus, CHEMIN_AGENT)
        self._nouvelle_connexion = nouvelle_connexion

    @dbus.service.method("org.ofono.HandsfreeAudioAgent", in_signature="ohy", out_signature="")
    def NewConnection(self, card, fd, codec):
        self._nouvelle_connexion(fd.take(), int(codec))

    @dbus.service.method("org.ofono.HandsfreeAudioAgent", in_signature="", out_signature="")
    def Release(self):
        pass


class Telephone:
    """Le téléphone passerelle, un appel sortant à la fois. Un seul objet pour toute la vie du pont."""

    def __init__(self, bus: dbus.SystemBus, journal: Callable[..., None]):
        self._bus = bus
        self._journal = journal
        self._modem: str | None = None
        self._appel: str | None = None
        self._suivi: Suivi | None = None
        self._raison = "inconnue"
        bus.add_signal_receiver(
            self._propriete, "PropertyChanged", "org.ofono.VoiceCall", "org.ofono", path_keyword="chemin"
        )
        bus.add_signal_receiver(
            self._raison_fin, "DisconnectReason", "org.ofono.VoiceCall", "org.ofono", path_keyword="chemin"
        )
        bus.add_signal_receiver(self._retire, "CallRemoved", "org.ofono.VoiceCallManager", "org.ofono")
        bus.add_signal_receiver(self._ajoute, "CallAdded", "org.ofono.VoiceCallManager", "org.ofono")
        bus.add_signal_receiver(self._modem_retire, "ModemRemoved", "org.ofono.Manager", "org.ofono")

    # --- état ------------------------------------------------------------------------------------

    def modem(self) -> str:
        """Recalculé à chaque appel : le chemin change si le téléphone se reconnecte."""
        manager = dbus.Interface(self._bus.get_object("org.ofono", "/"), "org.ofono.Manager")
        for chemin, proprietes in manager.GetModems():
            if proprietes.get("Type") == "hfp" and proprietes.get("Online"):
                return str(chemin)
        raise RuntimeError(
            "aucun téléphone passerelle en ligne : est-il connecté en Bluetooth ? (le pont le reconnecte "
            "pendant une dizaine de secondes après son démarrage)"
        )

    def etat(self) -> dict[str, Any]:
        """Pour l'application : le téléphone, son réseau, l'appel en cours. Depuis le thread GLib."""
        manager = dbus.Interface(self._bus.get_object("org.ofono", "/"), "org.ofono.Manager")
        for chemin, p in manager.GetModems():
            if p.get("Type") != "hfp":
                continue
            interfaces = [str(i) for i in p.get("Interfaces", [])]
            etat: dict[str, Any] = {
                "connecte": bool(p.get("Online")),
                "nom": str(p.get("Name", "")),
                "adresse": str(chemin).rsplit("dev_", 1)[-1].replace("_", ":"),
                "appelEnCours": self._appel is not None,
            }
            objet = self._bus.get_object("org.ofono", chemin)
            if "org.ofono.NetworkRegistration" in interfaces:
                r = dbus.Interface(objet, "org.ofono.NetworkRegistration").GetProperties()
                etat.update(operateur=str(r.get("Name", "")), signal=int(r.get("Strength", 0)))
            if "org.ofono.Handsfree" in interfaces:
                h = dbus.Interface(objet, "org.ofono.Handsfree").GetProperties()
                etat["batterie"] = int(h.get("BatteryChargeLevel", 0)) * 20  # oFono : 0 à 5
            return etat
        return {"connecte": False, "appelEnCours": self._appel is not None}

    def libre(self) -> bool:
        return self._suivi is None

    # --- commandes, depuis le thread GLib ----------------------------------------------------------

    def enregistrer_agent_audio(self) -> None:
        self._agent = AgentAudio(self._bus, self._nouvelle_connexion)
        audio = dbus.Interface(self._bus.get_object("org.ofono", "/"), "org.ofono.HandsfreeAudioManager")
        # Le téléphone choisit le codec parmi ceux-ci ; la liste compte aussi à l'établissement de la liaison
        # mains-libres : un agent enregistré après coup n'obtient le mSBC que si la liaison l'avait déjà annoncé.
        audio.Register(CHEMIN_AGENT, dbus.Array([dbus.Byte(MSBC), dbus.Byte(CVSD)], signature="y"))

    def composer(self, numero: str, suivi: Suivi, echec: Callable[[str], None]) -> None:
        """Demande au téléphone de composer, sans attendre sa réponse : un téléphone dont la liaison s'est figée
        ne répond pas, et un appel D-Bus bloquant figeait tout le pont (29/09). `echec` est appelé si la demande
        est refusée ou reste sans réponse."""
        if self._suivi is not None:
            raise RuntimeError("un appel est déjà en cours")
        self._modem = self.modem()
        self._couper_traitement_du_telephone()
        self._suivi = suivi  # avant Dial : le canal son peut s'ouvrir aussitôt
        self._appel = None
        self._raison = "inconnue"
        gestionnaire = dbus.Interface(self._bus.get_object("org.ofono", self._modem), "org.ofono.VoiceCallManager")

        def reponse(chemin):
            if self._suivi is suivi:
                self._appel = str(chemin)

        def erreur(e):
            if self._suivi is suivi and self._appel is None:
                self._suivi = None
                echec(e.get_dbus_message() if isinstance(e, dbus.DBusException) else str(e))

        gestionnaire.Dial(numero, "default", reply_handler=reponse, error_handler=erreur, timeout=15)

    def raccrocher(self) -> None:
        """Depuis n'importe quel thread."""

        def _faire():
            if self._modem:
                try:
                    dbus.Interface(
                        self._bus.get_object("org.ofono", self._modem), "org.ofono.VoiceCallManager"
                    ).HangupAll()
                except dbus.DBusException:
                    pass
            return False

        GLib.idle_add(_faire)

    def modem_connu(self) -> str | None:
        """Le téléphone passerelle appairé, connecté ou non (pour le reconnecter à distance)."""
        manager = dbus.Interface(self._bus.get_object("org.ofono", "/"), "org.ofono.Manager")
        for chemin, proprietes in manager.GetModems():
            if proprietes.get("Type") == "hfp":
                return str(chemin)
        return None

    def reconnecter(self, modem: str | None = None) -> None:
        """Déconnecte puis reconnecte le téléphone (liaison figée, canal son bloqué, ou liaison établie sans le
        mSBC). Bloquant : hors du thread GLib, sur une connexion D-Bus à part."""
        modem = modem or self._modem
        if not modem:
            return
        appareil = modem.removeprefix("/hfp")  # /hfp/org/bluez/hci1/dev_… → /org/bluez/hci1/dev_…
        bus = dbus.SystemBus(private=True)
        try:
            d = dbus.Interface(bus.get_object("org.bluez", appareil), "org.bluez.Device1")
            try:
                d.Disconnect()
            except dbus.DBusException:
                pass  # déjà déconnecté
            time.sleep(3)
            d.Connect()
            time.sleep(4)  # le temps que la liaison mains-libres se rétablisse
        finally:
            bus.close()

    def _couper_traitement_du_telephone(self) -> None:
        """Le téléphone traite par défaut ce qu'il reçoit du « micro » mains-libres (anti-écho, anti-bruit,
        prévus pour un micro de voiture). Sur une voix de synthèse propre, ce traitement hache ou abîme le
        son (constat du 27/09) ; le pont n'a pas d'écho acoustique à retirer. Réactivé à chaque reconnexion."""
        hf = dbus.Interface(self._bus.get_object("org.ofono", self._modem), "org.ofono.Handsfree")
        if hf.GetProperties().get("EchoCancelingNoiseReduction"):
            hf.SetProperty("EchoCancelingNoiseReduction", dbus.Boolean(False))

    # --- signaux ---------------------------------------------------------------------------------

    def _nouvelle_connexion(self, fd: int, codec: int) -> None:
        if self._suivi is None:
            # Appel que le pont n'a pas composé (reçu sur le téléphone, ou passé à la main) : on refuse le
            # canal pour que le son reste sur le téléphone.
            self._journal("canal son refusé : appel qui n'est pas celui du pont")
            os.close(fd)
            return
        self._suivi.nouvelle_connexion(fd, codec)

    def _ajoute(self, chemin, proprietes):
        # L'appel peut être annoncé avant la réponse à Dial : on le rattache dès son apparition.
        if self._suivi is not None and self._appel is None and str(chemin).startswith(str(self._modem)):
            self._appel = str(chemin)
            etat = proprietes.get("State")
            if etat:
                self._suivi.etat_change(str(etat))

    def _propriete(self, nom, valeur, chemin=None):
        if chemin == self._appel and nom == "State" and self._suivi:
            self._suivi.etat_change(str(valeur))

    def _raison_fin(self, raison, chemin=None):
        if chemin == self._appel:
            self._raison = str(raison)

    def _retire(self, chemin):
        if str(chemin) == self._appel:
            self._terminer(self._raison)

    def _modem_retire(self, chemin):
        # Téléphone déconnecté en plein appel : oFono n'annoncera pas la fin de l'appel.
        if str(chemin) == self._modem and self._suivi is not None:
            self._terminer("téléphone déconnecté")

    def _terminer(self, raison: str) -> None:
        suivi, self._suivi, self._appel = self._suivi, None, None
        if suivi:
            suivi.termine(raison)
