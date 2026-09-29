import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BoutonArchive } from '@/components/bouton-archive';
import { NavigationListe } from '@/components/clavier';
import { FUSEAU } from '@/components/format-appel';
import { Cellule, CelluleEnTete, EnTeteTable, EtatVide, LienLigne, LigneTable, Page, TableDense, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { campagnes, scripts, versionsScript } from '@/db/schema';
import { analyseEntreprise } from '@/lib/lecture';
import { assistantePourLaPage, entrepriseParSlug } from '@/lib/pages';
import { basculerArchiveScript } from '../actions';
import { CreationScript } from './formulaire-script';

export const metadata: Metadata = { title: 'Scripts' };

const COLONNES = 'minmax(0,1fr) 4rem 4rem 7rem 7rem 13rem';
const JOUR_MOIS = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: FUSEAU });

export default async function PageScripts({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const { nom } = await assistantePourLaPage();
  const [liste, versions, actives, analyse] = await Promise.all([
    db.select({ id: scripts.id, nom: scripts.nom, archive: scripts.archive }).from(scripts).where(eq(scripts.entrepriseId, entreprise.id)).orderBy(asc(scripts.creeLe)),
    db
      .select({
        id: versionsScript.id,
        scriptId: versionsScript.scriptId,
        numero: versionsScript.numero,
        creeLe: versionsScript.creeLe,
        etapes: sql<number>`jsonb_array_length(${versionsScript.etapes})`,
      })
      .from(versionsScript)
      .innerJoin(scripts, eq(scripts.id, versionsScript.scriptId))
      .where(eq(scripts.entrepriseId, entreprise.id)),
    db
      .select({ versionScriptId: campagnes.versionScriptId, statut: campagnes.statut })
      .from(campagnes)
      .where(and(eq(campagnes.entrepriseId, entreprise.id), inArray(campagnes.statut, ['en-cours', 'en-pause']))),
    analyseEntreprise(entreprise.id, false),
  ]);

  const archives = liste.filter((s) => s.archive);
  const lignes = liste.filter((s) => !s.archive).map((s) => {
    const siennes = versions.filter((v) => v.scriptId === s.id);
    const derniere = siennes.reduce<(typeof siennes)[number] | undefined>((max, v) => (!max || v.numero > max.numero ? v : max), undefined);
    const ids = new Set(siennes.map((v) => v.id));
    const servies = actives.filter((c) => ids.has(c.versionScriptId));
    return {
      ...s,
      derniere,
      conversations: derniere ? (analyse.parVersion.find((v) => v.versionScriptId === derniere.id)?.conversations ?? 0) : 0,
      campagne: servies.some((c) => c.statut === 'en-cours') ? 'en-cours' : servies.length ? 'en-pause' : null,
    };
  });

  return (
    <Page largeur="lecture">
      <div className="grid max-w-[60rem] grid-cols-[minmax(0,1fr)] gap-6">
        <p className="max-w-[62ch] text-sm text-encre-3">
          Un script est un plan que {nom} suit sans le réciter. Chaque modification crée une nouvelle version, pour que les bilans
          comparent des choses comparables.
        </p>
        <section aria-labelledby="titre-scripts">
          <CreationScript entrepriseId={entreprise.id} slug={slug} compte={lignes.length} />
          {lignes.length === 0 ? (
            archives.length > 0 ? (
              <EtatVide titre="Tous les scripts sont archivés.">
                Aucun script n’est proposé pour lancer un appel ou une campagne : réactives-en un plus bas, ou crées-en un nouveau.
              </EtatVide>
            ) : (
              <EtatVide titre="Aucun script.">
                Crée un premier script : il démarre avec quatre étapes (accroche, qualification, pitch, rendez-vous) que tu adaptes.
              </EtatVide>
            )
          ) : (
            <NavigationListe memoriser="scripts">
              <TableDense libelle="Scripts" colonnes={COLONNES} className="mt-2">
                <EnTeteTable>
                  <CelluleEnTete>Script</CelluleEnTete>
                  <CelluleEnTete>Version</CelluleEnTete>
                  <CelluleEnTete align="droite">Étapes</CelluleEnTete>
                  <CelluleEnTete align="droite">Dernière version</CelluleEnTete>
                  <CelluleEnTete align="droite">Conversations</CelluleEnTete>
                  <CelluleEnTete>Campagne</CelluleEnTete>
                </EnTeteTable>
                <div role="rowgroup">
                  {lignes.map((s) => (
                    <LigneTable key={s.id} etat={s.campagne === 'en-cours' ? 'vivante' : 'normale'}>
                      <Cellule tronquee titre={s.nom} className="font-medium max-sm:order-1 max-sm:flex-1">
                        <LienLigne href={`/entreprises/${slug}/scripts/${s.id}`}>{s.nom}</LienLigne>
                      </Cellule>
                      <Cellule mono className="max-sm:order-1">
                        {s.derniere ? `v${s.derniere.numero}` : ''}
                      </Cellule>
                      <Cellule align="droite" mono className="max-sm:order-3">
                        {s.derniere?.etapes ?? 0}
                        <span className="sm:hidden"> étapes</span>
                      </Cellule>
                      <Cellule align="droite" mono className="max-sm:order-3">
                        {s.derniere ? <time dateTime={s.derniere.creeLe.toISOString()}>{JOUR_MOIS.format(s.derniere.creeLe)}</time> : null}
                      </Cellule>
                      <Cellule align="droite" mono className="max-sm:order-3">
                        {s.conversations}
                        <span className="sm:hidden"> conv.</span>
                      </Cellule>
                      <Cellule etat tronquee className={`max-sm:order-3 ${s.campagne === 'en-pause' ? 'text-encre-2' : ''}`}>
                        {s.campagne === 'en-cours' ? 'sert la campagne en cours' : s.campagne === 'en-pause' ? 'sert une campagne suspendue' : null}
                      </Cellule>
                      <span aria-hidden="true" className="h-0 basis-full max-sm:order-2 sm:hidden" />
                    </LigneTable>
                  ))}
                </div>
              </TableDense>
            </NavigationListe>
          )}
        </section>

        {archives.length > 0 ? (
          <section aria-labelledby="titre-scripts-archives">
            <TitreSection id="titre-scripts-archives" compte={archives.length}>
              Archivés
            </TitreSection>
            <ul>
              {archives.map((s) => (
                <li key={s.id} className="flex min-h-[38px] flex-wrap items-center gap-x-4 border-b border-filet py-1 text-encre-3">
                  <Link
                    href={`/entreprises/${slug}/scripts/${s.id}`}
                    className="min-w-0 flex-1 decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline"
                  >
                    {s.nom}
                  </Link>
                  <span className="text-sm">Archivé</span>
                  <BoutonArchive archivee masculin nom={s.nom} action={basculerArchiveScript.bind(null, entreprise.id, s.id, false)} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Page>
  );
}
