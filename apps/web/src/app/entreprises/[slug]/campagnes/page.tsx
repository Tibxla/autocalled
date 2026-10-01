import { finDemandee } from '@autocalled/domain';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import { comptesCampagne, dateCourte, etatAppel, STATUTS_CAMPAGNE } from '@/components/format-appel';
import { refusDe } from '@/components/refus-numero';
import { Cellule, CelluleEnTete, EnTeteTable, LienLigne, LigneTable, Page, TableDense } from '@/components/ui';
import { NavigationListe } from '@/components/clavier';
import { db } from '@/db';
import { appels, campagnes, issuesPersonnalisees, prospects } from '@/db/schema';
import { appelabiliteDe } from '@/lib/appelables';
import { entrepriseParSlug } from '@/lib/pages';
import { versionsDeLEntreprise } from '@/lib/versions';
import { SectionCampagnes, type ProspectCampagne } from './formulaire-campagne';

export const metadata: Metadata = { title: 'Campagnes' };

const LIGNES: Record<string, { libelle: string; classe: string }> = {
  bluetooth: { libelle: 'Téléphone passerelle · vrais numéros', classe: 'text-encre-2' },
  navigateur: { libelle: 'Ligne navigateur', classe: 'text-encre-3' },
  simulation: { libelle: 'Appel simulé', classe: 'text-encre-3' },
  twilio: { libelle: 'Téléphone (Twilio)', classe: 'text-encre-2' },
};

const TON_STATUT = { prete: 'text-encre', 'en-cours': '', 'en-pause': 'text-encre-2', terminee: 'text-encre-3' } as const;

export default async function PageCampagnes({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const [liste, versions, listeProspects, derniers, avecRendezVous, issuesPerso] = await Promise.all([
    db.select().from(campagnes).where(eq(campagnes.entrepriseId, entreprise.id)).orderBy(desc(campagnes.creeLe)),
    versionsDeLEntreprise(entreprise.id),
    db
      .select({ id: prospects.id, nom: prospects.nom, societe: prospects.societe, telephone: prospects.telephone })
      .from(prospects)
      // Un prospect archivé n'est jamais proposé pour une campagne.
      .where(and(eq(prospects.entrepriseId, entreprise.id), isNull(prospects.archiveLe)))
      .orderBy(asc(prospects.nom), asc(prospects.id)),
    // Le dernier appel de chaque prospect, pour les filtres et les cases cochées d'office.
    db
      .selectDistinctOn([appels.prospectId], {
        prospectId: appels.prospectId,
        debutLe: appels.debutLe,
        statut: appels.statut,
        ligne: appels.ligne,
        issue: appels.issue,
        issueSysteme: appels.issueSysteme,
        erreur: appels.erreur,
        conversationId: appels.conversationId,
      })
      .from(appels)
      .where(eq(appels.entrepriseId, entreprise.id))
      .orderBy(appels.prospectId, desc(appels.debutLe)),
    db
      .selectDistinct({ prospectId: appels.prospectId })
      .from(appels)
      .where(and(eq(appels.entrepriseId, entreprise.id), eq(appels.issueSysteme, 'rendez-vous-pris'))),
    db
      .select({ id: issuesPersonnalisees.id, libelle: issuesPersonnalisees.libelle })
      .from(issuesPersonnalisees)
      .where(eq(issuesPersonnalisees.entrepriseId, entreprise.id)),
  ]);
  const ids = liste.map((c) => c.id);
  const [verifies, appelsCampagnes] = await Promise.all([
    appelabiliteDe(listeProspects.map((p) => p.telephone)),
    ids.length > 0
      ? db
          .select({ campagneId: appels.campagneId, issue: appels.issue, issueSysteme: appels.issueSysteme })
          .from(appels)
          .where(inArray(appels.campagneId, ids))
      : Promise.resolve([]),
  ]);

  const libelleVersion = new Map(versions.map((v) => [v.id, v.libelle]));
  // Les campagnes passées gardent le libellé de leur version ; une nouvelle ne se lance pas sur un script archivé.
  const lancables = versions.filter((v) => !v.scriptArchive);
  const libellePerso = new Map(issuesPerso.map((i) => [`perso:${i.id}`, i.libelle]));
  const dernierDe = new Map(derniers.map((d) => [d.prospectId, d]));
  const rendezVousDe = new Set(avecRendezVous.map((r) => r.prospectId));
  const rendezVousParCampagne = new Map<string, number>();
  for (const a of appelsCampagnes) {
    if (a.campagneId && a.issueSysteme === 'rendez-vous-pris') rendezVousParCampagne.set(a.campagneId, (rendezVousParCampagne.get(a.campagneId) ?? 0) + 1);
  }

  const prospectsFormulaire: ProspectCampagne[] = listeProspects.map((p) => {
    const d = dernierDe.get(p.id);
    return {
      id: p.id,
      nom: p.nom,
      societe: p.societe,
      refus: refusDe(verifies.get(p.telephone)),
      derniere: d ? { cle: d.issueSysteme, libelle: etatAppel(d, { libellePerso: d.issue ? libellePerso.get(d.issue) : null }).libelle } : null,
      rendezVous: rendezVousDe.has(p.id),
    };
  });

  const base = `/entreprises/${slug}`;
  const prerequis =
    lancables.length === 0
      ? {
          texte: versions.length > 0 ? 'Tous les scripts sont archivés : réactives-en un ou crées-en un dans Scripts.' : 'Aucun script : crées-en un dans Scripts.',
          lien: { href: `${base}/scripts`, libelle: 'Ouvrir les scripts' },
        }
      : listeProspects.length === 0
        ? { texte: 'Aucun prospect : importe des fiches dans Prospects.', lien: { href: `${base}/prospects?import=1`, libelle: 'Importer des fiches' } }
        : prospectsFormulaire.every((p) => p.refus !== null)
          ? {
              texte: 'Aucun prospect à appeler : chaque numéro est invalide ou celui d’une personne effacée.',
              lien: { href: `${base}/prospects`, libelle: 'Voir les prospects' },
            }
          : null;

  // La campagne en cours d'abord, puis de la plus récente à la plus ancienne.
  const triees = [...liste].sort((a, b) => Number(b.statut === 'en-cours') - Number(a.statut === 'en-cours'));

  return (
    <Page largeur="pleine">
      <SectionCampagnes
        compte={liste.length}
        prerequis={prerequis}
        entrepriseId={entreprise.id}
        versions={lancables.map((v) => ({ id: v.id, libelle: v.libelle }))}
        prospects={prospectsFormulaire}
        vide={liste.length === 0}
      >
        <NavigationListe memoriser="campagnes">
          <TableDense libelle="Campagnes" colonnes="7.5rem minmax(0,1fr) minmax(0,1.1fr) 6.5rem 5.5rem 6.5rem" className="pt-2">
            <EnTeteTable>
              <CelluleEnTete>Créée</CelluleEnTete>
              <CelluleEnTete>Version</CelluleEnTete>
              <CelluleEnTete masqueeMobile>Ligne</CelluleEnTete>
              <CelluleEnTete>Statut</CelluleEnTete>
              <CelluleEnTete align="droite">Traités</CelluleEnTete>
              <CelluleEnTete align="droite" masqueeMobile>
                Rendez-vous
              </CelluleEnTete>
            </EnTeteTable>
            <div role="rowgroup">
              {triees.map((c) => {
                const comptes = comptesCampagne(c.entrees);
                const ligne = LIGNES[c.ligne] ?? { libelle: c.ligne, classe: 'text-encre-3' };
                const version = libelleVersion.get(c.versionScriptId) ?? 'Version supprimée';
                const rendezVous = rendezVousParCampagne.get(c.id) ?? 0;
                return (
                  // Sous 640 px, date, statut, compte et rendez-vous tiennent sur la première rangée jusqu'à 360 px.
                  <LigneTable key={c.id} etat={c.statut === 'en-cours' && comptes.enAppel > 0 ? 'vivante' : 'normale'} className="max-sm:gap-x-2.5">
                    <Cellule className="max-sm:order-1 max-sm:flex-1">
                      <LienLigne href={`/campagnes/${c.id}`} className="font-mono text-xs whitespace-nowrap text-encre-2">
                        {dateCourte(c.creeLe)}
                      </LienLigne>
                    </Cellule>
                    <Cellule tronquee titre={`${version} · ${ligne.libelle}`} className="max-sm:order-4 max-sm:basis-full max-sm:text-sm">
                      <span className="text-encre-2">{version}</span>
                      <span className="text-encre-3 sm:hidden"> · {ligne.libelle}</span>
                    </Cellule>
                    <Cellule tronquee titre={ligne.libelle} masqueeMobile className={ligne.classe}>
                      {ligne.libelle}
                    </Cellule>
                    <Cellule etat className={`max-sm:order-2 ${TON_STATUT[c.statut]}`}>
                      {finDemandee(c) ? 'Se termine' : STATUTS_CAMPAGNE[c.statut]}
                    </Cellule>
                    <Cellule mono align="droite" className="max-sm:order-3">
                      <span aria-hidden="true">
                        {comptes.traites}/{comptes.total}
                      </span>
                      <span className="sr-only">
                        {comptes.traites} traités sur {comptes.total}
                      </span>
                    </Cellule>
                    {/* Sous 640 px, à côté du statut et du compte, avec son unité ; rien quand aucun rendez-vous n'est pris. */}
                    <Cellule
                      align="droite"
                      unite="rendez-vous"
                      className={`text-sm text-encre-3 max-sm:order-3 ${rendezVous > 0 ? '' : 'max-sm:hidden'}`}
                    >
                      <span className={`font-mono text-xs ${rendezVous > 0 ? 'text-encre' : ''}`}>{rendezVous}</span>
                    </Cellule>
                  </LigneTable>
                );
              })}
            </div>
          </TableDense>
        </NavigationListe>
      </SectionCampagnes>
    </Page>
  );
}
