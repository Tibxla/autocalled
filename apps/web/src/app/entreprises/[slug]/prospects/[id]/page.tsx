import { and, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PastilleAutorisation } from '@/components/pastille-autorisation';
import { Bouton, EtatVide, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { prospects } from '@/db/schema';
import { autorisationsDe } from '@/lib/autorisations';
import { entrepriseParSlug, prospectParId } from '@/lib/donnees';
import { numeroLisible } from '@/lib/format';
import { BoutonRevoquer } from './bouton-revoquer';

export const metadata: Metadata = { title: 'Prospect' };

const dateLongue = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' });

export default async function PageProspect({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const prospect = await prospectParId(entreprise.id, id);
  const [autorisations, partages] = await Promise.all([
    autorisationsDe([prospect.telephone]),
    db.$count(prospects, and(eq(prospects.entrepriseId, entreprise.id), eq(prospects.telephone, prospect.telephone))),
  ]);
  const autorisation = autorisations.get(prospect.telephone);

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid content-start gap-10">
        <div className="grid gap-1">
          <Link href={`/entreprises/${slug}/prospects`} className="text-sm text-encre-3 hover:text-encre">
            Prospects
          </Link>
          <h2 className="text-lg font-semibold">{prospect.nom}</h2>
          <p className="text-encre-2">{[prospect.role, prospect.societe].filter(Boolean).join(', ')}</p>
        </div>

        <section className="grid gap-4">
          <TitreSection>Ce que Mina sait</TitreSection>
          <p className="max-w-[68ch] leading-relaxed whitespace-pre-line">{prospect.contexte || 'Pas de contexte dans la fiche.'}</p>
          <p className="text-sm text-encre-3">
            Fiche <span className="font-mono">{prospect.id}.md</span>, mise à jour le {dateLongue.format(prospect.majLe)}.
          </p>
        </section>

        <section className="grid">
          <TitreSection>Appels</TitreSection>
          <EtatVide titre="Aucun appel pour l’instant">
            Chaque appel s’affichera ici avec son issue et son bilan, et Mina s’en souviendra au prochain appel.
          </EtatVide>
        </section>
      </div>

      <aside className="grid content-start gap-6">
        <div className="grid gap-3 border-t border-filet pt-4">
          <p className="font-mono text-lg tracking-[-0.01em]">{numeroLisible(prospect.telephone)}</p>
          <PastilleAutorisation autorisation={autorisation} />
          {partages > 1 ? <p className="text-sm text-encre-3">Numéro partagé par {partages} prospects.</p> : null}
        </div>
        <div className="grid gap-2">
          <Bouton type="button" disabled aria-describedby="appel-indisponible">
            Appeler {prospect.nom.split(' ')[0]}
          </Bouton>
          <p id="appel-indisponible" className="text-sm text-encre-3">
            La ligne n’est pas encore branchée.
          </p>
        </div>
        {autorisation?.autorise ? <BoutonRevoquer numero={prospect.telephone} partages={partages} /> : null}
      </aside>
    </div>
  );
}
