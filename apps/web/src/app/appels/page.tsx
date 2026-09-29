import type { TourDeParole } from '@autocalled/domain';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import {
  FILTRES_ISSUE,
  ListeAppels,
  cleFiltreIssue,
  estFiltreIssue,
  type CleFiltreIssue,
  type ExtraitAppel,
  type LigneAppel,
} from '@/components/liste-appels';
import { prenom } from '@/components/format-appel';
import { EnTetePage, EtatVide, Filtre, Filtres, LienAction, Page, Recherche } from '@/components/ui';
import { lienAvec } from '@/components/url';
import { db } from '@/db';
import { appels, entreprises, issuesPersonnalisees, prospects, rendezVous, versionsScript } from '@/db/schema';
import { listerAppels } from '@/lib/lecture';
import { commanderPont } from '@/lib/pont';
import { FiltreEntreprise } from './filtre-entreprise';

export const metadata: Metadata = { title: 'Appels' };

const PAS = 200;
const PLAFOND = 1000;
/** Au-delà, la liste s'affiche sans savoir quel appel la ligne porte : un pont qui pend ne la bloque pas. */
const ATTENTE_PONT_MS = 1500;

const LIGNES = [
  { valeur: 'bluetooth', libelle: 'Téléphone' },
  { valeur: 'navigateur', libelle: 'Navigateur' },
  { valeur: 'simulation', libelle: 'Simulés' },
  { valeur: 'twilio', libelle: 'Twilio' },
] as const;

type Parametres = { q?: string; entreprise?: string; issue?: string; ligne?: string; n?: string };

function taille(n: string | undefined): number {
  const lu = Number.parseInt(n ?? '', 10);
  if (!Number.isFinite(lu) || lu <= PAS) return PAS;
  return Math.min(PLAFOND, Math.ceil(lu / PAS) * PAS);
}

/** L'appel que la ligne téléphone porte en ce moment, ou null (pont muet ou trop lent). */
async function appelVivant(): Promise<string | null> {
  const attente = new Promise<null>((resoudre) => setTimeout(() => resoudre(null), ATTENTE_PONT_MS));
  const etat = await Promise.race([commanderPont('/etat'), attente]);
  if (!etat?.ok) return null;
  const { appelEnCours, appelId } = etat.corps as { appelEnCours?: boolean; appelId?: string | null };
  return appelEnCours && typeof appelId === 'string' ? appelId : null;
}

/** Couper sur un mot pour un extrait propre. */
function avantCoupe(texte: string, n: number): string {
  if (texte.length <= n) return texte;
  const bout = texte.slice(-n);
  const espace = bout.indexOf(' ');
  return `…${espace >= 0 ? bout.slice(espace + 1) : bout}`;
}

function apresCoupe(texte: string, n: number): string {
  if (texte.length <= n) return texte;
  const bout = texte.slice(0, n);
  const espace = bout.lastIndexOf(' ');
  return `${espace > 0 ? bout.slice(0, espace) : bout}…`;
}

/** Premier tour qui contient le terme, une soixantaine de caractères autour. */
function extraitDe(transcription: TourDeParole[] | null, terme: string, nomProspect: string): ExtraitAppel | null {
  if (!transcription || !terme) return null;
  const cherche = terme.toLocaleLowerCase('fr-FR');
  for (const tour of transcription) {
    const i = tour.texte.toLocaleLowerCase('fr-FR').indexOf(cherche);
    if (i < 0) continue;
    return {
      qui: tour.role === 'agent' ? 'Mina' : prenom(nomProspect),
      avant: avantCoupe(tour.texte.slice(0, i), 30),
      terme: tour.texte.slice(i, i + terme.length),
      apres: apresCoupe(tour.texte.slice(i + terme.length), 30),
    };
  }
  return null;
}

export default async function PageAppels({ searchParams }: { searchParams: Promise<Parametres> }) {
  const p = await searchParams;
  const q = p.q?.trim() ?? '';
  const issue: CleFiltreIssue | null = estFiltreIssue(p.issue) ? p.issue : null;
  const ligne = LIGNES.some((l) => l.valeur === p.ligne) ? p.ligne : undefined;
  const n = taille(p.n);

  const [fenetre, listeEntreprises, [twilio], vivantId] = await Promise.all([
    listerAppels({ entreprise: p.entreprise, ligne, recherche: q }, n),
    db.select({ slug: entreprises.slug, nom: entreprises.nom }).from(entreprises).orderBy(asc(entreprises.nom)),
    db.select({ id: appels.id }).from(appels).where(eq(appels.ligne, 'twilio')).limit(1),
    appelVivant(),
  ]);

  // Lectures complémentaires de la fenêtre : société, nombre d'étapes, libellés personnalisés, rendez-vous.
  const ids = fenetre.map((f) => f.appel.id);
  const versions = [...new Set(fenetre.map((f) => f.appel.versionScriptId))];
  const idsProspects = [...new Set(fenetre.map((f) => f.appel.prospectId))];
  const idsEntreprises = [...new Set(fenetre.map((f) => f.appel.entrepriseId))];
  const clesPerso = new Set<string>();
  for (const { appel } of fenetre) {
    for (const cle of [appel.issue, appel.bilan?.issue]) if (cle?.startsWith('perso:')) clesPerso.add(cle.slice(6));
  }
  const [etapes, societes, perso, rdv] = ids.length
    ? await Promise.all([
        db
          .select({ id: versionsScript.id, nombre: sql<number>`jsonb_array_length(${versionsScript.etapes})` })
          .from(versionsScript)
          .where(inArray(versionsScript.id, versions)),
        db
          .select({ entrepriseId: prospects.entrepriseId, id: prospects.id, societe: prospects.societe })
          .from(prospects)
          .where(and(inArray(prospects.entrepriseId, idsEntreprises), inArray(prospects.id, idsProspects))),
        clesPerso.size
          ? db
              .select({ id: issuesPersonnalisees.id, libelle: issuesPersonnalisees.libelle })
              .from(issuesPersonnalisees)
              .where(
                inArray(
                  issuesPersonnalisees.id,
                  [...clesPerso].filter((c) => /^[0-9a-f-]{36}$/.test(c)),
                ),
              )
          : Promise.resolve([]),
        db.select({ appelId: rendezVous.appelId }).from(rendezVous).where(inArray(rendezVous.appelId, ids)),
      ])
    : [[], [], [], []];
  const nombreEtapes = new Map(etapes.map((e) => [e.id, Number(e.nombre)]));
  const societe = new Map(societes.map((s) => [`${s.entrepriseId}/${s.id}`, s.societe]));
  const libellesPerso = new Map(perso.map((x) => [`perso:${x.id}`, x.libelle]));
  const avecRendezVous = new Set(rdv.map((r) => r.appelId));

  const lignes: (LigneAppel & { filtre: CleFiltreIssue })[] = fenetre.map(({ appel, prospect, entreprise }) => {
    const cleIssue = appel.issue ?? appel.bilan?.issue ?? null;
    const nom = prospect ?? appel.prospectId;
    return {
      id: appel.id,
      debutLe: appel.debutLe,
      ligne: appel.ligne,
      statut: appel.statut,
      issueSysteme: appel.issueSysteme,
      issue: appel.issue,
      erreur: appel.erreur,
      conversationId: appel.conversationId,
      bilan: appel.bilan ? { etapeAtteinte: appel.bilan.etapeAtteinte } : null,
      dureeSecondes: appel.dureeSecondes,
      resume: appel.bilan?.resume ?? null,
      prospect: nom,
      societe: societe.get(`${appel.entrepriseId}/${appel.prospectId}`) ?? null,
      entreprise,
      nombreEtapes: nombreEtapes.get(appel.versionScriptId) ?? null,
      rendezVous: avecRendezVous.has(appel.id),
      libellePerso: cleIssue ? (libellesPerso.get(cleIssue) ?? null) : null,
      extrait: q ? extraitDe(appel.transcription, q, nom) : null,
      filtre: cleFiltreIssue(appel),
    };
  });

  const comptes = new Map<CleFiltreIssue, number>();
  for (const l of lignes) comptes.set(l.filtre, (comptes.get(l.filtre) ?? 0) + 1);
  const affichees = issue ? lignes.filter((l) => l.filtre === issue) : lignes;

  const parametres = { q: q || undefined, entreprise: p.entreprise, issue: issue ?? undefined, ligne, n: n > PAS ? String(n) : undefined };
  const ici = lienAvec('/appels', parametres, {});
  const pleine = fenetre.length === n;
  const filtre = Boolean(q || p.entreprise || issue || ligne);
  const lignesProposees = LIGNES.filter((l) => l.valeur !== 'twilio' || twilio || ligne === 'twilio');

  return (
    <Page>
      <EnTetePage titre="Appels" compte={affichees.length} sousTitre="Du plus récent au plus ancien." />

      <div className="grid gap-2.5 border-b border-filet pb-3">
        <Filtres libelle={pleine ? `Issue, sur les ${n} derniers appels` : 'Issue'}>
          <Filtre actif={!issue} compte={lignes.length} href={lienAvec('/appels', parametres, { issue: null })}>
            Tous
          </Filtre>
          {FILTRES_ISSUE.map((f) => (
            <Filtre key={f.cle} actif={issue === f.cle} compte={comptes.get(f.cle) ?? 0} href={lienAvec('/appels', parametres, { issue: f.cle })}>
              {f.libelle}
            </Filtre>
          ))}
        </Filtres>
        <div className="flex flex-wrap items-center gap-x-10 gap-y-2 text-sm">
          <Filtres libelle="Ligne" className="text-sm!">
            <Filtre actif={!ligne} href={lienAvec('/appels', parametres, { ligne: null, n: null })}>
              Toutes
            </Filtre>
            {lignesProposees.map((l) => (
              <Filtre key={l.valeur} actif={ligne === l.valeur} href={lienAvec('/appels', parametres, { ligne: l.valeur, n: null })}>
                {l.libelle}
              </Filtre>
            ))}
          </Filtres>
          <FiltreEntreprise valeur={p.entreprise ?? ''} entreprises={listeEntreprises} parametres={parametres} />
          {pleine ? (
            <p className="flex flex-wrap items-center gap-x-1 text-encre-3">
              <span>
                Les <span className="font-mono">{n}</span> appels les plus récents
                {n >= PLAFOND ? ', le plus long historique affiché ici.' : ''}
              </span>
              {n < PLAFOND ? (
                <>
                  <span aria-hidden="true">·</span>
                  <LienAction href={lienAvec('/appels', parametres, { n: String(n + PAS) })} ton="discret" scroll={false}>
                    Afficher les {PAS} suivants
                  </LienAction>
                </>
              ) : null}
            </p>
          ) : null}
          <Recherche
            valeur={q}
            placeholder="Chercher un prospect, une société ou une phrase dite"
            libelle="Chercher dans les appels"
            conserver={{ issue: issue ?? undefined, entreprise: p.entreprise, ligne }}
            className="w-full sm:ml-auto sm:w-[360px]"
          />
        </div>
      </div>

      {affichees.length === 0 ? (
        filtre ? (
          <EtatVide
            forme="filtre"
            titre="Aucun appel ne correspond à ces filtres."
            action={
              <LienAction href="/appels" ton="fort">
                Effacer les filtres
              </LienAction>
            }
          >
            {q ? `Rien ne contient « ${q} » dans les noms, les sociétés, les résumés ni les transcriptions.` : null}
          </EtatVide>
        ) : (
          <EtatVide titre="Aucun appel pour l’instant." action={<LienAction href="/entreprises">Voir les entreprises</LienAction>}>
            Lance un appel depuis la fiche d’un prospect ou une campagne.
          </EtatVide>
        )
      ) : (
        <ListeAppels
          appels={affichees}
          depuis={ici}
          vivantId={vivantId}
          navigationClavier
          {...(q ? { recherche: q } : {})}
          libelle={issue ? `Appels : ${FILTRES_ISSUE.find((f) => f.cle === issue)?.libelle}` : 'Appels'}
        />
      )}
    </Page>
  );
}
