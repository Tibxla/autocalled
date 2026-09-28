"""Réglages de la ligne téléphone, modifiables depuis l'application (page Téléphone).

Gardés par le pont dans son dossier de données : c'est lui qui applique le plafond, même si
l'application se trompe. Les valeurs de `.env` ne servent que de valeurs par défaut.
"""
import json
from pathlib import Path
from typing import Any

# nom : (clé de .env, défaut, minimum, maximum)
BORNES = {
    "appelsParHeure": ("PONT_APPELS_PAR_HEURE", 15, 1, 60),
    "appelsParJour": ("PONT_APPELS_PAR_JOUR", 50, 1, 500),
    "pauseEntreAppelsS": ("PONT_PAUSE_ENTRE_APPELS_S", 5, 5, 600),
}


class Reglages:
    def __init__(self, fichier: Path, cles: dict[str, str]):
        self._fichier = fichier
        self.valeurs = {nom: int(cles.get(env, defaut)) for nom, (env, defaut, _, _) in BORNES.items()}
        try:
            enregistres = json.loads(fichier.read_text())
            self.valeurs.update({k: int(v) for k, v in enregistres.items() if k in BORNES})
        except (OSError, ValueError):
            pass

    def modifier(self, saisie: dict[str, Any]) -> dict[str, int]:
        """Valide tout avant d'écrire quoi que ce soit ; lève ValueError avec un message lisible."""
        nouvelles = dict(self.valeurs)
        for nom, valeur in saisie.items():
            if nom not in BORNES:
                raise ValueError(f"réglage inconnu : {nom}")
            _, _, minimum, maximum = BORNES[nom]
            try:
                entier = int(valeur)
            except (TypeError, ValueError):
                raise ValueError(f"{nom} doit être un nombre entier") from None
            if not minimum <= entier <= maximum:
                raise ValueError(f"{nom} doit être entre {minimum} et {maximum}")
            nouvelles[nom] = entier
        if nouvelles["appelsParJour"] < nouvelles["appelsParHeure"]:
            raise ValueError("le plafond par jour ne peut pas être inférieur au plafond par heure")
        self.valeurs = nouvelles
        self._fichier.parent.mkdir(parents=True, exist_ok=True)
        self._fichier.write_text(json.dumps(nouvelles))
        return nouvelles
