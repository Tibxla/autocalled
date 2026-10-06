"""Pont audio entre le canal SCO et la conversation ElevenLabs.

Deux codages possibles, choisis par le téléphone à chaque appel parmi ceux que l'agent audio déclare :
- mSBC (voix large bande) : 16 kHz, encodé et décodé ici par libsbc. C'est le cas normal.
- CVSD : 8 kHz, codé par la clé Bluetooth. La voix de Mina y grésille (constat du 27/09) ; il ne sert
  que si le téléphone refuse le mSBC.

L'horloge est la boucle SCO : pour chaque bloc lu, on écrit un bloc de même taille, tiré du tampon
de sortie ou complété de silence. Le SDK ne touche jamais le descripteur : `output()` remplit le
tampon, `interrupt()` le vide (sinon Mina continuerait de parler par-dessus le prospect).
"""
import math
import os
import queue
import select
import threading
import time
import wave
from collections import deque
from collections.abc import Callable

import numpy as np
import soxr
from elevenlabs.conversational_ai.conversation import AudioInterface

from . import msbc

CVSD, MSBC = 1, 2
MS_PAR_ENVOI = 100  # blocs envoyés à ElevenLabs : assez courts pour ne pas retarder la fin de tour
# Détection de voix du prospect au décroché, avant l'ouverture de la conversation : trames de 20 ms au-dessus
# du seuil, plusieurs d'affilée (le bruit de fond d'un décroché reste vers 200-300, un « allô » dépasse 1000).
SEUIL_VOIX, TRAMES_VOIX = 600, 3
# Fin de l'accueil du prospect (« Hôtel du Parc, bonjour ») : 500 ms sous le seuil après sa voix.
TRAMES_FIN_ACCUEIL = 25
ATTENTE_MAX_S = 5  # son du prospect gardé en attendant l'ouverture de la conversation
# La voix d'ElevenLabs arrive vers −13 dBFS, crêtes à pleine échelle. Le téléphone traite ce qui vient du
# « micro » mains-libres en l'attendant bien plus faible : à ce niveau, il compresse et la voix sonne saturée.
# Échelle d'écoute du 27/09 en mSBC : −19,5 dBFS sature, −29,5 et −39,5 sont nets. On vise environ −31 dBFS.
GAIN_SORTIE = 10 ** (-18 / 20)
PRISE_TAMPON_MS = 120  # avance accumulée avant de lire la voix de l'opérateur
# Le contrôle automatique du volume de Chrome amène le micro vers −19 dBFS, le niveau qui saturait avec Mina :
# même traitement, vers −30 dBFS. À recaler avec la mesure « voix opérateur » du relevé.
GAIN_OPERATEUR = 10 ** (-10 / 20)
# Niveaux des deux voix pour l'onde de la page en direct, jamais l'audio lui-même : un relevé par fenêtre de
# NIVEAU_PAS_MS, en dBFS ramenés sur [0, 1] entre un plancher et un plafond propres à chaque voix. Prospect : le
# bruit de fond d'un décroché (200-300, vers −41 dBFS) reste à 0. Mina : mesurée sur la ligne puis ramenée au niveau
# d'avant GAIN_SORTIE (ou GAIN_OPERATEUR), celui d'ElevenLabs, vers −13 dBFS. Plafonds à recaler avec les crêtes
# que le relevé du journal donne toutes les 5 s.
NIVEAU_PAS_MS = 50
COMPENSATION_MINA_DB = -20 * math.log10(GAIN_SORTIE)
COMPENSATION_OPERATEUR_DB = -20 * math.log10(GAIN_OPERATEUR)
NIVEAU_PROSPECT_DBFS = (-40.0, -16.0)
NIVEAU_MINA_DBFS = (-44.0, -8.0)
NIVEAUX_GARDES = 100  # 5 s : de quoi servir un suivi qui prend un peu de retard, pas plus


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


class _Conversion:
    """Rééchantillonnage en flux, ou rien si les deux taux sont égaux."""

    def __init__(self, depuis: int, vers: int):
        self._flux = soxr.ResampleStream(depuis, vers, 1, dtype="float32") if depuis != vers else None

    def __call__(self, echantillons: np.ndarray) -> np.ndarray:
        if self._flux is None:
            return echantillons
        return self._flux.resample_chunk(echantillons)


# Égalisation de la voix de Mina pour la ligne (02/10) : tous les appels mesurés passent en bande étroite
# (300-3 400 Hz), et 60 % de l'énergie de la voix de synthèse était sous 300 Hz, coupée ou étouffée par le réseau.
# Le profil historique baisse les graves et remonte la présence (+5 dB vers 3 kHz). Le profil doux conserve
# le traitement des graves mais retire cette bosse, qui peut rendre une autre voix plus métallique.
# Le choix est fixé par appel : PONT_EGALISATION, historique par défaut ; le gain anti-saturation reste inchangé.
COURBE_EGALISATION = ((0, -16), (150, -16), (350, 0), (1500, 0), (2500, 5), (3600, 5), (4000, 0))
COURBES_EGALISATION = {
    "historique": COURBE_EGALISATION,
    "douce": tuple((frequence, min(db, 0)) for frequence, db in COURBE_EGALISATION),
}


def profil_egalisation(valeur: str = "historique") -> str:
    if valeur not in (*COURBES_EGALISATION, "aucune"):
        raise ValueError("PONT_EGALISATION doit être historique, douce ou aucune")
    return valeur


def filtre_egalisation(taux: int, coefficients: int = 129, profil: str = "historique") -> np.ndarray:
    """Filtre à phase linéaire (retard de 4 ms à 16 kHz), en dB par fréquence."""
    profil_egalisation(profil)
    if profil == "aucune":
        return np.array([1.0])
    frequences = np.fft.rfftfreq(1024, 1 / taux)
    points_f, points_db = zip(*COURBES_EGALISATION[profil], strict=True)
    gain = 10 ** (np.interp(frequences, points_f, points_db) / 20)
    reponse = np.roll(np.fft.irfft(gain, 1024), coefficients // 2)[:coefficients]
    return reponse * np.hanning(coefficients)


class _Egaliseur:
    """Le filtre appliqué en flux : la fin de chaque morceau prolonge le suivant."""

    def __init__(self, taux: int, profil: str = "historique"):
        self._filtre = filtre_egalisation(taux, profil=profil)
        self._reste = np.zeros(len(self._filtre) - 1, dtype=np.float32)

    def __call__(self, echantillons: np.ndarray) -> np.ndarray:
        if not len(echantillons):
            return echantillons
        suite = np.concatenate([self._reste, echantillons])
        self._reste = suite[-(len(self._filtre) - 1) :] if len(self._filtre) > 1 else suite[:0]
        return np.convolve(suite, self._filtre, mode="valid").astype(np.float32)

    def oublier(self) -> None:
        self._reste[:] = 0


def _vers_pcm(echantillons: np.ndarray) -> bytes:
    return np.clip(echantillons, -32768, 32767).astype("<i2").tobytes()


def dbfs(somme_carres: float, compte: int) -> float:
    """RMS d'une fenêtre de PCM 16 bits, en dBFS (−90 pour un silence numérique)."""
    rms = math.sqrt(somme_carres / compte) if compte else 0.0
    return 20 * math.log10(max(rms, 1.0) / 32768)


def normaliser(db: float, echelle: tuple[float, float]) -> float:
    plancher, plafond = echelle
    return round(min(1.0, max(0.0, (db - plancher) / (plafond - plancher))), 2)


class Niveaux:
    """Niveaux de Mina et du prospect, relevés par la boucle audio et lus par le suivi en direct.

    `ajouter` coûte deux produits scalaires par bloc ; le verrou n'est tenu que pour poser ou copier quelques
    tuples, et la file est bornée : la boucle audio n'attend jamais un lecteur.
    """

    def __init__(self, taux: int):
        self.regler_taux(taux)
        self._compte = 0
        self._prospect = self._mina = 0.0  # sommes des carrés de la fenêtre en cours
        self._verrou = threading.Lock()
        self._file: deque[tuple[int, int, float, float]] = deque(maxlen=NIVEAUX_GARDES)  # (n°, t ms, mina, prospect)
        self._suivant = 0
        self.cretes = [-90.0, -90.0]  # prospect, Mina (dBFS sur la ligne) depuis le dernier relevé du journal

    def regler_taux(self, taux: int) -> None:
        """Avant le premier bloc : le taux de la ligne n'est connu qu'à l'ouverture du canal son."""
        self._fenetre = taux * NIVEAU_PAS_MS // 1000

    def ajouter(self, prospect: np.ndarray, mina: np.ndarray, compensation_mina_db: float) -> None:
        """Deux blocs PCM 16 bits de même longueur ; `compensation_mina_db` annule le gain appliqué à Mina."""
        i = 0
        while i < len(prospect):
            k = min(len(prospect) - i, self._fenetre - self._compte)
            p = prospect[i : i + k].astype(np.float32)
            m = mina[i : i + k].astype(np.float32)
            self._prospect += float(np.dot(p, p))
            self._mina += float(np.dot(m, m))
            self._compte += k
            i += k
            if self._compte >= self._fenetre:
                self._clore(compensation_mina_db)

    def _clore(self, compensation_mina_db: float) -> None:
        db_p, db_m = dbfs(self._prospect, self._compte), dbfs(self._mina, self._compte)
        self._prospect = self._mina = 0.0
        self._compte = 0
        self.cretes = [max(self.cretes[0], db_p), max(self.cretes[1], db_m)]
        mina = normaliser(db_m + compensation_mina_db, NIVEAU_MINA_DBFS)
        releve = (self._suivant, int(time.time() * 1000), mina, normaliser(db_p, NIVEAU_PROSPECT_DBFS))
        with self._verrou:
            self._file.append(releve)
            self._suivant += 1

    def curseur(self) -> int:
        """Pour un nouveau lecteur : il reçoit les relevés à venir, pas ceux d'avant son arrivée."""
        with self._verrou:
            return self._suivant

    def depuis(self, curseur: int) -> tuple[int, list[tuple[int, float, float]]]:
        """(curseur suivant, [(t ms, mina, prospect)…]) ; un lecteur trop lent perd les plus anciens."""
        with self._verrou:
            return self._suivant, [(t, m, p) for n, t, m, p in self._file if n >= curseur]


class Pont(AudioInterface):
    def __init__(self, enregistrement: str, journal: Callable[..., None], *, egalisation: str = "historique"):
        self.egalisation = profil_egalisation(egalisation)
        self._chemin_enregistrement = enregistrement
        self._journal = journal
        self._verrou = threading.Lock()
        self._sortie = bytearray()  # PCM au taux de la ligne, en attente d'écriture
        self._envoi: Callable[[bytes], None] | None = None
        self._tampon_entree = bytearray()
        self._taux_entree = self._taux_sortie = 16000  # formats d'ElevenLabs, confirmés à l'ouverture
        self._taux_ligne = 16000
        self._codec = MSBC
        self._pompe: threading.Thread | None = None
        self._actif = threading.Event()  # l'appel est décroché : on transmet dans les deux sens
        self._arret = threading.Event()
        self.premier_son_de_mina: float | None = None
        self.prospect_parle = threading.Event()  # une voix a été entendue depuis le décroché
        self.accueil_fini = threading.Event()  # puis TRAMES_FIN_ACCUEIL trames de silence
        self.duree_accueil_s: float | None = None  # du début à la fin de la voix, à `accueil_fini`
        self.fin_accueil: float | None = None  # heure (monotonic) de la fin de la voix, à `accueil_fini`
        self._jeter_accueil = False
        self._auditeurs: set[queue.Queue] = set()  # écoutes en direct : prospect et Mina mélangés
        # Prise de main (ADR 0008) : la voix de l'opérateur remplace celle de Mina, le prospect seul part vers lui.
        self._mode_operateur = False
        self._operateur = bytearray()  # PCM de l'opérateur au taux de la ligne
        self._operateur_lance = False  # lecture entamée : le tampon a atteint son seuil depuis le dernier vide
        self._depuis_operateur: _Conversion | None = None
        self._prospect_seul: set[queue.Queue] = set()
        self._energie_operateur: list[float] = []  # RMS des blocs reçus depuis le dernier relevé
        self._trames_voix = 0
        self._trames_accueil = 0  # depuis le début de la voix
        self._trames_silence = 0  # d'affilée, depuis la dernière trame de voix
        self._tampon_voix = bytearray()
        self.niveaux = Niveaux(self._taux_ligne)
        self._niveaux_actifs = True  # une erreur de relevé les coupe pour le reste de l'appel, jamais la boucle
        self._preparer_conversions()

    def _preparer_conversions(self) -> None:
        self._vers_elevenlabs = _Conversion(self._taux_ligne, self._taux_entree)
        self._vers_telephone = _Conversion(self._taux_sortie, self._taux_ligne)
        self._egaliseur = _Egaliseur(self._taux_sortie, self.egalisation) if self.egalisation != "aucune" else None

    def regler_formats(self, entree: str | None, sortie: str | None) -> None:
        self._taux_entree, self._taux_sortie = taux_de(entree), taux_de(sortie)
        self._preparer_conversions()

    # --- canal SCO -------------------------------------------------------------------------------

    def brancher(self, fd: int, codec: int) -> None:
        """Appelé à l'ouverture du canal par oFono (dès la composition)."""
        self._codec = codec
        self._taux_ligne = 16000 if codec == MSBC else 8000
        self.niveaux.regler_taux(self._taux_ligne)
        self._preparer_conversions()
        self._pompe = threading.Thread(target=self._pomper, args=(fd,), daemon=True, name="pompe-sco")
        self._pompe.start()

    def decroche(self) -> None:
        self._actif.set()

    def _pomper(self, fd: int) -> None:
        wav = wave.open(self._chemin_enregistrement, "wb")
        wav.setnchannels(2)  # gauche : le prospect ; droite : ce que le pont envoie
        wav.setsampwidth(2)
        wav.setframerate(self._taux_ligne)
        decodeur, encodeur = (msbc.Decodeur(), msbc.Encodeur()) if self._codec == MSBC else (None, None)
        a_ecrire = bytearray()  # octets prêts pour le canal (trames mSBC, ou PCM en CVSD)
        rec_g, rec_d = bytearray(), bytearray()
        # Relevés toutes les 5 s : de quoi voir où le son coince (réception, décodage, écriture).
        stats = {"lus": 0, "ecrits": 0, "sautes": 0}
        prochain_releve = time.monotonic() + 5
        ecriture = select.poll()
        ecriture.register(fd, select.POLLOUT)
        try:
            os.set_blocking(fd, True)
            accepter(fd)
            self._journal(
                "canal son établi en",
                "mSBC (16 kHz)" if decodeur else "CVSD (8 kHz)",
                "| égalisation", self.egalisation,
                "| gain sortie", f"{-COMPENSATION_MINA_DB:g} dB",
            )
            while not self._arret.is_set():
                bloc = os.read(fd, 1024)
                if not bloc:
                    break
                entrant = decodeur.decoder(bloc) if decodeur else bloc
                while len(a_ecrire) < len(bloc):
                    pcm = self._pcm_sortant(msbc.OCTETS_PCM if encodeur else len(bloc) - len(a_ecrire))
                    rec_d += pcm
                    a_ecrire += encodeur.trame(pcm) if encodeur else pcm
                # Une clé qui n'accepte plus les paquets ne doit pas figer la boucle : on saute l'écriture,
                # la réception continue.
                if ecriture.poll(20):
                    stats["ecrits"] += os.write(fd, bytes(a_ecrire[: len(bloc)]))
                else:
                    stats["sautes"] += 1
                del a_ecrire[: len(bloc)]
                stats["lus"] += len(bloc)
                if time.monotonic() >= prochain_releve:
                    prochain_releve += 5
                    trames = f", trames {decodeur.trames} lues / {decodeur.perdues} perdues" if decodeur else ""
                    if self._mode_operateur:
                        parle = [e for e in self._energie_operateur if e > 100] or [0.0]
                        self._energie_operateur.clear()
                        rms = float(np.sqrt(np.mean(np.square(parle))))
                        trames += f", voix opérateur {20 * np.log10(max(rms, 1) / 32768):.0f} dBFS"
                    if self._actif.is_set():
                        cretes, self.niveaux.cretes = self.niveaux.cretes, [-90.0, -90.0]
                        trames += f", crêtes prospect {cretes[0]:.0f} / envoi {cretes[1]:.0f} dBFS"
                    self._journal(
                        f"son : {stats['lus']} o lus, {stats['ecrits']} o écrits, {stats['sautes']} écritures sautées{trames}"
                    )
                rec_g += entrant
                n = min(len(rec_g), len(rec_d)) // 2 * 2
                if n:
                    g = np.frombuffer(bytes(rec_g[:n]), dtype="<i2")
                    d = np.frombuffer(bytes(rec_d[:n]), dtype="<i2")
                    wav.writeframes(np.column_stack((g, d)).tobytes())
                    del rec_g[:n], rec_d[:n]
                    if self._auditeurs:
                        self._diffuser(((g.astype(np.int32) + d) // 2).astype("<i2").tobytes())
                    if self._niveaux_actifs and self._actif.is_set():
                        self._relever_niveaux(g, d)
                if self._actif.is_set():
                    if self._prospect_seul:
                        self._diffuser(entrant, self._prospect_seul)
                    self._entrant(entrant)
        except OSError as e:
            self._journal("canal son fermé :", e.strerror or e)
        finally:
            try:
                os.close(fd)
            except OSError:
                pass
            wav.close()
            self._diffuser(None)
            self._diffuser(None, self._prospect_seul)
            for c in (decodeur, encodeur):
                if c:
                    c.fermer()

    def _relever_niveaux(self, prospect: np.ndarray, envoye: np.ndarray) -> None:
        try:
            self.niveaux.ajouter(prospect, envoye, COMPENSATION_OPERATEUR_DB if self._mode_operateur else COMPENSATION_MINA_DB)
        except Exception as e:  # l'onde n'est qu'un confort : elle s'arrête, l'appel continue
            self._niveaux_actifs = False
            self._journal("relevé des niveaux arrêté :", e)

    def _pcm_operateur(self, taille: int) -> bytes:
        """Tampon de gigue : la lecture ne reprend qu'avec PRISE_TAMPON_MS d'avance, sinon la voix hacherait
        (le micro arrive au rythme du temps réel, pas en avance comme la voix de synthèse)."""
        seuil = self._taux_ligne * 2 * PRISE_TAMPON_MS // 1000
        with self._verrou:
            if not self._operateur_lance and len(self._operateur) >= seuil:
                self._operateur_lance = True
            if not self._operateur_lance:
                return bytes(taille)
            morceau = bytes(self._operateur[:taille])
            del self._operateur[:taille]
            if len(morceau) < taille:
                self._operateur_lance = False
        return morceau + bytes(taille - len(morceau))

    # --- écoute en direct --------------------------------------------------------------------------

    @property
    def taux_ligne(self) -> int:
        return self._taux_ligne

    def ecouter(self) -> "queue.Queue[bytes | None]":
        """Une file de PCM 16 bits mono au taux de la ligne ; `None` marque la fin de l'appel."""
        file: queue.Queue = queue.Queue(maxsize=200)
        self._auditeurs.add(file)
        return file

    def arreter_ecoute(self, file: queue.Queue) -> None:
        self._auditeurs.discard(file)

    def _diffuser(self, pcm: bytes | None, auditeurs: set[queue.Queue] | None = None) -> None:
        for file in list(self._auditeurs if auditeurs is None else auditeurs):
            try:
                file.put_nowait(pcm)
            except queue.Full:  # auditeur trop lent : il perd ce morceau plutôt que de ralentir l'appel
                pass

    # --- prise de main -------------------------------------------------------------------------------

    def prendre_la_main(self) -> None:
        """Mina se tait (ce qu'elle n'avait pas encore dit est jeté) ; la voix de l'opérateur prend sa place."""
        with self._verrou:
            self._sortie.clear()
            self._operateur.clear()
            self._operateur_lance = False
            self._mode_operateur = True
        self._depuis_operateur = _Conversion(16000, self._taux_ligne)

    def ecouter_prospect(self) -> "queue.Queue[bytes | None]":
        """Le prospect seul, PCM 16 bits mono au taux de la ligne ; `None` marque la fin de l'appel."""
        file: queue.Queue = queue.Queue(maxsize=400)
        self._prospect_seul.add(file)
        return file

    def arreter_prospect(self, file: queue.Queue) -> None:
        self._prospect_seul.discard(file)

    def voix_operateur(self, pcm16k: bytes) -> None:
        """PCM 16 bits mono à 16 kHz venu du navigateur. Pas de GAIN_SORTIE : il est calé sur la voix de synthèse."""
        if not self._mode_operateur or self._depuis_operateur is None:
            return
        echantillons = np.frombuffer(pcm16k[: len(pcm16k) // 2 * 2], dtype="<i2").astype(np.float32) * GAIN_OPERATEUR
        if len(echantillons):
            self._energie_operateur.append(float(np.sqrt((echantillons**2).mean())))
        converti = _vers_pcm(self._depuis_operateur(echantillons))
        with self._verrou:
            self._operateur += converti
            # Au-delà d'une seconde de retard, on jette le plus ancien : mieux vaut un mot perdu qu'un décalage.
            excedent = len(self._operateur) - self._taux_ligne * 2
            if excedent > 0:
                del self._operateur[:excedent]

    def _pcm_sortant(self, taille: int) -> bytes:
        if self._mode_operateur:
            return self._pcm_operateur(taille)
        with self._verrou:
            morceau = bytes(self._sortie[:taille])
            del self._sortie[:taille]
        if morceau and self.premier_son_de_mina is None:
            self.premier_son_de_mina = time.monotonic()
        return morceau + bytes(taille - len(morceau))

    def _entrant(self, pcm: bytes) -> None:
        """Après le décroché. Tant que la conversation n'est pas ouverte, le son est gardé (jusqu'à
        ATTENTE_MAX_S) puis envoyé d'un coup : le « allô » dit avant l'ouverture n'est pas perdu."""
        self._detecter_voix(pcm)
        if self._jeter_accueil and self._envoi is not None:
            # Ouverture fixe : l'accueil ne part pas à ElevenLabs, il interromprait le premier message.
            self._tampon_entree.clear()
            self._jeter_accueil = False
        self._tampon_entree += pcm
        if self._envoi is None:
            del self._tampon_entree[: max(0, len(self._tampon_entree) - self._taux_ligne * 2 * ATTENTE_MAX_S)]
            return
        if len(self._tampon_entree) < self._taux_ligne * 2 * MS_PAR_ENVOI // 1000:
            return
        echantillons = np.frombuffer(bytes(self._tampon_entree), dtype="<i2").astype(np.float32)
        self._tampon_entree.clear()
        converti = _vers_pcm(self._vers_elevenlabs(echantillons))
        if converti:  # un rééchantillonneur garde quelques échantillons au démarrage
            self._envoi(converti)

    def _detecter_voix(self, pcm: bytes) -> None:
        """Début de la voix du prospect au décroché (`prospect_parle`), puis fin de son accueil (`accueil_fini`)."""
        if self.accueil_fini.is_set():
            return
        self._tampon_voix += pcm
        octets = self._taux_ligne // 50 * 2  # trames de 20 ms, quel que soit le découpage des lectures
        while len(self._tampon_voix) >= octets:
            x = np.frombuffer(bytes(self._tampon_voix[:octets]), dtype="<i2").astype(np.float32)
            del self._tampon_voix[:octets]
            fort = np.sqrt((x**2).mean()) > SEUIL_VOIX
            if not self.prospect_parle.is_set():
                self._trames_voix = self._trames_voix + 1 if fort else 0
                if self._trames_voix >= TRAMES_VOIX:
                    self._trames_accueil = self._trames_voix
                    self.prospect_parle.set()
                continue
            self._trames_accueil += 1
            self._trames_silence = 0 if fort else self._trames_silence + 1
            if self._trames_silence >= TRAMES_FIN_ACCUEIL:
                self.duree_accueil_s = (self._trames_accueil - self._trames_silence) * 0.02
                self.fin_accueil = time.monotonic() - self._trames_silence * 0.02
                self.accueil_fini.set()
                self._tampon_voix.clear()
                return

    def oublier_accueil(self) -> None:
        """Le son gardé avant l'ouverture est jeté au lieu d'être envoyé à ElevenLabs."""
        self._jeter_accueil = True

    def sortie_vide(self) -> bool:
        with self._verrou:
            return not self._sortie

    def fermer(self) -> None:
        self._arret.set()
        if self._pompe is not None:
            self._pompe.join(timeout=2)
        # Libérer les rééchantillonneurs avant la sortie de l'interpréteur (sinon nanobind signale des fuites).
        self._vers_elevenlabs = self._vers_telephone = None

    # --- interface attendue par le SDK ElevenLabs ------------------------------------------------

    def start(self, input_callback: Callable[[bytes], None]) -> None:
        if self._mode_operateur:
            return  # prise de main survenue pendant l'ouverture : plus rien ne va à ElevenLabs
        self._envoi = input_callback

    def stop(self) -> None:
        self._envoi = None

    def output(self, audio: bytes) -> None:
        if self._mode_operateur:
            return
        echantillons = np.frombuffer(audio, dtype="<i2").astype(np.float32) * GAIN_SORTIE
        if self._egaliseur is not None:
            echantillons = self._egaliseur(echantillons)
        converti = _vers_pcm(self._vers_telephone(echantillons))
        with self._verrou:
            self._sortie += converti

    def interrupt(self) -> None:
        with self._verrou:
            self._sortie.clear()
        if self._egaliseur is not None:
            self._egaliseur.oublier()


def temps_de_reponse(enregistrement: str, seuil_prospect: float = 300, seuil_mina: float = 50, trame_ms: int = 20) -> list[float]:
    """Pour chaque reprise de parole de Mina (après 400 ms de silence de sa part) qui répond au prospect, l'écart
    depuis la dernière voix du prospect, lu dans l'enregistrement stéréo. Une pause de Mina au milieu de sa réplique,
    sans le prospect entre-temps, n'est pas une réponse : jusqu'au 02/10 elle comptait, et gonflait la médiane
    (1,8 s au lieu de 1,4 s). Mesuré côté serveur : le réseau mobile ajoute sa propre latence dans chaque sens."""
    with wave.open(enregistrement) as w:
        taux = w.getframerate()
        a = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, 2).astype(float)
    t = taux * trame_ms // 1000
    n = len(a) // t
    energie = np.sqrt((a[: n * t].reshape(n, t, 2) ** 2).mean(axis=1))
    # Mina est envoyée bas (vers −31 dBFS) et ses silences sont numériques : seuil plus bas que pour le prospect.
    prospect, mina = energie[:, 0] > seuil_prospect, energie[:, 1] > seuil_mina
    pause = 400 // trame_ms
    ecarts = []
    derniere_mina = derniere_voix = -1
    for i in range(n):
        if mina[i] and i >= pause and not mina[i - pause : i].any() and derniere_voix > derniere_mina:
            ecarts.append((i - derniere_voix) * trame_ms / 1000)
        if mina[i]:
            derniere_mina = i
        elif prospect[i]:
            derniere_voix = i
    return ecarts
