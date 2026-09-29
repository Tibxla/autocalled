import { SEUIL_ECHANTILLON } from '@autocalled/domain';
import { asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NavigationListe } from '@/components/clavier';
import {
  Cellule,
  CelluleEnTete,
  EnTeteTable,
  EtatVide,
  Filtre,
  Filtres,
  LienAction,
  LienLigne,
  LigneTable,
  Message,
  Page,
  TableDense,
  TitreSection,
} from '@/components/ui';
import { db } from '@/db';
import { scripts, versionsScript, type Etape } from '@/db/schema';
import { analyseEntreprise } from '@/lib/lecture';
import { entrepriseParSlug } from '@/lib/pages';

export const metadata: Metadata = { title: 'Analyse' };

const TEMPS: Record<string, string> = { creuser: 'creuser', reformuler: 'reformuler', argumenter: 'argumenter', controler: 'contrôler' };
const COLONNES_VERSIONS = '5rem 11rem minmax(0,1.1fr) minmax(0,1fr)';
const COLONNES_OBJECTIONS = 'minmax(0,1.4fr) 11rem minmax(0,1fr)';

/** Barre de 4 px d'une seule teinte : la longueur porte la valeur, le chiffre est écrit à côté. */
function Barre({ valeur }: { valeur: number }) {
  return (
    <span aria-hidden="true" className="inline-block h-1 w-16 shrink-0 rounded-[2px] bg-survol align-middle">
      <span className="block h-1 rounded-[2px] bg-encre" style={{ width: `${Math.max(valeur * 100, valeur > 0 ? 4 : 0)}%` }} />
    </span>
  );
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** « étape 2 · Qualification du besoin » ; une médiane entre deux étapes, ou avant la première, se dit telle quelle. */
function arretMedian(mediane: number | null, etapes: Etape[] | undefined): string {
  if (mediane === null) return '';
  if (mediane === 0) return 'avant la première étape';
  if (!Number.isInteger(mediane)) return `entre les étapes ${Math.floor(mediane)} et ${Math.ceil(mediane)}`;
  const intention = etapes?.[mediane - 1]?.intention;
  return intention ? `étape ${mediane} · ${intention}` : `étape ${mediane}`;
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
  const base = `/entreprises/${slug}`;
  const [{ simules, parVersion, parObjection, libelleObjection }, versions] = await Promise.all([
    analyseEntreprise(entreprise.id, avecSimules),
    db
      .select({ id: versionsScript.id, numero: versionsScript.numero, etapes: versionsScript.etapes, scriptId: scripts.id, script: scripts.nom })
      .from(versionsScript)
      .innerJoin(scripts, eq(scripts.id, versionsScript.scriptId))
      .where(eq(scripts.entrepriseId, entreprise.id))
      .orderBy(asc(scripts.creeLe)),
  ]);

  const total = parVersion.reduce((s, v) => s + v.appels, 0);
  const reels = avecSimules ? total - simules : total;
  const avecLesSimules = avecSimules ? total : total + simules;
  const versionDe = new Map(versions.map((v) => [v.id, v]));

  // Versions groupées par script, dans l'ordre des scripts ; une version supprimée forme son propre groupe.
  const groupes = [
    ...Map.groupBy(parVersion, (v) => {
      const info = versionDe.get(v.versionScriptId);
      return info ? info.scriptId : 'supprimee';
    }),
  ].map(([scriptId, lignes]) => ({
    scriptId,
    nom: versionDe.get(lignes[0]!.versionScriptId)?.script ?? 'Version supprimée',
    lignes: lignes.sort((a, b) => (versionDe.get(b.versionScriptId)?.numero ?? 0) - (versionDe.get(a.versionScriptId)?.numero ?? 0)),
  }));

  return (
    <Page largeur="lecture">
      <div className="grid max-w-[64rem] grid-cols-[minmax(0,1fr)] gap-10">
        <div className="grid gap-4">
          <p className="max-w-[68ch] text-sm text-encre-3">
            Chaque ligne compare une version de script. Les appels non aboutis sont comptés mais exclus des taux&nbsp;; sous{' '}
            {SEUIL_ECHANTILLON} conversations, aucun taux n’est affiché.
          </p>
          <Filtres libelle="Appels comptés">
            <Filtre actif={!avecSimules} compte={reels} href={`${base}/analyse`} replace>
              Appels réels
            </Filtre>
            <Filtre actif={avecSimules} compte={avecLesSimules} href={`${base}/analyse?simules=1`} replace>
              Avec les simulés
            </Filtre>
          </Filtres>
          {avecSimules && simules > 0 ? (
            <Message ton="neutre">Ces chiffres comptent des appels simulés : un modèle jouait le prospect.</Message>
          ) : null}
        </div>

        <section aria-labelledby="titre-versions" className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <TitreSection id="titre-versions">Versions de script</TitreSection>
          {parVersion.length === 0 ? (
            <EtatVide titre="Rien à comparer pour l’instant.">
              {simules > 0 && !avecSimules
                ? 'Seuls des appels simulés sont terminés : « Avec les simulés » montre leurs chiffres, en sachant ce qu’ils valent.'
                : 'Les chiffres apparaissent après les premiers appels analysés.'}
            </EtatVide>
          ) : (
            <NavigationListe>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
                {groupes.map((g) => (
                  <div key={g.scriptId} className="grid grid-cols-[minmax(0,1fr)] gap-1">
                    <h3 className="text-md font-semibold">
                      {g.scriptId === 'supprimee' ? (
                        g.nom
                      ) : (
                        <Link href={`${base}/scripts/${g.scriptId}`} className="decoration-souligne underline-offset-4 hover:underline">
                          {g.nom}
                        </Link>
                      )}
                    </h3>
                    <TableDense libelle={`Versions de ${g.nom}`} colonnes={COLONNES_VERSIONS}>
                      <EnTeteTable>
                        <CelluleEnTete>Version</CelluleEnTete>
                        <CelluleEnTete>Conversations</CelluleEnTete>
                        <CelluleEnTete>Rendez-vous</CelluleEnTete>
                        <CelluleEnTete>Arrêt médian sans rendez-vous</CelluleEnTete>
                      </EnTeteTable>
                      <div role="rowgroup">
                        {g.lignes.map((v) => {
                          const info = versionDe.get(v.versionScriptId);
                          const arret = arretMedian(v.etapeMedianeSansRendezVous, info?.etapes);
                          return (
                            <LigneTable key={v.versionScriptId}>
                              <Cellule className="font-mono text-md">
                                {info ? (
                                  <LienLigne href={`${base}/scripts/${info.scriptId}?version=${info.numero}`}>v{info.numero}</LienLigne>
                                ) : (
                                  <span className="text-encre-3">supprimée</span>
                                )}
                              </Cellule>
                              <Cellule>
                                <span className="font-mono">{v.conversations}</span>
                                <span className="text-encre-3"> sur </span>
                                <span className="font-mono">{v.appels}</span>
                                <span className="text-encre-3"> {v.appels > 1 ? 'appels' : 'appel'}</span>
                              </Cellule>
                              <Cellule tronquee className="max-sm:basis-full">
                                {!v.echantillonSuffisant || v.tauxRendezVous === null ? (
                                  <span className="text-encre-3">
                                    {pluriel(v.rendezVous, 'rendez-vous', 'rendez-vous')} sur {pluriel(v.conversations, 'conversation', 'conversations')} ·
                                    échantillon insuffisant
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-2.5">
                                    <span className="font-mono">
                                      {Math.round(v.tauxRendezVous * 100)}{'\u202f'}% <span className="text-encre-3">({v.rendezVous} sur {v.conversations})</span>
                                    </span>
                                    <Barre valeur={v.tauxRendezVous} />
                                  </span>
                                )}
                              </Cellule>
                              <Cellule tronquee titre={arret} className="text-encre-2 max-sm:basis-full">
                                {arret ? (
                                  <>
                                    <span className="sm:hidden text-encre-3">Arrêt médian : </span>
                                    {arret}
                                  </>
                                ) : null}
                              </Cellule>
                            </LigneTable>
                          );
                        })}
                      </div>
                    </TableDense>
                  </div>
                ))}
              </div>
            </NavigationListe>
          )}
        </section>

        <section aria-labelledby="titre-objections-analyse" className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <TitreSection id="titre-objections-analyse">Objections</TitreSection>
          {parObjection.length === 0 ? (
            <EtatVide titre="Aucune objection relevée.">Les objections apparaissent ici avec la part de celles que Mina a levées.</EtatVide>
          ) : (
            <TableDense libelle="Objections" colonnes={COLONNES_OBJECTIONS}>
              <EnTeteTable>
                <CelluleEnTete>Objection</CelluleEnTete>
                <CelluleEnTete>Levées</CelluleEnTete>
                <CelluleEnTete>Où elle coince</CelluleEnTete>
              </EnTeteTable>
              <div role="rowgroup">
                {parObjection.map((o) => {
                  const libelle = o.objectionId ? libelleObjection(o.objectionId) : 'Objections nouvelles, absentes de la fiche';
                  const supprimee = o.objectionId !== null && libelle === 'Objection supprimée';
                  return (
                    <LigneTable key={o.objectionId ?? 'nouvelles'} className={o.objectionId ? '' : 'sm:h-auto sm:py-2'}>
                      <Cellule tronquee={Boolean(o.objectionId)} titre={libelle} className="max-sm:basis-full">
                        {o.objectionId && !supprimee ? (
                          <LienLigne href={`${base}/objections?objection=${o.objectionId}`}>{libelle}</LienLigne>
                        ) : o.objectionId ? (
                          <span className="text-encre-3">{libelle}</span>
                        ) : (
                          <span className="grid gap-0.5">
                            <span>{libelle}</span>
                            <span className="text-sm text-encre-3">
                              Leur libellé n’est pas regroupé :{' '}
                              <Link
                                href={`/appels?entreprise=${encodeURIComponent(slug)}`}
                                className="relative z-10 text-encre-2 underline decoration-souligne underline-offset-4 hover:text-encre"
                              >
                                lis-les dans les appels
                              </Link>
                              .
                            </span>
                          </span>
                        )}
                      </Cellule>
                      <Cellule>
                        <span className="inline-flex items-center gap-2.5">
                          <span className="font-mono">
                            {o.levees} <span className="text-encre-3">sur</span> {o.apparitions}
                          </span>
                          {o.apparitions >= SEUIL_ECHANTILLON ? <Barre valeur={o.levees / o.apparitions} /> : null}
                        </span>
                      </Cellule>
                      <Cellule className="text-encre-2">
                        {o.tempsBloquantPrincipal ? `coince le plus souvent à ${TEMPS[o.tempsBloquantPrincipal] ?? o.tempsBloquantPrincipal}` : null}
                      </Cellule>
                    </LigneTable>
                  );
                })}
              </div>
            </TableDense>
          )}
        </section>

        <div className="-mx-1.5">
          <LienAction href={`/appels?entreprise=${encodeURIComponent(slug)}`}>Voir les appels de l’entreprise</LienAction>
        </div>
      </div>
    </Page>
  );
}
