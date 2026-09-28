"""Le pont en service permanent (ADR 0007), piloté par l'application web.

N'écoute que sur 127.0.0.1. Chaque requête porte `Authorization: Bearer $PONT_SECRET`, et le pont
présente le même secret à l'application quand il la rappelle (`$WEB_URL/api/pont/…`).

    GET  /etat                        le téléphone passerelle et l'appel en cours
    POST /appels                      {appelId, numero, variables, motsCles} : compose
    POST /appels/<id>/raccrocher
    GET  /appels/<id>/evenements      fil de l'appel en SSE (états, tours de parole), rejoué depuis le début
    GET  /appels/<id>/ecoute          prospect et Mina mélangés, PCM 16 bits mono (taux dans x-taux)
    GET  /appairage                   la fenêtre d'appairage et son code
    POST /appairage                   {adresse, remplacer?} : ouvre la fenêtre, filtrée sur cette adresse ;
                                      le téléphone `remplacer` est oublié dès que le nouveau est appairé
    POST /appairage/fermer
    POST /telephone/oublier           {adresse}
    POST /reglages                    {appelsParHeure, appelsParJour, pauseEntreAppelsS}
"""
import hmac
import json
import os
import queue
import re
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import dbus
import dbus.mainloop.glib
from gi.repository import GLib

from .appairage import Appairage
from .appel import Appel, Journal
from .ofono import Telephone, dans_glib
from .plafond import Plafond
from .reglages import Reglages


class RappelsWeb:
    """Ce que l'appel fait savoir à l'application, par ses routes `/api/pont/appels/<id>/…`."""

    def __init__(self, web: str, secret: str, appel_id: str, journal: Journal):
        self._base = f"{web.rstrip('/')}/api/pont/appels/{appel_id}"
        self._secret = secret
        self.journal = journal

    def _poster_avec_relances(self, chemin: str, corps: dict[str, Any]) -> None:
        """Pour ce qui ne doit pas se perdre (conversation, fin) : l'application peut redémarrer à ce moment-là."""
        for attente in (2, 5, 10, None):
            try:
                self._poster(chemin, corps)
                return
            except (urllib.error.URLError, TimeoutError) as e:
                if attente is None:
                    raise
                self.journal(f"l'application ne répond pas ({e}) : nouvel essai dans {attente} s")
                time.sleep(attente)

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
            self._poster_avec_relances("conversation", {"conversationId": conversation_id})
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
            self._poster_avec_relances("fin", bilan)
        except (urllib.error.URLError, TimeoutError) as e:
            self.journal("l'application n'a pas reçu la fin de l'appel :", e)


class Service:
    def __init__(self, cles: dict[str, str], racine: Path):
        self._cles = cles
        self._secret = cles["PONT_SECRET"]
        self._web = cles.get("WEB_URL", "http://127.0.0.1:3020")
        self._dossier = racine / "data" / "pont"
        self._reglages = Reglages(self._dossier / "reglages.json", cles)
        self._plafond = Plafond(
            self._dossier / "historique-appels.json",
            self._reglages.valeurs["appelsParHeure"],
            self._reglages.valeurs["appelsParJour"],
        )
        self.journal = Journal()
        dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
        self._bus = dbus.SystemBus()
        self._boucle = GLib.MainLoop()
        self._telephone = Telephone(self._bus, self.journal)
        self._appairage = Appairage(self._bus, self.journal)
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
        en_cours = next((i for i, a in self._appels.items() if not a.fini()), None)
        return {
            **dans_glib(self._telephone.etat),
            "appelId": en_cours,
            "plafond": self._plafond.refus(),
            "reglages": self._reglages.valeurs,
        }

    def regler(self, corps: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        try:
            valeurs = self._reglages.modifier(corps)
        except ValueError as e:
            return 400, {"erreur": str(e)}
        self._plafond.regler(valeurs["appelsParHeure"], valeurs["appelsParJour"])
        self.journal("réglages modifiés :", valeurs)
        return 200, valeurs

    def appeler(self, corps: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        appel_id = str(corps.get("appelId", ""))
        if not re.fullmatch(r"[0-9a-f-]{36}", appel_id) or not corps.get("numero"):
            return 400, {"erreur": "appelId et numero sont requis"}
        with self._verrou:
            if not self._telephone.libre():
                return 409, {"erreur": "Un appel est déjà en cours sur le téléphone."}
            if raison := self._plafond.refus():
                return 429, {"erreur": raison}
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
            self._plafond.compter()
            self._appels[appel_id] = appel
            threading.Thread(target=self._oublier_a_la_fin, args=(appel_id,), daemon=True).start()
        return 202, {"ok": True}

    def raccrocher(self, appel_id: str) -> tuple[int, dict[str, Any]]:
        appel = self._appels.get(appel_id)
        if not appel:
            return 404, {"erreur": "Appel inconnu du pont."}
        appel.raccrocher()
        return 202, {"ok": True}

    def appairage(self, action: str, corps: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        try:
            if action == "ouvrir":
                remplacer = corps.get("remplacer")
                return 200, dans_glib(lambda: self._appairage.ouvrir(str(corps.get("adresse", "")), remplacer and str(remplacer)))
            if action == "fermer":
                return 200, dans_glib(self._appairage.fermer)
            if action == "oublier":
                dans_glib(lambda: self._appairage.oublier(str(corps.get("adresse", ""))))
                return 200, {"ok": True}
            return 200, dans_glib(self._appairage.resume)
        except ValueError as e:
            return 400, {"erreur": str(e)}
        except Exception as e:
            return 503, {"erreur": str(e)}

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
                chemin, _, requete = self.path.partition("?")
                if chemin == "/etat":
                    try:
                        self._repondre(200, service.etat())
                    except Exception as e:
                        self._repondre(503, {"erreur": str(e)})
                elif chemin == "/appairage":
                    self._repondre(*service.appairage("etat", {}))
                elif m := re.fullmatch(r"/appels/([0-9a-f-]{36})/evenements", chemin):
                    # Reprise après coupure : le navigateur renvoie le numéro du dernier événement reçu.
                    dernier = self.headers.get("last-event-id", "")
                    self._evenements(m.group(1), int(dernier) if dernier.isdigit() else 0)
                elif m := re.fullmatch(r"/appels/([0-9a-f-]{36})/ecoute", chemin):
                    self._ecoute(m.group(1))
                else:
                    self._repondre(404, {"erreur": "inconnu"})

            def _evenements(self, appel_id: str, depuis: int) -> None:
                appel = service._appels.get(appel_id)
                if not appel:
                    self._repondre(404, {"erreur": "Appel inconnu du pont (terminé ?)."})
                    return
                self.send_response(200)
                self.send_header("content-type", "text/event-stream; charset=utf-8")
                self.send_header("cache-control", "no-store")
                self.end_headers()
                try:
                    while True:
                        nouveaux = appel.suivre(depuis)
                        for i, e in enumerate(nouveaux, start=depuis + 1):
                            self.wfile.write(f"id: {i}\ndata: {json.dumps(e, ensure_ascii=False)}\n\n".encode())
                        depuis += len(nouveaux)
                        if not nouveaux:
                            self.wfile.write(b": toujours la\n\n")
                        self.wfile.flush()
                        if appel.fini() and depuis >= len(appel.evenements):
                            return
                except (BrokenPipeError, ConnectionResetError):
                    return

            def _ecoute(self, appel_id: str) -> None:
                appel = service._appels.get(appel_id)
                if not appel:
                    self._repondre(404, {"erreur": "Appel inconnu du pont (terminé ?)."})
                    return
                file = appel.pont.ecouter()
                self.send_response(200)
                self.send_header("content-type", "application/octet-stream")
                self.send_header("x-taux", str(appel.pont.taux_ligne))
                self.send_header("cache-control", "no-store")
                self.end_headers()
                try:
                    while True:
                        try:
                            morceau = file.get(timeout=2)
                        except queue.Empty:
                            if appel.fini():
                                return
                            continue
                        if morceau is None:
                            return
                        self.wfile.write(morceau)
                except (BrokenPipeError, ConnectionResetError):
                    return
                finally:
                    appel.pont.arreter_ecoute(file)

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
                elif self.path == "/appairage":
                    self._repondre(*service.appairage("ouvrir", corps))
                elif self.path == "/appairage/fermer":
                    self._repondre(*service.appairage("fermer", corps))
                elif self.path == "/reglages":
                    self._repondre(*service.regler(corps))
                elif self.path == "/telephone/oublier":
                    self._repondre(*service.appairage("oublier", corps))
                else:
                    self._repondre(404, {"erreur": "inconnu"})

        return Gestionnaire


def servir(cles: dict[str, str], racine: Path) -> int:
    if not cles.get("PONT_SECRET"):
        raise SystemExit("PONT_SECRET manquant dans .env (le script d'installation le génère)")
    Service(cles, racine).lancer(int(cles.get("PONT_PORT", os.environ.get("PONT_PORT", "3021"))))
    return 0
