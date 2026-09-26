import { chiffrer, creerCalendrier, echangerCode, listerCalendriers } from '@autocalled/agenda';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { connexionGoogle } from '@/db/schema';
import { cleChiffrement, clientGoogle } from '@/lib/google';
import { exigerOperateur } from '@/lib/garde';

const NOM_CALENDRIER = 'Autocalled';

/** Retour du consentement Google : on garde le jeton chiffré et on crée le calendrier dédié s'il manque. */
export async function GET(requete: Request) {
  await exigerOperateur();
  const client = clientGoogle();
  const url = new URL(requete.url);
  const retour = (etat: string) => NextResponse.redirect(`${process.env.ORIGINE_APP ?? ''}/reglages?google=${etat}`);
  const pot = await cookies();
  const attendu = pot.get('etat_google')?.value;
  pot.delete({ name: 'etat_google', path: '/google' });
  if (!client || !attendu || url.searchParams.get('state') !== attendu) return retour('refuse');
  const code = url.searchParams.get('code');
  if (!code) return retour('annule');

  const { refreshToken, accessToken, email } = await echangerCode(client, code);
  const existant = (await listerCalendriers(accessToken)).find((c) => c.nom === NOM_CALENDRIER);
  const calendrierId = existant?.id ?? (await creerCalendrier(accessToken, NOM_CALENDRIER, 'Europe/Paris'));
  const valeurs = { id: 1, email, jetonChiffre: chiffrer(refreshToken, cleChiffrement()), calendrierId, connecteLe: new Date() };
  await db.insert(connexionGoogle).values(valeurs).onConflictDoUpdate({ target: connexionGoogle.id, set: valeurs });
  return retour('connecte');
}
