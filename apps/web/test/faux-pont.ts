import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type RequetePont = { methode: string; chemin: string; corps: unknown; secret: string | undefined };

/**
 * Un pont Bluetooth factice (ADR 0007) sur un port libre de 127.0.0.1 : il répond comme le vrai à /etat,
 * /appels, /reglages et /raccrocher, et garde chaque requête reçue. Rien ne compose jamais.
 */
export async function fauxPont(etat: { plafond?: string | null; reglages?: Record<string, number> } = {}) {
  const requetes: RequetePont[] = [];
  let reglages = { appelsParHeure: 15, appelsParJour: 50, pauseEntreAppelsS: 5, ...etat.reglages };
  const serveur: Server = createServer((req, res) => {
    let brut = '';
    req.on('data', (d) => (brut += d));
    req.on('end', () => {
      const corps = brut ? JSON.parse(brut) : undefined;
      requetes.push({ methode: req.method ?? '', chemin: req.url ?? '', corps, secret: req.headers.authorization });
      const repondre = (code: number, json: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.url === '/etat') return repondre(200, { connecte: true, appelEnCours: false, plafond: etat.plafond ?? null, reglages });
      if (req.url === '/appels' && req.method === 'POST') return repondre(202, { ok: true });
      if (req.url === '/reglages' && req.method === 'POST') {
        reglages = { ...reglages, ...(corps as object) };
        return repondre(200, reglages);
      }
      if (/^\/appels\/[0-9a-f-]{36}\/raccrocher$/.test(req.url ?? '')) return repondre(200, { ok: true });
      repondre(404, { erreur: 'inconnu du faux pont' });
    });
  });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const precedent = process.env.PONT_URL;
  process.env.PONT_URL = url;
  return {
    url,
    requetes,
    /** Les compositions demandées au pont. */
    compositions: () => requetes.filter((r) => r.chemin === '/appels'),
    fermer: async () => {
      process.env.PONT_URL = precedent;
      await new Promise((ok) => serveur.close(ok));
    },
  };
}
