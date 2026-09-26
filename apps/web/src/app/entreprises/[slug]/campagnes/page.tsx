import { asc, desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EtatVide, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { campagnes, prospects } from '@/db/schema';
import { autorisationsDe } from '@/lib/autorisations';
import { entrepriseParSlug } from '@/lib/donnees';
import { versionsDeLEntreprise } from '@/lib/versions';
import { FormulaireCampagne } from './formulaire-campagne';

export const metadata: Metadata = { title: 'Campagnes' };

const date = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const STATUTS = { prete: 'Prête', 'en-cours': 'En cours', 'en-pause': 'En pause', terminee: 'Terminée' } as const;

export default async function PageCampagnes({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const [liste, versions, listeProspects] = await Promise.all([
    db.select().from(campagnes).where(eq(campagnes.entrepriseId, entreprise.id)).orderBy(desc(campagnes.creeLe)),
    versionsDeLEntreprise(entreprise.id),
    db.select().from(prospects).where(eq(prospects.entrepriseId, entreprise.id)).orderBy(asc(prospects.nom)),
  ]);
  const autorisations = await autorisationsDe(listeProspects.map((p) => p.telephone));
  const libelleVersion = new Map(versions.map((v) => [v.id, v.libelle]));

  return (
    <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="grid content-start">
        <TitreSection>Campagnes</TitreSection>
        {liste.length === 0 ? (
          <EtatVide titre="Aucune campagne">
            Une campagne appelle une liste de prospects l’un après l’autre, avec une même version de script.
          </EtatVide>
        ) : (
          <ul>
            {liste.map((c) => {
              const faits = c.entrees.filter((e) => e.etat === 'appelee' || e.etat === 'sautee').length;
              return (
                <li key={c.id} className="border-b border-filet">
                  <Link href={`/campagnes/${c.id}`} className="group grid gap-1 py-4 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto] sm:items-baseline sm:gap-6">
                    <span className="font-mono text-sm text-encre-3">{date.format(c.creeLe)}</span>
                    <span className="font-medium group-hover:underline group-hover:decoration-filet-fort group-hover:underline-offset-4">
                      {libelleVersion.get(c.versionScriptId) ?? 'Version supprimée'}
                      <span className="font-normal text-encre-3"> · {c.ligne === 'simulation' ? 'simulation' : 'navigateur'}</span>
                    </span>
                    <span className="text-sm text-encre-3">
                      {STATUTS[c.statut]} · <span className="font-mono">{faits}/{c.entrees.length}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="grid content-start gap-5">
        <TitreSection>Nouvelle campagne</TitreSection>
        {versions.length === 0 || listeProspects.length === 0 ? (
          <p className="text-sm text-encre-3">Il faut au moins un script et un prospect.</p>
        ) : (
          <FormulaireCampagne
            entrepriseId={entreprise.id}
            versions={versions.map((v) => ({ id: v.id, libelle: v.libelle }))}
            prospects={listeProspects.map((p) => ({
              id: p.id,
              nom: p.nom,
              detail: [p.role, p.societe].filter(Boolean).join(', '),
              autorise: Boolean(autorisations.get(p.telephone)?.autorise),
            }))}
          />
        )}
      </section>
    </div>
  );
}
