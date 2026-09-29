import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Metadata } from 'next';
import { comptesCampagne, dateCourte, etatAppel, STATUTS_CAMPAGNE } from '@/components/format-appel';
import { Cellule, CelluleEnTete, EnTeteTable, LienLigne, LigneTable, Page, TableDense } from '@/components/ui';
import { NavigationListe } from '@/components/clavier';
import { db } from '@/db';
import { appels, campagnes, issuesPersonnalisees, prospects } from '@/db/schema';
import { autorisationsDe } from '@/lib/autorisations';
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
      .where(eq(prospects.entrepriseId, entreprise.id))
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
  const [autorisations, appelsCampagnes] = await Promise.all([
    autorisationsDe(listeProspects.map((p) => p.telephone)),
    ids.length > 0
      ? db
          .select({ campagneId: appels.campagneId, issue: appels.issue, issueSysteme: appels.issueSysteme })
          .from(appels)
          .where(inArray(appels.campagneId, ids))
      : Promise.resolve([]),
  ]);

  const libelleVersion = new Map(versions.map((v) => [v.id, v.libelle]));
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
      autorisation: autorisations.get(p.telephone),
      derniere: d ? { cle: d.issueSysteme, libelle: etatAppel(d, { libellePerso: d.issue ? libellePerso.get(d.issue) : null }).libelle } : null,
      rendezVous: rendezVousDe.has(p.id),
    };
  });

  const base = `/entreprises/${slug}`;
  const prerequis =
    versions.length === 0
      ? { texte: 'Aucun script : crée-en un dans Scripts.', lien: { href: `${base}/scripts`, libelle: 'Ouvrir les scripts' } }
      : listeProspects.length === 0
        ? { texte: 'Aucun prospect : importe des fiches dans Prospects.', lien: { href: `${base}/prospects?import=1`, libelle: 'Importer des fiches' } }
        : prospectsFormulaire.every((p) => !p.autorisation?.autorise)
          ? {
              texte: 'Aucun numéro autorisé : chaque prospect est révoqué ou sans consentement.',
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
        versions={versions.map((v) => ({ id: v.id, libelle: v.libelle }))}
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
                  <LigneTable key={c.id} etat={c.statut === 'en-cours' ? 'vivante' : 'normale'}>
                    <Cellule className="max-sm:order-1 max-sm:flex-1">
                      <LienLigne href={`/campagnes/${c.id}`} className="font-mono text-xs text-encre-2">
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
                      {STATUTS_CAMPAGNE[c.statut]}
                    </Cellule>
                    <Cellule mono align="droite" className="max-sm:order-3">
                      <span aria-hidden="true">
                        {comptes.traites}/{comptes.total}
                      </span>
                      <span className="sr-only">
                        {comptes.traites} traités sur {comptes.total}
                      </span>
                    </Cellule>
                    <Cellule align="droite" masqueeMobile className={`font-mono text-xs ${rendezVous > 0 ? 'text-encre' : 'text-encre-3'}`}>
                      {rendezVous}
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
