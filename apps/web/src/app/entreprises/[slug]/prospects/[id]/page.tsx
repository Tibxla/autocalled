import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ListeAppels } from '@/components/liste-appels';
import { PastilleAutorisation } from '@/components/pastille-autorisation';
import { EtatVide, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { appels, consentements, prospects } from '@/db/schema';
import { autorisationsDe } from '@/lib/autorisations';
import { entrepriseParSlug, prospectParId } from '@/lib/donnees';
import { numeroLisible } from '@/lib/format';
import { versionsDeLEntreprise } from '@/lib/versions';
import { BoutonRevoquer } from './bouton-revoquer';
import { PanneauAppel } from './panneau-appel';

export const metadata: Metadata = { title: 'Prospect' };

const dateLongue = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });

export default async function PageProspect({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const prospect = await prospectParId(entreprise.id, id);
  const [autorisations, partages] = await Promise.all([
    autorisationsDe([prospect.telephone]),
    db.$count(prospects, and(eq(prospects.entrepriseId, entreprise.id), eq(prospects.telephone, prospect.telephone))),
  ]);
  const autorisation = autorisations.get(prospect.telephone);
  const [versions, historique] = await Promise.all([
    versionsDeLEntreprise(entreprise.id),
    db
      .select()
      .from(appels)
      .where(and(eq(appels.entrepriseId, entreprise.id), eq(appels.prospectId, prospect.id)))
      .orderBy(desc(appels.debutLe)),
  ]);
  const [derniereRevocation] = await db
    .select({ le: consentements.revoqueLe })
    .from(consentements)
    .where(and(eq(consentements.numero, prospect.telephone), isNotNull(consentements.revoqueLe)))
    .orderBy(desc(consentements.revoqueLe))
    .limit(1);
  const revocation = autorisation?.autorise ? null : (derniereRevocation?.le ?? null);

  return (
    <div className="grid gap-10">
      <div className="grid gap-1">
          <Link href={`/entreprises/${slug}/prospects`} className="text-sm text-encre-3 hover:text-encre">
            Prospects
          </Link>
          <h2 className="text-lg font-semibold">{prospect.nom}</h2>
          <p className="text-encre-2">{[prospect.role, prospect.societe].filter(Boolean).join(', ')}</p>
        </div>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid content-start gap-10">

        <section className="grid gap-4">
          <TitreSection>Ce que Mina sait</TitreSection>
          <p className="max-w-[68ch] leading-relaxed whitespace-pre-line">{prospect.contexte || 'Pas de contexte dans la fiche.'}</p>
          <p className="text-sm text-encre-3">
            Fiche <span className="font-mono">{prospect.id}.md</span>, mise à jour le{' '}
            <span className="font-mono">{dateLongue.format(prospect.majLe)}</span>.
          </p>
        </section>

        <section className="grid">
          <TitreSection>Appels</TitreSection>
          {historique.length === 0 ? (
            <EtatVide titre="Aucun appel pour l’instant">
              Chaque appel s’affichera ici avec son issue et son bilan, et Mina s’en souviendra au prochain appel.
            </EtatVide>
          ) : (
            <ListeAppels appels={historique.map((a) => ({ ...a, resume: a.bilan?.resume ?? null }))} />
          )}
        </section>
      </div>

      <aside className="order-first grid content-start gap-8 lg:order-none">
        <div className="grid gap-3 border-t border-filet pt-4">
          <p className="font-mono text-lg tracking-[-0.01em]">{numeroLisible(prospect.telephone)}</p>
          {prospect.email ? <p className="font-mono text-sm text-encre-2">{prospect.email}</p> : null}
          <PastilleAutorisation autorisation={autorisation} />
          {revocation ? (
            <p className="text-sm text-encre-3">
              Révoqué le <span className="font-mono">{dateLongue.format(revocation)}</span>.
            </p>
          ) : null}
          {partages > 1 ? <p className="text-sm text-encre-3">Numéro partagé par {partages} prospects.</p> : null}
        </div>
        <PanneauAppel
          entrepriseId={entreprise.id}
          prospectId={prospect.id}
          prospectNom={prospect.nom}
          versions={versions.map((v) => ({ id: v.id, libelle: v.libelle }))}
          autorise={Boolean(autorisation?.autorise)}
        />
        {autorisation?.autorise ? <BoutonRevoquer numero={prospect.telephone} partages={partages} /> : null}
      </aside>
      </div>
    </div>
  );
}
