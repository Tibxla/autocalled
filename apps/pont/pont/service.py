"""Le pont en service permanent (ADR 0007), piloté par l'application web.

N'écoute que sur 127.0.0.1. Chaque requête porte `Authorization: Bearer $PONT_SECRET`, et le pont
présente le même secret à l'application quand il la rappelle (`$WEB_URL/api/pont/…`).

    GET  /etat                        le téléphone passerelle, l'appel en cours (décroché) et son sens, le plafond ;
                                      `appelEnCours` et `entrantEnCours` sont vrais dès qu'un appel entrant sonne
    POST /appels                      {appelId, numero, variables, motsCles, premierMessage?, ouverture?} : compose ;
                                      premierMessage est la phrase dite si le prospect se tait au décroché (« Allô ? »
                                      sans elle), ouverture celle dite juste après un accueil court (sans elle, le
                                      modèle ouvre)
                                      ; 409 tant qu'un appel est en cours, entrant compris (même s'il sonne sans réponse)
    POST /appels/<id>/raccrocher
    GET  /appels/<id>/evenements      fil de l'appel en SSE (états, tours de parole, étapes du plan), rejoué depuis le début ;
                                      s'y glissent, sans `id:` et sans rejeu, les niveaux des deux voix (voir plus bas)
    GET  /appels/<id>/ecoute          prospect et Mina mélangés, PCM 16 bits mono (taux dans x-taux)
    GET  /appairage                   la fenêtre d'appairage et son code
    POST /appairage                   {adresse, remplacer?} : ouvre la fenêtre, filtrée sur cette adresse ;
                                      le téléphone `remplacer` est oublié dès que le nouveau est appairé
    POST /appairage/fermer
    POST /telephone/oublier           {adresse}
    POST /telephone/reconnecter       relance la liaison Bluetooth du téléphone (hors appel)
    POST /reglages                    {appelsParHeure, appelsParJour, pauseEntreAppelsS}

Prise de main (ADR 0008), WebSocket sur 127.0.0.1:PONT_PORT_WS, joint par `tailscale serve` sous /prise-en-main :
    /appels/<id>   le navigateur de l'opérateur envoie sa voix (PCM 16 kHz) et reçoit le prospect ;
                   accepté seulement si l'en-tête Tailscale-User-Login est celui de l'opérateur (ADR 0006)
                   et si l'en-tête Origin est celui de l'interface (ORIGINE_APP).

Appel entrant (ADR 0018) : à sa sonnerie, ligne libre et numéro reçu, le pont demande à l'application qui appelle,
    POST $WEB_URL/api/pont/entrants   {numero} brut, tel que le téléphone le donne (l'application le normalise)
                                      → {decrocher: true, appelId, variables, motsCles, premierMessage} : Mina décroche
                                        et ouvre aussitôt par premierMessage ; l'appel suit ensuite le chemin d'un
                                        sortant (fil, écoute, prise de main, rappels `/api/pont/appels/<id>/…`,
                                        bilan avec "sens": "entrant") ;
                                      → {decrocher: false}, une erreur ou plus de 3 s : le téléphone sonne, sans réponse.
    Un entrant ne compte pas au plafond et n'est jamais recomposé. Le pont ne raccroche jamais un entrant qu'il ne
    prend pas : il sonne jusqu'à la messagerie.

Fil d'un appel (`data:` de chaque message SSE, JSON). `t` : heure du pont, en millisecondes depuis l'epoch.
    id: n   {"type": "etat", "etat": "composition" | "entrant" | "alerting" | "active" | "prise-en-main" | …, "t": …}
    id: n   {"type": "tour", "role": "agent" | "prospect", "texte": "…", "t": …}
            {"type": "niveaux", "t": …, "pasMs": 50, "mina": [0.42, 0.1], "prospect": [0, 0.07]}
Les niveaux (RMS de chaque fenêtre de `pasMs`, ramenés sur [0, 1], voir `audio.Niveaux`) arrivent par lots d'un
ou quelques relevés, à partir du décroché ; `t` est l'heure du dernier relevé du lot, les précédents le suivent
de `pasMs` en `pasMs`. `mina` est ce que le pont envoie au téléphone : la voix de l'opérateur après une prise de
main. Ils ne portent pas d'`id:` : une reconnexion reprend au dernier état ou tour, sans rejouer de niveaux.
"""
import asyncio
import hmac
import http.client
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

from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from .appairage import Appairage
from .appel import Appel, Journal, ouverture_valide, premier_message_valide
from .audio import NIVEAU_PAS_MS
from .ofono import LigneOccupee, Telephone, dans_glib, masquer
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


DELAI_ENTRANT_S = 3.0  # l'appelant entend sonner pendant la question : au-delà, on laisse sonner
APPEL_ID = re.compile(r"[0-9a-f-]{36}")


def lire_decision_entrant(corps: Any) -> dict[str, Any] | None:
    """La réponse de l'application à un appel entrant, si elle dit de décrocher et qu'elle est complète ; sinon None."""
    if not isinstance(corps, dict) or corps.get("decrocher") is not True:
        return None
    appel_id, variables, mots_cles = corps.get("appelId"), corps.get("variables", {}), corps.get("motsCles", [])
    if not isinstance(appel_id, str) or not APPEL_ID.fullmatch(appel_id):
        return None
    if not isinstance(variables, dict) or not isinstance(mots_cles, list):
        return None
    return {
        "appelId": appel_id,
        "variables": dict(variables),
        "motsCles": list(mots_cles),
        "premierMessage": premier_message_valide(corps.get("premierMessage")),
    }


def demander_entrant(web: str, secret: str, numero: str, delai: float = DELAI_ENTRANT_S) -> tuple[dict[str, Any] | None, str]:
    """Demande à l'application si elle décroche cet appel entrant : (décision, motif pour le journal). La décision
    est None pour un inconnu, une réponse illisible, une erreur ou un délai dépassé : le téléphone sonne alors."""
    requete = urllib.request.Request(
        f"{web.rstrip('/')}/api/pont/entrants",
        data=json.dumps({"numero": numero}).encode(),
        headers={"content-type": "application/json", "authorization": f"Bearer {secret}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(requete, timeout=delai) as r:
            corps = json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        e.close()
        return None, f"l'application a répondu {e.code}"
    except (OSError, ValueError, http.client.HTTPException) as e:  # application absente, délai dépassé, réponse tronquée, JSON illisible
        return None, f"l'application n'a pas répondu ({e})"
    decision = lire_decision_entrant(corps)
    if decision is None:
        return None, "numéro inconnu de l'application" if isinstance(corps, dict) and corps.get("decrocher") is False else "réponse illisible"
    return decision, "prospect reconnu"


def lot_de_niveaux(releves: list[tuple[int, float, float]]) -> dict[str, Any]:
    """Relevés (t ms, mina, prospect) consécutifs → un message du fil, daté de son dernier relevé."""
    return {
        "type": "niveaux",
        "t": releves[-1][0],
        "pasMs": NIVEAU_PAS_MS,
        "mina": [m for _, m, _ in releves],
        "prospect": [p for _, _, p in releves],
    }


def etat_du_plafond(plafond: Plafond, maintenant: float | None = None) -> dict[str, Any]:
    """`plafond` : la phrase du refus ou None ; `plafondJusqua` : l'heure (ms depuis l'epoch) du prochain appel possible."""
    maintenant = maintenant or time.time()
    prochain = plafond.prochain(maintenant)
    return {"plafond": plafond.refus(maintenant), "plafondJusqua": int(prochain * 1000) if prochain else None}


def decroche_le(appel: Any) -> int | None:
    """L'heure du décroché (ms depuis l'epoch) : celle du premier état « active » du fil, lue sans rien modifier."""
    if appel is None:
        return None
    return next((e.get("t") for e in list(appel.evenements) if e.get("type") == "etat" and e.get("etat") == "active"), None)


NUMERO_E164 = re.compile(r"\+[1-9][0-9]{7,14}")


def numero_valide(numero: Any) -> bool:
    """Un numéro E.164, rien d'autre : le téléphone passerelle interpréterait un code de service (`**21*…#`,
    renvoi d'appel) au lieu de composer. L'application ne compose que des numéros validés ; c'est une seconde garde."""
    return isinstance(numero, str) and NUMERO_E164.fullmatch(numero) is not None


def origine_attendue(cles: dict[str, str]) -> str | None:
    """L'origine de l'interface (`ORIGINE_APP`), sans barre finale, en minuscules ; None si elle manque."""
    origine = cles.get("ORIGINE_APP", "").strip().rstrip("/").lower()
    return origine or None


def prise_de_main_autorisee(login: str | None, origine: str | None, operateur: str, attendue: str | None) -> bool:
    """La poignée de main du WebSocket de prise de main : l'identité de l'opérateur (posée par `tailscale serve`)
    ET l'origine de l'interface. Une page tierce ouverte sur un appareil de l'opérateur porte aussi son identité
    (les WebSocket échappent à CORS), mais pas cette origine."""
    if not operateur or (login or "").strip().lower() != operateur:
        return False
    return attendue is not None and (origine or "").strip().rstrip("/").lower() == attendue


def preparer_dossier(dossier: Path) -> None:
    """Transcriptions et enregistrements : lisibles par le seul compte du service."""
    dossier.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(dossier, 0o700)


class Service:
    def __init__(self, cles: dict[str, str], racine: Path):
        self._cles = cles
        self._secret = cles["PONT_SECRET"]
        self._web = cles.get("WEB_URL", "http://127.0.0.1:3020")
        self._dossier = racine / "data" / "pont"
        preparer_dossier(self._dossier)
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
        self._telephone.sur_entrant = self._sur_entrant
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
        port_ws = int(self._cles.get("PONT_PORT_WS", "3022"))
        threading.Thread(target=lambda: asyncio.run(self._prise_de_main(port_ws)), daemon=True, name="ws").start()
        self.journal(f"pont prêt sur 127.0.0.1:{port} (prise de main sur {port_ws})")
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
        appel = self._appels.get(en_cours) if en_cours else None
        return {
            **dans_glib(self._telephone.etat),
            "appelId": en_cours,
            "sens": appel.sens if appel else None,
            **etat_du_plafond(self._plafond),
            # .get : l'appel peut être oublié entre les deux lectures (fin d'appel), sans faire tomber /etat.
            "decrocheLe": decroche_le(self._appels.get(en_cours)) if en_cours else None,
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
        if not numero_valide(corps["numero"]):
            return 400, {"erreur": "numero doit être un numéro au format international (+33…)"}
        with self._verrou:
            if not self._telephone.libre():
                if self._telephone.entrant_en_cours():
                    return 409, {"erreur": "Un appel entrant est en cours sur le téléphone."}
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
                premier_message_valide(corps.get("premierMessage")),
                plafond=self._plafond,  # chaque composition y compte, recomposition comprise
                ouverture=ouverture_valide(corps.get("ouverture")),
            )
            rappels.journal = appel.journal
            # Suivi avant la composition : si la boucle D-Bus tarde, l'appel reste raccrochable et visible dans /etat.
            self._appels[appel_id] = appel
            try:
                dans_glib(appel.lancer)
            except LigneOccupee as e:
                # Un prospect rappelle depuis la lecture de `libre()` : rien n'est composé ni compté au plafond.
                self._appels.pop(appel_id, None)
                appel.journal("composition refusée :", e)
                return 409, {"erreur": f"Ligne occupée : {e}."}
            except TimeoutError as e:
                # La composition est programmée et peut encore partir : elle est annulée, ou raccrochée si elle part.
                appel.annuler()
                appel.journal("composition impossible :", e)
                threading.Thread(target=self._oublier_a_la_fin, args=(appel_id,), daemon=True).start()
                return 503, {"erreur": f"Composition impossible : {e}"}
            except Exception as e:
                self._appels.pop(appel_id, None)
                appel.journal("composition impossible :", e)
                return 503, {"erreur": f"Composition impossible : {e}"}
            threading.Thread(target=self._oublier_a_la_fin, args=(appel_id,), daemon=True).start()
        return 202, {"ok": True}

    def _sur_entrant(self, chemin: str, numero: str, generation: int | None = None) -> None:
        """Depuis le thread GLib : la question à l'application prend jusqu'à 3 s, elle part dans un thread à part."""
        threading.Thread(target=self._evaluer_entrant, args=(chemin, numero, generation), daemon=True, name="entrant").start()

    def _evaluer_entrant(self, chemin: str, numero: str, generation: int | None = None) -> None:
        """Décroche un appel entrant si l'application reconnaît un prospect, sinon le laisse sonner. Sous le verrou des
        compositions : un `POST /appels` simultané attend la décision (et reçoit 409 tant que l'entrant est là)."""
        with self._verrou:
            # Un appel précédent qui n'a pas fini son bilan occupe encore l'application : on ne crée pas de ligne
            # `appels` qu'on ne pourrait pas tenir.
            if self._telephone.en_appel() or any(not a.fini() for a in list(self._appels.values())):
                self.journal("appel entrant du", masquer(numero), "pendant un appel : il sonne sans réponse")
                self._laisser_sonner(chemin, generation)
                return
            decision, motif = demander_entrant(self._web, self._secret, numero)
            self.journal("appel entrant du", masquer(numero), ":", motif)
            if decision is None:
                self._laisser_sonner(chemin, generation)
                return
            appel_id = decision["appelId"]
            rappels = RappelsWeb(self._web, self._secret, appel_id, self.journal)
            try:
                appel = Appel(
                    self._telephone,
                    numero,
                    decision["variables"],
                    decision["motsCles"],
                    self._cles,
                    self._dossier,
                    appel_id,
                    rappels,
                    decision["premierMessage"],
                    entrant=chemin,  # hors plafond : il ne compte que les compositions
                    generation=generation,
                )
            except Exception as e:
                # La ligne `appels` existe déjà côté application : elle doit recevoir sa fin.
                self.journal("appel entrant impossible à préparer :", e)
                self._laisser_sonner(chemin, generation)
                threading.Thread(
                    target=rappels.fin, args=({"raison": "décroché impossible", "conversationId": None, "sens": "entrant"},), daemon=True
                ).start()
                return
            rappels.journal = appel.journal
            self._appels[appel_id] = appel
            try:
                dans_glib(appel.decrocher)
            except TimeoutError as e:
                appel.journal("décroché impossible :", e)
                appel.annuler()  # la fin part vers l'application ; raccroché s'il a été pris entre-temps
            threading.Thread(target=self._oublier_a_la_fin, args=(appel_id,), daemon=True).start()

    def _laisser_sonner(self, chemin: str, generation: int | None = None) -> None:
        try:
            dans_glib(lambda: self._telephone.laisser_sonner(chemin, generation))
        except Exception as e:
            self.journal("canal son de l'appel entrant non rendu :", e)

    def raccrocher(self, appel_id: str) -> tuple[int, dict[str, Any]]:
        appel = self._appels.get(appel_id)
        if not appel:
            return 404, {"erreur": "Appel inconnu du pont."}
        appel.raccrocher()
        return 202, {"ok": True}

    def reconnecter(self) -> tuple[int, dict[str, Any]]:
        """Relance la liaison Bluetooth du téléphone à distance (liaison figée, téléphone hors de portée revenu)."""
        if not self._telephone.libre():
            return 409, {"erreur": "Un appel est en cours : raccroche d'abord."}
        modem = dans_glib(self._telephone.modem_connu)
        if not modem:
            return 404, {"erreur": "Aucun téléphone appairé."}
        self.journal("reconnexion du téléphone demandée depuis l'application")
        threading.Thread(target=self._telephone.reconnecter, args=(modem,), daemon=True).start()
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

    # --- prise de main (WebSocket) ---------------------------------------------------------------------

    async def _prise_de_main(self, port: int) -> None:
        operateur = self._cles.get("OPERATEUR_TAILSCALE_LOGIN", "").strip().lower()
        attendue = origine_attendue(self._cles)
        if attendue is None:
            self.journal("ORIGINE_APP absente du .env : toute prise de main sera refusée")

        def verifier(connexion: ServerConnection, requete):
            # Identité posée par `tailscale serve`, et origine de l'interface ; sinon, refus.
            if not prise_de_main_autorisee(
                requete.headers.get("Tailscale-User-Login"), requete.headers.get("Origin"), operateur, attendue
            ):
                return connexion.respond(403, "Prise de main réservée à l'opérateur, depuis l'interface.\n")
            return None

        async with serve(self._relier, "127.0.0.1", port, process_request=verifier, max_size=2**16):
            await asyncio.Future()

    async def _relier(self, ws: ServerConnection) -> None:
        m = re.fullmatch(r"(?:/prise-en-main)?/appels/([0-9a-f-]{36})/?", ws.request.path)
        appel = self._appels.get(m.group(1)) if m else None
        if not appel or appel.fini():
            await ws.close(4404, "appel inconnu ou terminé")
            return
        boucle = asyncio.get_running_loop()
        try:
            await boucle.run_in_executor(None, appel.prendre_la_main)
        except ValueError as e:
            await ws.close(4409, str(e))
            return
        await ws.send(json.dumps({"taux": appel.pont.taux_ligne}))
        file = appel.pont.ecouter_prospect()

        def attendre_morceau() -> bytes | None:
            """Regroupe le prospect par 20 ms ; None à la fin de l'appel."""
            paquet, cible = bytearray(), appel.pont.taux_ligne * 2 // 50
            while len(paquet) < cible:
                try:
                    morceau = file.get(timeout=1)
                except queue.Empty:
                    if appel.fini():
                        return None
                    continue
                if morceau is None:
                    return None
                paquet += morceau
            return bytes(paquet)

        async def descendre():
            while (morceau := await boucle.run_in_executor(None, attendre_morceau)) is not None:
                await ws.send(morceau)

        async def monter():
            async for message in ws:
                if isinstance(message, bytes):
                    appel.pont.voix_operateur(message)

        taches = [asyncio.create_task(descendre()), asyncio.create_task(monter())]
        try:
            await asyncio.wait(taches, return_when=asyncio.FIRST_COMPLETED)
        except ConnectionClosed:
            pass
        finally:
            for t in taches:
                t.cancel()
            appel.pont.arreter_prospect(file)
            await ws.close()

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
                curseur = appel.pont.niveaux.curseur()
                derniere_ecriture = time.monotonic()
                try:
                    while True:
                        # Réveil tous les dixièmes de seconde pour les niveaux ; un état ou un tour réveille aussitôt.
                        nouveaux = appel.suivre(depuis, delai=0.1)
                        for i, e in enumerate(nouveaux, start=depuis + 1):
                            self.wfile.write(f"id: {i}\ndata: {json.dumps(e, ensure_ascii=False)}\n\n".encode())
                        depuis += len(nouveaux)
                        curseur, releves = appel.pont.niveaux.depuis(curseur)
                        if releves:
                            self.wfile.write(f"data: {json.dumps(lot_de_niveaux(releves))}\n\n".encode())
                        if nouveaux or releves:
                            derniere_ecriture = time.monotonic()
                        elif time.monotonic() - derniere_ecriture > 15:
                            self.wfile.write(b": toujours la\n\n")
                            derniere_ecriture = time.monotonic()
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
                elif self.path == "/telephone/reconnecter":
                    self._repondre(*service.reconnecter())
                elif self.path == "/telephone/oublier":
                    self._repondre(*service.appairage("oublier", corps))
                else:
                    self._repondre(404, {"erreur": "inconnu"})

        return Gestionnaire


def servir(cles: dict[str, str], racine: Path) -> int:
    if not cles.get("PONT_SECRET"):
        raise SystemExit("PONT_SECRET manquant dans .env (le script d'installation le génère)")
    os.umask(0o077)  # journaux, enregistrements, plafond : au seul compte du service
    Service(cles, racine).lancer(int(cles.get("PONT_PORT", os.environ.get("PONT_PORT", "3021"))))
    return 0
