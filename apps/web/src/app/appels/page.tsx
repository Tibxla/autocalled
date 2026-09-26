import { desc, eq, and } from 'drizzle-orm';
import type { Metadata } from 'next';
import { ListeAppels } from '@/components/liste-appels';
import { EnTetePage, EtatVide } from '@/components/ui';
import { db } from '@/db';
import { appels, entreprises, prospects } from '@/db/schema';

export const metadata: Metadata = { title: 'Appels' };

export default async function PageAppels() {
  const liste = await db
    .select({ appel: appels, prospect: prospects.nom, entreprise: entreprises.nom })
    .from(appels)
    .innerJoin(entreprises, eq(entreprises.id, appels.entrepriseId))
    .leftJoin(prospects, and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId)))
    .orderBy(desc(appels.debutLe))
    .limit(200);

  return (
    <>
      <EnTetePage
        titre="Appels"
        sousTitre="Tous les appels, du plus récent au plus ancien. Chaque appel ouvre son enregistrement, sa transcription et son bilan."
      />
      {liste.length === 0 ? (
        <EtatVide titre="Aucun appel pour l’instant">Lance un appel depuis la fiche d’un prospect ou depuis une campagne.</EtatVide>
      ) : (
        <ListeAppels
          appels={liste.map(({ appel, prospect, entreprise }) => ({
            ...appel,
            resume: appel.bilan?.resume ?? null,
            prospect: `${prospect ?? appel.prospectId} · ${entreprise}`,
          }))}
        />
      )}
    </>
  );
}
