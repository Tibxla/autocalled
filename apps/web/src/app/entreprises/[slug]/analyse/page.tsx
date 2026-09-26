import { type IssueSysteme, SEUIL_ECHANTILLON, statistiquesObjections, statistiquesParVersion } from '@autocalled/domain';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EtatVide, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { appels, objections } from '@/db/schema';
import { entrepriseParSlug } from '@/lib/donnees';
import { versionsDeLEntreprise } from '@/lib/versions';

export const metadata: Metadata = { title: 'Analyse' };

const pourcent = (x: number) => `${Math.round(x * 100)} %`;
const TEMPS: Record<string, string> = { creuser: 'creuser', reformuler: 'reformuler', argumenter: 'argumenter', controler: 'contrôler' };

/** Barre horizontale d'une seule teinte : la longueur porte la valeur, le chiffre est écrit à côté. */
function Barre({ valeur, libelle }: { valeur: number; libelle: string }) {
  return (
    <div className="flex items-center gap-3" title={libelle}>
      <div className="h-2 w-40 rounded-full bg-survol" aria-hidden="true">
        <div className="h-2 rounded-full bg-encre" style={{ width: `${Math.max(valeur * 100, valeur > 0 ? 3 : 0)}%` }} />
      </div>
      <span className="font-mono text-sm">{libelle}</span>
    </div>
  );
}

export default async function PageAnalyse({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ simules?: string }>;
}) {
  const { slug } = await params;
  const avecSimules = (await searchParams).simules === '1';
  const entreprise = await entrepriseParSlug(slug);
  const [lignes, versions, listeObjections] = await Promise.all([
    db
      .select({ ligne: appels.ligne, versionScriptId: appels.versionScriptId, issueSysteme: appels.issueSysteme, bilan: appels.bilan })
      .from(appels)
      .where(and(eq(appels.entrepriseId, entreprise.id), eq(appels.statut, 'termine'), isNotNull(appels.issueSysteme))),
    versionsDeLEntreprise(entreprise.id),
    db.select().from(objections).where(eq(objections.entrepriseId, entreprise.id)),
  ]);

  const simules = lignes.filter((l) => l.ligne === 'simulation').length;
  const retenus = lignes
    .filter((l) => avecSimules || l.ligne !== 'simulation')
    .map((l) => ({
      versionScriptId: l.versionScriptId,
      issueSysteme: l.issueSysteme as IssueSysteme,
      etapeAtteinte: l.bilan?.etapeAtteinte ?? 0,
      objections: l.bilan?.objections ?? [],
    }));
  const parVersion = statistiquesParVersion(retenus).sort(
    (a, b) => versions.findIndex((v) => v.id === a.versionScriptId) - versions.findIndex((v) => v.id === b.versionScriptId),
  );
  const parObjection = statistiquesObjections(retenus);
  const libelleVersion = (id: string) => versions.find((v) => v.id === id)?.libelle ?? 'Version supprimée';
  const libelleObjection = (id: string | null) =>
    id === null ? 'Objections nouvelles (absentes de la fiche)' : (listeObjections.find((o) => o.id === id)?.libelle ?? 'Objection supprimée');

  return (
    <div className="grid gap-12">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <p className="max-w-[62ch] text-encre-2">
          Chaque ligne compare une version de script. Les appels non aboutis sont comptés mais exclus des taux ; sous{' '}
          {SEUIL_ECHANTILLON} conversations, aucune version n’est déclarée meilleure.
        </p>
        {simules > 0 ? (
          <Link
            href={avecSimules ? `/entreprises/${slug}/analyse` : `/entreprises/${slug}/analyse?simules=1`}
            className="text-sm text-encre-2 underline decoration-filet-fort underline-offset-4 hover:text-encre"
          >
            {avecSimules ? `Exclure les ${simules} appels simulés` : `Inclure les ${simules} appels simulés`}
          </Link>
        ) : null}
      </div>
      {avecSimules ? (
        <p className="text-sm text-encre-3">Les chiffres ci-dessous comptent des appels simulés : un modèle jouait le prospect.</p>
      ) : null}

      <section>
        <TitreSection>Versions de script</TitreSection>
        {parVersion.length === 0 ? (
          <EtatVide titre="Rien à comparer pour l’instant">
            {simules > 0
              ? 'Seuls des appels simulés existent : inclus-les pour voir leurs chiffres, en sachant ce qu’ils valent.'
              : 'Les chiffres apparaîtront après les premiers appels analysés.'}
          </EtatVide>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-filet text-sm text-encre-3">
                <th className="py-3 pr-4 font-normal">Version</th>
                <th className="py-3 pr-4 font-normal">Conversations</th>
                <th className="py-3 pr-4 font-normal">Rendez-vous</th>
                <th className="hidden py-3 font-normal md:table-cell">Arrêt médian sans rendez-vous</th>
              </tr>
            </thead>
            <tbody>
              {parVersion.map((v) => (
                <tr key={v.versionScriptId} className="border-b border-filet align-baseline">
                  <td className="py-4 pr-4 font-mono text-sm">{libelleVersion(v.versionScriptId)}</td>
                  <td className="py-4 pr-4">
                    <span className="font-mono">{v.conversations}</span>
                    <span className="text-sm text-encre-3"> sur {v.appels}</span>
                    {!v.echantillonSuffisant ? <span className="block text-sm text-encre-3">échantillon insuffisant</span> : null}
                  </td>
                  <td className="py-4 pr-4">
                    {v.tauxRendezVous === null ? (
                      <span className="text-encre-3">—</span>
                    ) : (
                      <Barre valeur={v.tauxRendezVous} libelle={`${pourcent(v.tauxRendezVous)} (${v.rendezVous})`} />
                    )}
                  </td>
                  <td className="hidden py-4 md:table-cell">
                    {v.etapeMedianeSansRendezVous === null ? (
                      <span className="text-encre-3">—</span>
                    ) : (
                      <span className="text-sm">
                        étape <span className="font-mono">{v.etapeMedianeSansRendezVous}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <TitreSection>Objections</TitreSection>
        {parObjection.length === 0 ? (
          <EtatVide titre="Aucune objection relevée">Les objections apparaîtront ici avec la part de celles que Mina a levées.</EtatVide>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-filet text-sm text-encre-3">
                <th className="py-3 pr-4 font-normal">Objection</th>
                <th className="py-3 pr-4 font-normal">Levées</th>
                <th className="hidden py-3 font-normal md:table-cell">Coince le plus souvent à</th>
              </tr>
            </thead>
            <tbody>
              {parObjection.map((o) => (
                <tr key={o.objectionId ?? 'nouvelles'} className="border-b border-filet align-baseline">
                  <td className="py-4 pr-4">{libelleObjection(o.objectionId)}</td>
                  <td className="py-4 pr-4">
                    <Barre valeur={o.levees / o.apparitions} libelle={`${o.levees} sur ${o.apparitions}`} />
                  </td>
                  <td className="hidden py-4 text-sm md:table-cell">
                    {o.tempsBloquantPrincipal ? TEMPS[o.tempsBloquantPrincipal] ?? o.tempsBloquantPrincipal : <span className="text-encre-3">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
