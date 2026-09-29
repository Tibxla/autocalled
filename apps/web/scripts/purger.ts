/**
 * Purge les données personnelles des appels passés la durée de conservation (ADR 0014) : enregistrements,
 * transcriptions, texte libre des bilans et des erreurs, adresses d'invitation ; puis les lignes du journal MCP plus
 * vieilles que la durée. Garde l'issue, l'étape atteinte, les objections, la durée, les dates, la ligne et les versions.
 * La liste d'opposition n'est jamais touchée. Idempotent : lancé chaque jour par autocalled-purge.timer.
 *
 *   pnpm purger            purge, puis écrit le compte rendu
 *   pnpm purger --essai    compte seulement, dans une transaction Postgres en lecture seule : rien n'est écrit ni supprimé
 *
 * (depuis apps/web : node --env-file=../../.env --conditions=react-server --import ./scripts/resolution.ts
 * scripts/purger.ts [--essai])
 *
 * Durée : DUREE_CONSERVATION_MOIS dans le .env (12 par défaut, 1 au moins). Le compte rendu ne contient que des
 * comptes et, en cas d'échec, des chemins de fichiers relatifs au dossier de données (identifiants d'appels, jamais
 * de nom ni de numéro). Code de sortie 1 si un fichier n'a pas pu être supprimé ou si la purge a échoué.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { compteRendu, dureeConservationMois, inventairePurge, purger } from '@/lib/conservation';

const essai = process.argv.includes('--essai');
const inconnus = process.argv.slice(2).filter((a) => a !== '--essai');

async function principal(): Promise<number> {
  if (inconnus.length) {
    console.error(`usage : purger.ts [--essai] (argument inconnu : ${inconnus.join(' ')})`);
    return 2;
  }
  const mois = dureeConservationMois();
  const maintenant = new Date();
  if (essai) {
    // La garantie vient de Postgres, pas du code : toute écriture dans cette transaction serait refusée.
    const inventaire = await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      return inventairePurge(maintenant, { mois, lecteur: tx });
    });
    console.log(compteRendu(inventaire, true));
    return 0;
  }
  const resultat = await purger(maintenant, { mois });
  console.log(compteRendu(resultat, false));
  return resultat.fichiersEnEchec.length ? 1 : 0;
}

let code = 1;
try {
  code = await principal();
} catch (erreur) {
  console.error(`Purge interrompue : ${(erreur as Error).message}`);
} finally {
  await db.$client.end();
}
process.exit(code);
