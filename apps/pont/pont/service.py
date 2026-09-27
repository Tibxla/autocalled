"""Le pont en service permanent (ADR 0007), piloté par l'application web.

N'écoute que sur 127.0.0.1. Chaque requête porte `Authorization: Bearer $PONT_SECRET`, et le pont
présente le même secret à l'application quand il la rappelle (`$WEB_URL/api/pont/…`).

    GET  /etat                      le téléphone passerelle et l'appel en cours
    POST /appels                    {appelId, numero, variables, motsCles} : compose
    POST /appels/<appelId>/raccrocher
"""
import hmac
import json
import os
import re
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import dbus
import dbus.mainloop.glib
from gi.repository import GLib

from .appel import Appel, Journal
from .ofono import Telephone, dans_glib


class RappelsWeb:
    """Ce que l'appel fait savoir à l'application, par ses routes `/api/pont/appels/<id>/…`."""

    def __init__(self, web: str, secret: str, appel_id: str, journal: Journal):
        self._base = f"{web.rstrip('/')}/api/pont/appels/{appel_id}"
        self._secret = secret
        self.journal = journal

    def _poster(self, chemin: str, corps: dict[str, Any], delai: float = 30) -> dict[str, Any]:
        requete = urllib.request.Request(
            f"{self._base}/{chemin}",
            data=json.dumps(corps).encode(),
            headers={"content-type": "application/json", "authorization": f"Bearer {self._secret}"},
            method="POST",
        )
        with urllib.request.urlopen(requete, timeout=delai) as r:
            return json.loads(r.read() or b"{}")

    def conversation_ouverte(self, conversation_id: str) -> None:
        try:
            self._poster("conversation", {"conversationId": conversation_id})
        except (urllib.error.URLError, TimeoutError) as e:
            self.journal("l'application n'a pas reçu l'identifiant de conversation :", e)

    def outil(self, nom: str, parametres: dict[str, Any]) -> str:
        try:
            return str(self._poster("outils", {"outil": nom, "parametres": parametres}, delai=20)["resultat"])
        except (urllib.error.URLError, TimeoutError, KeyError) as e:
            self.journal("outil", nom, "en échec :", e)
            return "L'agenda ne répond pas. Propose au prospect qu'on le recontacte pour fixer un moment."

    def evenement(self, type_: str, donnees: dict[str, Any]) -> None:
        pass  # le suivi en direct viendra avec la page d'appel en direct

    def fin(self, bilan: dict[str, Any]) -> None:
        try:
            self._poster("fin", bilan)
        except (urllib.error.URLError, TimeoutError) as e:
            self.journal("l'application n'a pas reçu la fin de l'appel :", e)


class Service:
    def __init__(self, cles: dict[str, str], racine: Path):
        self._cles = cles
        self._secret = cles["PONT_SECRET"]
        self._web = cles.get("WEB_URL", "http://127.0.0.1:3020")
        self._dossier = racine / "data" / "pont"
        self.journal = Journal()
        dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
        self._bus = dbus.SystemBus()
        self._boucle = GLib.MainLoop()
        self._telephone = Telephone(self._bus, self.journal)
        self._appels: dict[str, Appel] = {}
        self._verrou = threading.Lock()

    def lancer(self, port: int) -> None:
        # L'agent audio est enregistré pour toute la vie du service : le mSBC n'est accordé que s'il est
        # là quand le téléphone se connecte (ADR 0003).
        self._telephone.enregistrer_agent_audio()
        threading.Thread(target=self._annoncer_msbc, daemon=True).start()
        serveur = ThreadingHTTPServer(("127.0.0.1", port), self._gestionnaire())
        serveur.daemon_threads = True
        threading.Thread(target=serveur.serve_forever, daemon=True, name="http").start()
        self.journal(f"pont prêt sur 127.0.0.1:{port}")
        self._boucle.run()

    def _annoncer_msbc(self) -> None:
        """Un téléphone connecté avant le démarrage du pont a établi sa liaison sans le mSBC : on le
        reconnecte une fois, agent audio enregistré, pour que le mSBC soit annoncé."""
        try:
            modem = dans_glib(self._telephone.modem)
        except Exception:
            return  # pas de téléphone : il annoncera le mSBC en se connectant
        self.journal("téléphone déjà connecté : reconnexion pour annoncer le mSBC")
        try:
            self._telephone.reconnecter(modem)
        except Exception as e:
            self.journal("reconnexion impossible :", e)

    # --- opérations ------------------------------------------------------------------------------

    def etat(self) -> dict[str, Any]:
        return dans_glib(self._telephone.etat)

    def appeler(self, corps: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        appel_id = str(corps.get("appelId", ""))
        if not re.fullmatch(r"[0-9a-f-]{36}", appel_id) or not corps.get("numero"):
            return 400, {"erreur": "appelId et numero sont requis"}
        with self._verrou:
            if not self._telephone.libre():
                return 409, {"erreur": "Un appel est déjà en cours sur le téléphone."}
            rappels = RappelsWeb(self._web, self._secret, appel_id, self.journal)
            appel = Appel(
                self._telephone,
                str(corps["numero"]),
                dict(corps.get("variables", {})),
                list(corps.get("motsCles", [])),
                self._cles,
                self._dossier,
                appel_id,
                rappels,
            )
            rappels.journal = appel.journal
            try:
                dans_glib(appel.lancer)
            except Exception as e:
                appel.journal("composition impossible :", e)
                return 503, {"erreur": f"Composition impossible : {e}"}
            self._appels[appel_id] = appel
            threading.Thread(target=self._oublier_a_la_fin, args=(appel_id,), daemon=True).start()
        return 202, {"ok": True}

    def raccrocher(self, appel_id: str) -> tuple[int, dict[str, Any]]:
        appel = self._appels.get(appel_id)
        if not appel:
            return 404, {"erreur": "Appel inconnu du pont."}
        appel.raccrocher()
        return 202, {"ok": True}

    def _oublier_a_la_fin(self, appel_id: str) -> None:
        self._appels[appel_id].attendre_fin()
        self._appels.pop(appel_id, None)

    # --- HTTP ------------------------------------------------------------------------------------

    def _gestionnaire(self):
        service = self

        class Gestionnaire(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass

            def _repondre(self, code: int, corps: dict[str, Any]) -> None:
                donnees = json.dumps(corps, ensure_ascii=False).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json; charset=utf-8")
                self.send_header("content-length", str(len(donnees)))
                self.end_headers()
                self.wfile.write(donnees)

            def _autorise(self) -> bool:
                recu = self.headers.get("authorization", "")
                if hmac.compare_digest(recu.encode(), f"Bearer {service._secret}".encode()):
                    return True
                self._repondre(401, {"erreur": "secret du pont absent ou faux"})
                return False

            def do_GET(self):
                if not self._autorise():
                    return
                if self.path == "/etat":
                    try:
                        self._repondre(200, service.etat())
                    except Exception as e:
                        self._repondre(503, {"erreur": str(e)})
                else:
                    self._repondre(404, {"erreur": "inconnu"})

            def do_POST(self):
                if not self._autorise():
                    return
                longueur = int(self.headers.get("content-length", 0) or 0)
                try:
                    corps = json.loads(self.rfile.read(longueur) or b"{}")
                except json.JSONDecodeError:
                    self._repondre(400, {"erreur": "JSON illisible"})
                    return
                if self.path == "/appels":
                    self._repondre(*service.appeler(corps))
                elif m := re.fullmatch(r"/appels/([0-9a-f-]{36})/raccrocher", self.path):
                    self._repondre(*service.raccrocher(m.group(1)))
                else:
                    self._repondre(404, {"erreur": "inconnu"})

        return Gestionnaire


def servir(cles: dict[str, str], racine: Path) -> int:
    if not cles.get("PONT_SECRET"):
        raise SystemExit("PONT_SECRET manquant dans .env (le script d'installation le génère)")
    Service(cles, racine).lancer(int(cles.get("PONT_PORT", os.environ.get("PONT_PORT", "3021"))))
    return 0
