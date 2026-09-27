"""mSBC (voix large bande du mains-libres) : 16 kHz, 16 bits, mono, par trames de 7,5 ms.

Sur le canal SCO, chaque trame occupe 60 octets : en-tête H2 (0x01 puis un numéro de séquence parmi
0x08, 0x38, 0xC8, 0xF8), 57 octets de trame SBC (qui commence par 0xAD), un octet de bourrage.
Le découpage des lectures ne suit pas les trames : on resynchronise sur l'en-tête.
Encodage et décodage par libsbc (paquet libsbc1), la bibliothèque de BlueZ.
"""
import ctypes
import ctypes.util

OCTETS_PCM = 240  # 120 échantillons de 16 bits
OCTETS_SBC = 57
OCTETS_TRAME = 60
SEQUENCES = (0x08, 0x38, 0xC8, 0xF8)
SBC_LE = 0x00

_lib = ctypes.CDLL(ctypes.util.find_library("sbc") or "libsbc.so.1")


class _Sbc(ctypes.Structure):
    _fields_ = [
        ("flags", ctypes.c_ulong),
        ("frequency", ctypes.c_uint8),
        ("blocks", ctypes.c_uint8),
        ("subbands", ctypes.c_uint8),
        ("mode", ctypes.c_uint8),
        ("allocation", ctypes.c_uint8),
        ("bitpool", ctypes.c_uint8),
        ("endian", ctypes.c_uint8),
        ("priv", ctypes.c_void_p),
        ("priv_alloc_base", ctypes.c_void_p),
    ]


_lib.sbc_init_msbc.argtypes = [ctypes.POINTER(_Sbc), ctypes.c_ulong]
_lib.sbc_decode.argtypes = [
    ctypes.POINTER(_Sbc), ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_size_t),
]
_lib.sbc_decode.restype = ctypes.c_ssize_t
_lib.sbc_encode.argtypes = [
    ctypes.POINTER(_Sbc), ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_ssize_t),
]
_lib.sbc_encode.restype = ctypes.c_ssize_t
_lib.sbc_finish.argtypes = [ctypes.POINTER(_Sbc)]


def _nouveau() -> _Sbc:
    sbc = _Sbc()
    if _lib.sbc_init_msbc(ctypes.byref(sbc), 0) != 0:
        raise RuntimeError("libsbc : initialisation mSBC impossible")
    sbc.endian = SBC_LE
    return sbc


class Decodeur:
    """Octets lus sur le canal → PCM 16 kHz. Une trame perdue ou abîmée devient 7,5 ms de silence."""

    def __init__(self):
        self._sbc = _nouveau()
        self._tampon = bytearray()
        self._sortie = ctypes.create_string_buffer(OCTETS_PCM)

    def decoder(self, octets: bytes) -> bytes:
        self._tampon += octets
        pcm = bytearray()
        while True:
            i = self._debut_de_trame()
            if i < 0:
                del self._tampon[: max(0, len(self._tampon) - 2)]
                return bytes(pcm)
            if len(self._tampon) - i < 2 + OCTETS_SBC:
                del self._tampon[:i]
                return bytes(pcm)
            trame = bytes(self._tampon[i + 2 : i + 2 + OCTETS_SBC])
            del self._tampon[: i + 2 + OCTETS_SBC]
            ecrits = ctypes.c_size_t(0)
            lus = _lib.sbc_decode(
                ctypes.byref(self._sbc), trame, OCTETS_SBC, self._sortie, OCTETS_PCM, ctypes.byref(ecrits)
            )
            pcm += self._sortie.raw[: ecrits.value] if lus > 0 and ecrits.value == OCTETS_PCM else bytes(OCTETS_PCM)

    def _debut_de_trame(self) -> int:
        t = self._tampon
        for i in range(len(t) - 2):
            if t[i] == 0x01 and t[i + 1] in SEQUENCES and t[i + 2] == 0xAD:
                return i
        return -1

    def fermer(self):
        _lib.sbc_finish(ctypes.byref(self._sbc))


class Encodeur:
    """PCM 16 kHz → trames de 60 octets prêtes pour le canal, par paquets de 120 échantillons."""

    def __init__(self):
        self._sbc = _nouveau()
        self._reste = bytearray()
        self._sequence = 0
        self._sortie = ctypes.create_string_buffer(OCTETS_SBC + 8)

    def encoder(self, pcm: bytes) -> bytes:
        self._reste += pcm
        trames = bytearray()
        while len(self._reste) >= OCTETS_PCM:
            bloc = bytes(self._reste[:OCTETS_PCM])
            del self._reste[:OCTETS_PCM]
            trames += self.trame(bloc)
        return bytes(trames)

    def trame(self, bloc: bytes) -> bytes:
        ecrits = ctypes.c_ssize_t(0)
        _lib.sbc_encode(
            ctypes.byref(self._sbc), bloc, OCTETS_PCM, self._sortie, len(self._sortie), ctypes.byref(ecrits)
        )
        if ecrits.value != OCTETS_SBC:
            raise RuntimeError(f"libsbc : trame de {ecrits.value} octets au lieu de {OCTETS_SBC}")
        entete = bytes((0x01, SEQUENCES[self._sequence]))
        self._sequence = (self._sequence + 1) % 4
        return entete + self._sortie.raw[:OCTETS_SBC] + b"\x00"

    def fermer(self):
        _lib.sbc_finish(ctypes.byref(self._sbc))
