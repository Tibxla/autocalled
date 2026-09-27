"""Pont audio entre le canal SCO (CVSD : 8 kHz, 16 bits signé, mono) et la conversation ElevenLabs.

L'horloge est la boucle SCO : pour chaque bloc lu, on écrit un bloc de même taille, tiré du tampon
de sortie ou complété de silence. Le SDK ne touche jamais le descripteur : `output()` remplit le
tampon, `interrupt()` le vide (sinon Mina continuerait de parler par-dessus le prospect).
"""
import os
import select
import threading
import time
import wave
from collections.abc import Callable

import numpy as np
import soxr
from elevenlabs.conversational_ai.conversation import AudioInterface

TAUX_SCO = 8000
MS_PAR_ENVOI = 100  # blocs envoyés à ElevenLabs : assez courts pour ne pas retarder la fin de tour


def accepter(fd: int) -> None:
    """oFono transmet le canal en attente (BT_DEFER_SETUP) : lire un octet l'accepte, puis la liaison
    s'établit de façon asynchrone. Lire avant qu'elle soit prête rend ENOTCONN."""
    p = select.poll()
    p.register(fd, select.POLLOUT)
    if p.poll(0):
        return
    os.read(fd, 1)
    if not p.poll(5000):
        raise OSError("liaison SCO absente 5 s après acceptation")


def taux_de(format_audio: str | None, defaut: int = 16000) -> int:
    """`pcm_16000` → 16000 ; tout autre format (ulaw…) n'est pas géré par le pont."""
    if not format_audio:
        return defaut
    if not format_audio.startswith("pcm_"):
        raise ValueError(f"format audio non géré par le pont : {format_audio}")
    return int(format_audio.removeprefix("pcm_"))


class Pont(AudioInterface):
    def __init__(self, enregistrement: str, journal: Callable[..., None]):
        self._journal = journal
        self._verrou = threading.Lock()
        self._sortie = bytearray()  # à 8 kHz, prêt à écrire sur le canal
        self._envoi: Callable[[bytes], None] | None = None
        self._tampon_entree = bytearray()
        self._taux_entree = 16000
        self._taux_sortie = 16000
        self._vers_elevenlabs = soxr.ResampleStream(TAUX_SCO, self._taux_entree, 1, dtype="int16")
        self._vers_telephone = soxr.ResampleStream(self._taux_sortie, TAUX_SCO, 1, dtype="int16")
        self._wav = wave.open(enregistrement, "wb")
        self._wav.setnchannels(2)  # gauche : le prospect ; droite : ce que le pont envoie
        self._wav.setsampwidth(2)
        self._wav.setframerate(TAUX_SCO)
        self._pompe: threading.Thread | None = None
        self._actif = threading.Event()  # l'appel est décroché : on transmet dans les deux sens
        self._arret = threading.Event()
        self.premier_son_de_mina: float | None = None

    # --- réglages connus au début de la conversation -------------------------------------------

    def regler_formats(self, entree: str | None, sortie: str | None) -> None:
        self._taux_entree, self._taux_sortie = taux_de(entree), taux_de(sortie)
        self._vers_elevenlabs = soxr.ResampleStream(TAUX_SCO, self._taux_entree, 1, dtype="int16")
        self._vers_telephone = soxr.ResampleStream(self._taux_sortie, TAUX_SCO, 1, dtype="int16")

    # --- canal SCO -------------------------------------------------------------------------------

    def brancher(self, fd: int) -> None:
        """Appelé à l'ouverture du canal par oFono (dès la composition)."""
        self._pompe = threading.Thread(target=self._pomper, args=(fd,), daemon=True, name="pompe-sco")
        self._pompe.start()

    def decroche(self) -> None:
        self._actif.set()

    def _pomper(self, fd: int) -> None:
        try:
            os.set_blocking(fd, True)
            accepter(fd)
            self._journal("canal son établi")
            while not self._arret.is_set():
                bloc = os.read(fd, 1024)
                if not bloc:
                    break
                sortie = self._bloc_sortant(len(bloc))
                os.write(fd, sortie)
                self._enregistrer(bloc, sortie)
                if self._actif.is_set():
                    self._entrant(bloc)
        except OSError as e:
            self._journal("canal son fermé :", e.strerror or e)
        finally:
            try:
                os.close(fd)
            except OSError:
                pass
            self._wav.close()

    def _bloc_sortant(self, taille: int) -> bytes:
        with self._verrou:
            morceau = bytes(self._sortie[:taille])
            del self._sortie[:taille]
        if morceau and self.premier_son_de_mina is None:
            self.premier_son_de_mina = time.monotonic()
        return morceau + bytes(taille - len(morceau))

    def _enregistrer(self, entrant: bytes, sortant: bytes) -> None:
        g = np.frombuffer(entrant, dtype="<i2")
        d = np.frombuffer(sortant[: len(entrant)], dtype="<i2")
        self._wav.writeframes(np.column_stack((g, d)).tobytes())

    def _entrant(self, bloc: bytes) -> None:
        self._tampon_entree += bloc
        seuil = TAUX_SCO * 2 * MS_PAR_ENVOI // 1000
        if len(self._tampon_entree) < seuil or self._envoi is None or self._vers_elevenlabs is None:
            return
        echantillons = np.frombuffer(bytes(self._tampon_entree), dtype="<i2")
        self._tampon_entree.clear()
        converti = self._vers_elevenlabs.resample_chunk(echantillons).astype("<i2").tobytes()
        if converti:  # le rééchantillonneur garde quelques échantillons au démarrage
            self._envoi(converti)

    def sortie_vide(self) -> bool:
        with self._verrou:
            return not self._sortie

    def fermer(self) -> None:
        self._arret.set()
        if self._pompe is None:
            self._wav.close()
        else:
            self._pompe.join(timeout=2)
        # Libérer les rééchantillonneurs avant la sortie de l'interpréteur (sinon nanobind signale des fuites).
        self._vers_elevenlabs = self._vers_telephone = None

    # --- interface attendue par le SDK ElevenLabs ------------------------------------------------

    def start(self, input_callback: Callable[[bytes], None]) -> None:
        self._envoi = input_callback

    def stop(self) -> None:
        self._envoi = None

    def output(self, audio: bytes) -> None:
        echantillons = np.frombuffer(audio, dtype="<i2")
        converti = self._vers_telephone.resample_chunk(echantillons).astype("<i2").tobytes()
        with self._verrou:
            self._sortie += converti

    def interrupt(self) -> None:
        with self._verrou:
            self._sortie.clear()


def temps_de_reponse(enregistrement: str, seuil: float = 300, trame_ms: int = 20) -> list[float]:
    """Pour chaque reprise de parole de Mina (après 400 ms de silence de sa part), l'écart depuis la
    dernière voix du prospect, lu dans l'enregistrement stéréo. Mesuré côté serveur : le réseau
    mobile ajoute sa propre latence dans chaque sens."""
    with wave.open(enregistrement) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, 2).astype(float)
    t = TAUX_SCO * trame_ms // 1000
    n = len(a) // t
    energie = np.sqrt((a[: n * t].reshape(n, t, 2) ** 2).mean(axis=1))
    prospect, mina = energie[:, 0] > seuil, energie[:, 1] > seuil
    pause = 400 // trame_ms
    ecarts = []
    for i in range(pause, n):
        if mina[i] and not mina[i - pause : i].any():
            j = i - 1
            while j > 0 and not prospect[j]:
                j -= 1
            if j > 0:
                ecarts.append((i - j) * trame_ms / 1000)
    return ecarts
