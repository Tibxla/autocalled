#!/usr/bin/env python3
"""Spike palier 3 : agent audio oFono (CVSD 8 kHz, 16 bits signé, mono).

Enregistre ce qui arrive du téléphone et y renvoie des bips (440 Hz, 0,5 s sur 1 s).
Les écritures sont cadencées par les lectures : un bloc écrit pour un bloc lu.

Usage : python3 -u audio.py, puis composer (/usr/share/ofono/scripts/dial-number).
Les enregistrements vont dans data/spike-bluetooth/ (hors dépôt).
"""
import math
import os
import select
import struct
import sys
import threading
import time
import wave

import dbus
import dbus.service
import dbus.mainloop.glib
from gi.repository import GLib

CHEMIN = "/autocalled/audio"
CVSD = 1
TAUX = 8000
DOSSIER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../data/spike-bluetooth")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def bips():
    """Générateur infini d'échantillons : bip 440 Hz une demi-seconde sur deux."""
    n = 0
    while True:
        dans_bip = (n % TAUX) < TAUX // 2
        v = int(8000 * math.sin(2 * math.pi * 440 * n / TAUX)) if dans_bip else 0
        yield v
        n += 1


def accepter(fd):
    """oFono transmet le canal SCO en attente (BT_DEFER_SETUP) : s'il n'est pas
    encore inscriptible, lire un octet l'accepte (même geste que PulseAudio)."""
    p = select.poll()
    p.register(fd, select.POLLOUT)
    if p.poll(0):
        log("canal déjà accepté")
        return
    os.read(fd, 1)
    log("canal accepté, attente de la liaison SCO")
    # La liaison s'établit ensuite de façon asynchrone : attendre qu'elle soit prête.
    evts = p.poll(5000)
    log("liaison prête" if evts else "liaison toujours absente après 5 s", evts)


def pomper(fd, codec):
    os.makedirs(DOSSIER, exist_ok=True)
    os.set_blocking(fd, True)
    accepter(fd)
    nom = os.path.join(DOSSIER, time.strftime("appel-%H%M%S.wav"))
    source = bips()
    lus = ecrits = blocs = 0
    tailles = set()
    debut = time.monotonic()
    with wave.open(nom, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TAUX)
        try:
            while True:
                bloc = os.read(fd, 1024)
                if not bloc:
                    break
                w.writeframes(bloc)
                lus += len(bloc)
                tailles.add(len(bloc))
                n = len(bloc) // 2
                sortie = struct.pack(f"<{n}h", *(next(source) for _ in range(n)))
                ecrits += os.write(fd, sortie)
                blocs += 1
                if blocs == 1:
                    log("premier bloc reçu :", len(bloc), "octets")
        except OSError as e:
            log("fin du canal :", e)
    duree = time.monotonic() - debut
    os.close(fd)
    log(f"canal fermé après {duree:.1f} s ; lus {lus} o, écrits {ecrits} o, "
        f"tailles de bloc {sorted(tailles)}, débit entrant {lus / max(duree, 0.001):.0f} o/s")
    log("enregistrement :", nom)


class AgentAudio(dbus.service.Object):
    @dbus.service.method("org.ofono.HandsfreeAudioAgent", in_signature="ohy", out_signature="")
    def NewConnection(self, card, fd, codec):
        fd = fd.take()
        log("NewConnection", card, "codec", int(codec), "fd", fd)
        threading.Thread(target=pomper, args=(fd, int(codec)), daemon=True).start()

    @dbus.service.method("org.ofono.HandsfreeAudioAgent", in_signature="", out_signature="")
    def Release(self):
        log("Release")
        GLib.MainLoop().quit()


dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
bus = dbus.SystemBus()
AgentAudio(bus, CHEMIN)
gestionnaire = dbus.Interface(bus.get_object("org.ofono", "/"), "org.ofono.HandsfreeAudioManager")
gestionnaire.Register(CHEMIN, dbus.Array([dbus.Byte(CVSD)], signature="y"))
log("agent audio enregistré (CVSD)")
try:
    GLib.MainLoop().run()
finally:
    try:
        gestionnaire.Unregister(CHEMIN)
    except dbus.DBusException:
        pass
    sys.exit(0)
