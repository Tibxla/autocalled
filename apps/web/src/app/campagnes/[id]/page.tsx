import { LIBELLES_ISSUES, prochaineAction } from '@autocalled/domain';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TitreSection } from '@/components/ui';
import { db } from '@/db';
import { appels, campagnes, entreprises, prospects } from '@/db/schema';
import { versionsDeLEntreprise } from '@/lib/versions';
import { Regie } from './regie';

export const metadata: Metadata = { title: 'Campagne' };

export default async function PageCampagne({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [campagne] = await db.select().from(campagnes).where(eq(campagnes.id, id));
  if (!campagne) notFound();
  const [[entreprise], listeProspects, listeAppels, versions] = await Promise.all([
    db.select().from(entreprises).where(eq(entreprises.id, campagne.entrepriseId)),
    db.select().from(prospects).where(eq(prospects.entrepriseId, campagne.entrepriseId)),
    db.select().from(appels).where(eq(appels.campagneId, campagne.id)),
    versionsDeLEntreprise(campagne.entrepriseId),
  ]);
  if (!entreprise) notFound();

  const nom = (prospectId: string) => listeProspects.find((p) => p.id === prospectId)?.nom ?? prospectId;
  const action = prochaineAction(campagne);
  const ouvert = campagne.entrees.find((e) => e.etat === 'en-appel');
  const faits = campagne.entrees.filter((e) => e.etat === 'appelee' || e.etat === 'sautee').length;

  return (
    <div className="grid gap-10 pt-10">
      <div className="grid gap-1">
        <Link href={`/entreprises/${entreprise.slug}/campagnes`} className="text-sm text-encre-3 hover:text-encre">
          {entreprise.nom} · Campagnes
        </Link>
        <h1 className="text-xl font-semibold tracking-[-0.02em]">
          {versions.find((v) => v.id === campagne.versionScriptId)?.libelle ?? 'Campagne'}
        </h1>
        <p className="text-sm text-encre-2">
          {campagne.ligne === 'simulation' ? 'Simulation : un modèle joue les prospects' : 'Ligne navigateur (test)'} ·{' '}
          <span className="font-mono">
            {faits}/{campagne.entrees.length}
          </span>{' '}
          traités
        </p>
      </div>

      <Regie
        campagneId={campagne.id}
        statut={campagne.statut}
        ligne={campagne.ligne === 'simulation' ? 'simulation' : 'navigateur'}
        entrepriseId={campagne.entrepriseId}
        versionScriptId={campagne.versionScriptId}
        prochain={action.type === 'appeler' ? { id: action.prospectId, nom: nom(action.prospectId) } : null}
        appelOuvert={campagne.ligne === 'navigateur' && ouvert?.etat === 'en-appel' ? ouvert.appelId : null}
      />

      <section>
        <TitreSection>File</TitreSection>
        <ol>
          {campagne.entrees.map((e, i) => {
            const appel = 'appelId' in e ? listeAppels.find((a) => a.id === e.appelId) : undefined;
            const etat =
              e.etat === 'a-appeler'
                ? 'À appeler'
                : e.etat === 'en-appel'
                  ? 'En appel'
                  : e.etat === 'sautee'
                    ? 'Sauté : numéro non autorisé'
                    : appel?.statut === 'termine' && appel.issueSysteme
                      ? LIBELLES_ISSUES[appel.issueSysteme]
                      : appel?.statut === 'echec'
                        ? 'Analyse en échec'
                        : 'Analyse…';
            return (
              <li key={e.prospectId} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-4 border-b border-filet py-3.5">
                <span className="font-mono text-sm text-encre-3">{i + 1}</span>
                <span className="font-medium">{nom(e.prospectId)}</span>
                {appel ? (
                  <Link href={`/appels/${appel.id}`} className={`text-sm hover:underline ${e.etat === 'en-appel' ? 'text-antenne' : 'text-encre-2'}`}>
                    {etat}
                  </Link>
                ) : (
                  <span className={`text-sm ${e.etat === 'en-appel' ? 'text-antenne' : 'text-encre-3'}`}>{etat}</span>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
