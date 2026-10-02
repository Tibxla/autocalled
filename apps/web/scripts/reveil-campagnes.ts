/**
 * Réveil des campagnes téléphone (nouvelles tentatives, ADR 0017) : classe les appels finis dont l'entrée attend encore
 * son bilan, puis relance, une à une, les campagnes en cours qui ont quelqu'un à appeler maintenant (une nouvelle
 * tentative arrivée à son heure, un enchaînement resté arrêté sur une ligne occupée). Jamais une campagne en pause. Il
 * passe aussi en échec un appel entrant resté en cours sans conversation (le pont ne l'a jamais pris).
 * Lancé toutes les 5 minutes par autocalled-reveil.timer.
 *
 *   pnpm reveil            classe et relance, puis écrit le compte rendu
 *   pnpm reveil --essai    dit ce qu'il ferait, dans une transaction Postgres en lecture seule : rien n'est écrit ni composé
 *
 * (depuis apps/web : node --env-file=../../.env --conditions=react-server --import ./scripts/resolution.ts
 * scripts/reveil-campagnes.ts [--essai])
 *
 * Hors de 9 h - 19 h (heure de Paris), il classe sans relancer aucune campagne (HEURES_D_APPEL, lib/reveil.ts).
 *
 * Le compte rendu ne contient que des comptes et des identifiants de campagnes (jamais de nom ni de numéro). Hors de
 * Next : les tâches de fond partent par `enFond`, et le pont compose avant que le script rende la main.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { compteRenduReveil, dansLesHeuresDAppel, planReveil, reveiller } from '@/lib/reveil';

const essai = process.argv.includes('--essai');
const inconnus = process.argv.slice(2).filter((a) => a !== '--essai');

async function principal(): Promise<number> {
  if (inconnus.length) {
    console.error(`usage : reveil-campagnes.ts [--essai] (argument inconnu : ${inconnus.join(' ')})`);
    return 2;
  }
  const maintenant = new Date();
  const relancer = dansLesHeuresDAppel(maintenant);
  if (!relancer) console.log('Hors des heures d’appel (9 h - 19 h, heure de Paris) : aucune campagne n’est relancée.');
  if (essai) {
    // La garantie vient de Postgres, pas du code : toute écriture dans cette transaction serait refusée.
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      return planReveil(maintenant, tx);
    });
    const relancees = relancer ? plan.aRelancer : [];
    console.log(compteRenduReveil({ classes: plan.aClasser.length, relancees, orphelins: plan.orphelins.length }, true));
    return 0;
  }
  console.log(compteRenduReveil(await reveiller(maintenant, { relancer }), false));
  return 0;
}

let code = 1;
try {
  code = await principal();
} catch (erreur) {
  console.error(`Réveil interrompu : ${(erreur as Error).message}`);
} finally {
  await db.$client.end();
}
process.exit(code);
