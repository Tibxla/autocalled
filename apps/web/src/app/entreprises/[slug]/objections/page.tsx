import { asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { EtatVide, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { objections } from '@/db/schema';
import { entrepriseParSlug } from '@/lib/donnees';
import { basculerArchiveObjection } from '../actions';
import { BoutonArchive } from '@/components/bouton-archive';
import { FormulaireObjection } from './formulaire-objection';

export const metadata: Metadata = { title: 'Objections' };

export default async function PageObjections({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const liste = await db
    .select()
    .from(objections)
    .where(eq(objections.entrepriseId, entreprise.id))
    .orderBy(asc(objections.ordre));
  const actives = liste.filter((o) => !o.archivee);
  const archivees = liste.filter((o) => o.archivee);

  return (
    <div className="grid max-w-[48rem] gap-12">
      <p className="max-w-[62ch] text-encre-2">
        Mina traite chaque objection en quatre temps : creuser, reformuler, argumenter, contrôler. Les bilans diront à quel temps
        une objection a coincé.
      </p>

      <section className="grid">
        <TitreSection>Objections connues</TitreSection>
        {actives.length === 0 ? (
          <EtatVide titre="Aucune objection préparée">
            Commence par celles que tu entends le plus : « ça ne m’intéresse pas », « c’est combien ? », « envoyez-moi un mail ».
          </EtatVide>
        ) : (
          <ul>
            {actives.map((o) => (
              <li key={o.id} className="border-b border-filet">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden">
                    <span className="font-medium">{o.libelle}</span>
                    <span className="text-sm text-encre-3 group-open:hidden">
                      {[o.creuser, o.reformuler, o.argumenter, o.controler].filter(Boolean).length} temps sur 4
                    </span>
                  </summary>
                  <FormulaireObjection entrepriseId={entreprise.id} objection={o} />
                  <div className="-mt-4 pb-6">
                    <BoutonArchive archivee={false} action={basculerArchiveObjection.bind(null, entreprise.id, o.id, true)} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid">
        <TitreSection>Nouvelle objection</TitreSection>
        <FormulaireObjection key={actives.length} entrepriseId={entreprise.id} />
      </section>

      {archivees.length > 0 ? (
        <section className="grid">
          <TitreSection>Archivées</TitreSection>
          <ul>
            {archivees.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-4 border-b border-filet py-3 text-encre-3">
                <span>{o.libelle}</span>
                <BoutonArchive archivee action={basculerArchiveObjection.bind(null, entreprise.id, o.id, false)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
