import 'server-only';
import { type ClientOAuth, dechiffrer, jetonAcces } from '@autocalled/agenda';
import { db } from '@/db';
import { connexionGoogle } from '@/db/schema';

export function clientGoogle(): ClientOAuth | null {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, ORIGINE_APP: origine } = process.env;
  if (!clientId || !clientSecret || !origine) return null;
  return { clientId, clientSecret, redirectUri: `${origine}/google/retour` };
}

export function cleChiffrement(): string {
  const cle = process.env.CLE_CHIFFREMENT;
  if (!cle) throw new Error("variable d'environnement manquante : CLE_CHIFFREMENT");
  return cle;
}

export async function connexion() {
  const [ligne] = await db.select().from(connexionGoogle).limit(1);
  return ligne ?? null;
}

/** Jeton d'accès frais à partir du jeton de rafraîchissement chiffré en base. */
export async function accesGoogle(): Promise<{ acces: string; calendrierId: string } | null> {
  const client = clientGoogle();
  const ligne = await connexion();
  if (!client || !ligne) return null;
  return { acces: await jetonAcces(client, dechiffrer(ligne.jetonChiffre, cleChiffrement())), calendrierId: ligne.calendrierId };
}
