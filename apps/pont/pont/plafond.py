"""Plafond d'appels sortants du téléphone passerelle.

Ce qui fait signaler un numéro comme démarchage, ce sont des rafales d'appels courts ou sans réponse :
une campagne où personne ne décroche, ou une boucle due à un bug, en produirait une. Le plafond la rend
impossible, quel que soit le chemin (fiche prospect ou campagne). L'historique survit aux redémarrages.
"""
import json
import threading
import time
from pathlib import Path


class Plafond:
    def __init__(self, fichier: Path, par_heure: int, par_jour: int):
        self._fichier = fichier
        self._verrou = threading.Lock()
        self.regler(par_heure, par_jour)
        try:
            self._appels: list[float] = json.loads(fichier.read_text())
        except (OSError, ValueError):
            self._appels = []

    def regler(self, par_heure: int, par_jour: int) -> None:
        self._limites = ((3600, par_heure, "par heure"), (86400, par_jour, "par jour"))

    def refus(self, maintenant: float | None = None) -> str | None:
        """La raison du refus si un appel de plus dépasserait le plafond, sinon None."""
        maintenant = maintenant or time.time()
        with self._verrou:
            for fenetre, limite, libelle in self._limites:
                recents = sorted(t for t in self._appels if t > maintenant - fenetre)
                if len(recents) >= limite:
                    attente = int(recents[len(recents) - limite] + fenetre - maintenant) // 60 + 1
                    return (
                        f"Plafond de {limite} appels {libelle} atteint, pour éviter que le numéro soit signalé "
                        f"comme démarchage. Prochain appel possible dans {attente} min."
                    )
        return None

    def compter(self, maintenant: float | None = None) -> None:
        maintenant = maintenant or time.time()
        with self._verrou:
            self._appels = [t for t in self._appels if t > maintenant - 86400] + [maintenant]
            self._fichier.parent.mkdir(parents=True, exist_ok=True)
            self._fichier.write_text(json.dumps(self._appels))
