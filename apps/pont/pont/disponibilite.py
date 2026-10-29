"""Frein partagé par les appels sortants et entrants après un refus d'ElevenLabs."""
import threading
import time
from collections.abc import Callable

DELAI_INDISPONIBILITE_S = 30 * 60


class AssistanteIndisponible(RuntimeError):
    def __init__(self, refus: dict):
        super().__init__("Assistante ElevenLabs indisponible : " + refus["raison"])
        self.refus = refus


class DisponibiliteAssistante:
    def __init__(self, horloge: Callable[[], float] = time.monotonic):
        self._horloge = horloge
        self._verrou = threading.Lock()
        self._refus: dict | None = None
        self._jusque = 0.0

    def refuser(self, raison: str, quota: bool) -> None:
        with self._verrou:
            self._refus = {"raison": raison, "quota": quota}
            self._jusque = self._horloge() + DELAI_INDISPONIBILITE_S

    def retablir(self) -> None:
        with self._verrou:
            self._refus = None

    def etat(self) -> dict | None:
        with self._verrou:
            if self._horloge() >= self._jusque:
                self._refus = None
            return dict(self._refus) if self._refus else None
