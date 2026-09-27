"""Téléphone passerelle vu par oFono : composer, suivre l'état de l'appel, raccrocher, recevoir le canal son.

Tout appel D-Bus se fait depuis le thread de la boucle GLib (dbus-python n'est pas thread-safe) :
les autres threads passent par `GLib.idle_add`.
"""
from collections.abc import Callable

import dbus
import dbus.service
from gi.repository import GLib

CVSD, MSBC = 1, 2
CHEMIN_AGENT = "/autocalled/pont/audio"


def premier_modem_hfp(bus: dbus.SystemBus) -> str:
    manager = dbus.Interface(bus.get_object("org.ofono", "/"), "org.ofono.Manager")
    for chemin, proprietes in manager.GetModems():
        if proprietes.get("Type") == "hfp" and proprietes.get("Online"):
            return str(chemin)
    raise RuntimeError("aucun téléphone passerelle en ligne : l'iPhone est-il connecté en Bluetooth ?")


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
    """Un appel sortant à la fois sur le modem mains-libres."""

    def __init__(
        self,
        bus: dbus.SystemBus,
        modem: str,
        etat_change: Callable[[str], None],
        appel_termine: Callable[[str], None],
    ):
        self._bus = bus
        self._modem = modem
        self._etat_change = etat_change
        self._appel_termine = appel_termine
        self._appel: str | None = None
        self._raison = "inconnue"
        self._gestionnaire = dbus.Interface(bus.get_object("org.ofono", modem), "org.ofono.VoiceCallManager")
        bus.add_signal_receiver(
            self._propriete, "PropertyChanged", "org.ofono.VoiceCall", "org.ofono", path_keyword="chemin"
        )
        bus.add_signal_receiver(self._retire, "CallRemoved", "org.ofono.VoiceCallManager", "org.ofono", path=modem)
        bus.add_signal_receiver(
            self._raison_fin, "DisconnectReason", "org.ofono.VoiceCall", "org.ofono", path_keyword="chemin"
        )

    def enregistrer_agent_audio(self, agent: AgentAudio) -> None:
        audio = dbus.Interface(self._bus.get_object("org.ofono", "/"), "org.ofono.HandsfreeAudioManager")
        # Le téléphone choisit le codec parmi ceux-ci ; la liste compte aussi à l'établissement de la liaison
        # mains-libres : un agent enregistré après coup n'obtient le mSBC que si la liaison l'avait déjà annoncé.
        audio.Register(CHEMIN_AGENT, dbus.Array([dbus.Byte(MSBC), dbus.Byte(CVSD)], signature="y"))

    def couper_traitement_du_telephone(self) -> None:
        """Le téléphone traite par défaut ce qu'il reçoit du « micro » mains-libres (anti-écho, anti-bruit,
        prévus pour un micro de voiture). Sur une voix de synthèse propre, ce traitement hache ou abîme le
        son (constat du 27/09) ; le pont n'a pas d'écho acoustique à retirer. Réactivé à chaque reconnexion."""
        hf = dbus.Interface(self._bus.get_object("org.ofono", self._modem), "org.ofono.Handsfree")
        if hf.GetProperties().get("EchoCancelingNoiseReduction"):
            hf.SetProperty("EchoCancelingNoiseReduction", dbus.Boolean(False))

    def composer(self, numero: str) -> None:
        self._appel = str(self._gestionnaire.Dial(numero, "default"))

    def raccrocher(self) -> None:
        """Depuis n'importe quel thread."""

        def _faire():
            try:
                self._gestionnaire.HangupAll()
            except dbus.DBusException:
                pass
            return False

        GLib.idle_add(_faire)

    def _propriete(self, nom, valeur, chemin=None):
        if chemin == self._appel and nom == "State":
            self._etat_change(str(valeur))

    def _raison_fin(self, raison, chemin=None):
        if chemin == self._appel:
            self._raison = str(raison)

    def _retire(self, chemin):
        if str(chemin) == self._appel:
            self._appel = None
            self._appel_termine(self._raison)
