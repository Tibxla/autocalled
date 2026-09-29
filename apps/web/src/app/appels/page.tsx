import type { TourDeParole } from '@autocalled/domain';
import { asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { cleJour, FUSEAU, prenom } from '@/components/format-appel';
import { FILTRES_ISSUE, ListeAppels, type ExtraitAppel, type LigneAppel } from '@/components/liste-appels';
import { EnTetePage, EtatVide, Filtre, Filtres, LienAction, Page, Recherche } from '@/components/ui';
import { lienAvec } from '@/components/url';
import { db } from '@/db';
import { appels, entreprises, issuesPersonnalisees } from '@/db/schema';
import { comptesAppels, comptesParJour, pageAppels, PERIODES } from '@/lib/lecture';
import { assistantePourLaPage } from '@/lib/pages';
import { commanderPont } from '@/lib/pont';
import { versionsDeLEntreprise } from '@/lib/versions';
import { LIGNES_FILTRE, lireFiltresAppels } from './filtres';
import { FiltreJour, FiltreSelection } from './filtres-client';

export const metadata: Metadata = { title: 'Appels' };

/** Appels par page ; « Appels plus anciens » (N) passe à la suivante par curseur, filtres gardés. */
const PAS = 100;
/** Sous 640 px : une rangée de filtres qui défile seule, dans la gouttière, sans barre visible. */
const RANGEE_MOBILE = 'max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:-mx-(--gouttiere) max-sm:px-(--gouttiere) max-sm:[scrollbar-width:none]';
/** Au-delà, la liste s'affiche sans savoir quel appel la ligne porte : un pont qui pend ne la bloque pas. */
const ATTENTE_PONT_MS = 1500;

const LIBELLES_PERIODES: Record<(typeof PERIODES)[number], string> = {
  aujourdhui: 'Aujourd’hui',
  '7-jours': '7 jours',
  '30-jours': '30 jours',
  tout: 'Tout',
};

const FORMAT_JOUR = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: FUSEAU,
});

/** L'appel que la ligne téléphone porte en ce moment, ou null (pont muet ou trop lent). */
async function appelVivant(): Promise<string | null> {
  const attente = new Promise<null>((resoudre) => setTimeout(() => resoudre(null), ATTENTE_PONT_MS));
  const etat = await Promise.race([commanderPont('/etat'), attente]);
  if (!etat?.ok) return null;
  const { appelEnCours, appelId } = etat.corps as {
    appelEnCours?: boolean;
    appelId?: string | null;
  };
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

/**
 * Premier tour qui contient le terme, une soixantaine de caractères autour. La liste ne lit pas le nom figé sur
 * chaque appel : ses répliques sont attribuées au nom actuel de l'assistante.
 */
function extraitDe(transcription: TourDeParole[] | null, terme: string, nomProspect: string, nomAssistante: string): ExtraitAppel | null {
  if (!transcription || !terme) return null;
  const cherche = terme.toLocaleLowerCase('fr-FR');
  for (const tour of transcription) {
    const i = tour.texte.toLocaleLowerCase('fr-FR').indexOf(cherche);
    if (i < 0) continue;
    return {
      qui: tour.role === 'agent' ? nomAssistante : prenom(nomProspect),
      avant: avantCoupe(tour.texte.slice(0, i), 30),
      terme: tour.texte.slice(i, i + terme.length),
      apres: apresCoupe(tour.texte.slice(i + terme.length), 30),
    };
  }
  return null;
}

export default async function PageAppels({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const brut = await searchParams;
  const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const { parametres, filtres } = lireFiltresAppels(Object.fromEntries(Object.entries(brut).map(([k, v]) => [k, un(v)])));
  const { q = '', issue, ligne, periode, avant } = parametres;

  const [entreprise] = parametres.entreprise
    ? await db.select({ id: entreprises.id, nom: entreprises.nom }).from(entreprises).where(eq(entreprises.slug, parametres.entreprise))
    : [];
  const rappels = parametres.rappels === '1';
  // Les comptes par issue restent ceux de la liste sans le filtre des rappels ; celui-ci a son propre compte.
  const filtresSansRappels = { ...filtres };
  delete filtresSansRappels.rappels;
  const [page, comptes, compteRappels, listeEntreprises, [twilio], vivantId, versions, persos, { nom: nomAssistante }] = await Promise.all([
    pageAppels(filtres, { taille: PAS, ...(avant ? { avant } : {}), ...(parametres.rappels === '1' ? { ordre: 'rappel' as const } : {}) }),
    comptesAppels(filtresSansRappels),
    comptesAppels({ ...filtresSansRappels, rappels: true }).then((c) => c.total),
    db.select({ slug: entreprises.slug, nom: entreprises.nom }).from(entreprises).orderBy(asc(entreprises.nom)),
    db.select({ id: appels.id }).from(appels).where(eq(appels.ligne, 'twilio')).limit(1),
    appelVivant(),
    entreprise ? versionsDeLEntreprise(entreprise.id) : Promise.resolve([]),
    entreprise
      ? db
          .select({
            id: issuesPersonnalisees.id,
            libelle: issuesPersonnalisees.libelle,
            archivee: issuesPersonnalisees.archivee,
          })
          .from(issuesPersonnalisees)
          .where(eq(issuesPersonnalisees.entrepriseId, entreprise.id))
          .orderBy(asc(issuesPersonnalisees.libelle))
      : Promise.resolve([]),
    assistantePourLaPage(),
  ]);
  const jours = [...new Set(page.lignes.map((l) => cleJour(l.debutLe)))];
  const [comptesJours, simules] = await Promise.all([
    comptesParJour(filtres, jours),
    // Liste vide sans aucun filtre : dire s'il existe des appels simulés, rangés à part.
    page.lignes.length === 0 && !ligne ? comptesAppels({ ligne: 'simulation' }).then((c) => c.total) : Promise.resolve(0),
  ]);

  const lignes: LigneAppel[] = page.lignes.map((a) => {
    const nom = a.prospect ?? a.prospectId;
    return {
      id: a.id,
      debutLe: a.debutLe,
      ligne: a.ligne,
      statut: a.statut,
      issueSysteme: a.issueSysteme,
      issue: a.issue,
      erreur: a.erreur,
      conversationId: a.conversationId,
      bilan: a.avecBilan ? { etapeAtteinte: a.etapeAtteinte ?? 0 } : null,
      dureeSecondes: a.dureeSecondes,
      resume: a.resume,
      prospect: nom,
      societe: a.societe,
      entreprise: a.entreprise,
      nombreEtapes: a.nombreEtapes,
      rendezVous: a.rendezVous,
      libellePerso: a.libellePerso,
      extrait: q ? extraitDe(a.transcription, q, nom, nomAssistante) : null,
      rappel: { le: a.rappelLe, quand: a.rappelQuand, texte: a.rappelTexte },
    };
  });

  // Les liens de filtre repartent de la première page ; seul « Appels plus anciens » pose le curseur.
  const sansCurseur: Record<string, string | undefined> = {
    ...parametres,
    avant: undefined,
  };
  const lien = (changements: Record<string, string | null>) => lienAvec('/appels', sansCurseur, changements);
  const ici = lienAvec('/appels', { ...parametres }, {});
  const filtre = Boolean(q || parametres.entreprise || issue || ligne || parametres.version || periode || rappels);
  const lignesProposees = LIGNES_FILTRE.filter((l) => l.valeur !== 'twilio' || twilio || ligne === 'twilio');
  const persosProposees = persos.filter((p) => !p.archivee || (comptes.parPerso[`perso:${p.id}`] ?? 0) > 0 || issue === `perso:${p.id}`);
  const libelleIssue = rappels ? 'Rappels à faire' : issue ? (FILTRES_ISSUE.find((f) => f.cle === issue)?.libelle ?? persos.find((p) => `perso:${p.id}` === issue)?.libelle ?? null) : null;
  const compteFiltre = rappels
    ? compteRappels
    : issue
      ? issue.startsWith('perso:')
        ? (comptes.parPerso[issue] ?? 0)
        : (comptes.parIssue[issue] ?? 0)
      : comptes.total;
  const jourPrecis = periode && !(PERIODES as readonly string[]).includes(periode) ? periode : '';
  const population = ligne === 'simulation' ? 'appels simulés' : 'appels réels';

  return (
    <Page>
      <EnTetePage
        titre="Appels"
        compte={compteFiltre}
        {...(entreprise && parametres.entreprise ? { retour: { href: `/entreprises/${parametres.entreprise}`, libelle: entreprise.nom } } : {})}
        sousTitre={
          rappels
            ? 'Rappels convenus encore à faire, du plus ancien au plus tardif ; les rappels sans date à la fin.'
            : ligne === 'simulation'
              ? 'Appels simulés, du plus récent au plus ancien ; ils ne comptent dans aucun chiffre.'
              : 'Appels réels, du plus récent au plus ancien ; les simulés sont à part.'
        }
      />

      <div className="grid gap-2.5 border-b border-filet pb-3">
        <Filtres libelle={`Issue, ${population}`} className={RANGEE_MOBILE}>
          <Filtre actif={!issue && !rappels} compte={comptes.total} href={lien({ issue: null, rappels: null })}>
            Tous
          </Filtre>
          {FILTRES_ISSUE.map((f) => (
            <Filtre key={f.cle} actif={issue === f.cle} compte={comptes.parIssue[f.cle] ?? 0} href={lien({ issue: f.cle, rappels: null })}>
              {f.libelle}
            </Filtre>
          ))}
        </Filtres>
        {persosProposees.length > 0 ? (
          <div className="flex flex-wrap items-baseline gap-x-[22px] gap-y-1 text-sm">
            <span aria-hidden="true" className="text-encre-3">
              Issues personnalisées
            </span>
            <Filtres libelle="Issues personnalisées de l’entreprise" className="text-sm!">
              {persosProposees.map((p) => (
                <Filtre
                  key={p.id}
                  actif={issue === `perso:${p.id}`}
                  compte={comptes.parPerso[`perso:${p.id}`] ?? 0}
                  href={lien({
                    issue: issue === `perso:${p.id}` ? null : `perso:${p.id}`,
                    rappels: null,
                  })}
                >
                  {p.libelle}
                </Filtre>
              ))}
            </Filtres>
          </div>
        ) : null}
        <div className={`flex flex-wrap items-center gap-x-10 gap-y-2 text-sm ${RANGEE_MOBILE}`}>
          {/* Un rappel convenu reste à faire tant qu'aucun appel plus récent n'est parti vers le prospect. Ce n'est pas une issue. */}
          <Filtres libelle="Rappels" className="text-sm! max-sm:shrink-0">
            <Filtre actif={rappels} compte={compteRappels} href={lien({ rappels: rappels ? null : '1', issue: null })}>
              Rappels à faire
            </Filtre>
          </Filtres>
          <Filtres libelle="Ligne" className="text-sm! max-sm:shrink-0 max-sm:flex-nowrap">
            <Filtre actif={!ligne} href={lien({ ligne: null })}>
              Réels
            </Filtre>
            {lignesProposees.map((l) => (
              <Filtre key={l.valeur} actif={ligne === l.valeur} href={lien({ ligne: l.valeur })}>
                {l.libelle}
              </Filtre>
            ))}
          </Filtres>
          <div className="flex flex-wrap items-center gap-x-[22px] gap-y-1 max-sm:shrink-0 max-sm:flex-nowrap">
            <Filtres libelle="Période" className="text-sm! max-sm:flex-nowrap">
              {PERIODES.map((cle) => (
                <Filtre key={cle} actif={cle === 'tout' ? !periode : periode === cle} href={lien({ periode: cle === 'tout' ? null : cle })}>
                  {LIBELLES_PERIODES[cle]}
                </Filtre>
              ))}
            </Filtres>
            <FiltreJour valeur={jourPrecis} parametres={sansCurseur} />
          </div>
        </div>
        {/* Sous 640 px, la recherche remonte juste sous le titre, comme sur l'accueil ; les listes déroulantes restent en bas. */}
        <div className="flex flex-wrap items-center gap-x-10 gap-y-2 text-sm max-sm:contents">
          {listeEntreprises.length > 1 || parametres.entreprise ? (
            <FiltreSelection
              cle="entreprise"
              libelle="Entreprise"
              vide="Toutes les entreprises"
              valeur={parametres.entreprise ?? ''}
              options={listeEntreprises.map((e) => ({
                valeur: e.slug,
                libelle: e.nom,
              }))}
              parametres={sansCurseur}
              changements={{
                version: null,
                ...(issue?.startsWith('perso:') ? { issue: null } : {}),
              }}
            />
          ) : null}
          {versions.length > 1 || parametres.version ? (
            <FiltreSelection
              cle="version"
              libelle="Version de script"
              vide="Toutes les versions"
              valeur={parametres.version ?? ''}
              options={versions.map((v) => ({
                valeur: v.id,
                libelle: v.libelle,
              }))}
              parametres={sansCurseur}
            />
          ) : null}
          <Recherche
            valeur={q}
            placeholder="Prospect, société ou phrase dite"
            libelle="Chercher dans les appels"
            conserver={{ ...sansCurseur, q: undefined }}
            className="w-full max-sm:order-first sm:ml-auto sm:w-[360px]"
          />
        </div>
      </div>

      {avant ? (
        <p className="flex flex-wrap items-center gap-x-1 pt-3 text-sm text-encre-3">
          <span>Appels plus anciens que ceux de la première page.</span>
          <LienAction href={lien({})} ton="discret">
            Revenir aux plus récents
          </LienAction>
        </p>
      ) : null}

      {lignes.length === 0 ? (
        filtre || avant ? (
          <EtatVide
            forme="filtre"
            titre={avant ? 'Plus aucun appel plus ancien.' : 'Aucun appel ne correspond à ces filtres.'}
            action={
              <LienAction href={avant ? lien({}) : '/appels'} ton="fort">
                {avant ? 'Revenir aux plus récents' : 'Effacer les filtres'}
              </LienAction>
            }
          >
            {q && !avant ? `Rien ne contient « ${q} » dans les noms, les sociétés, les résumés ni les transcriptions.` : null}
            {jourPrecis && !q && !avant ? `Aucun appel le ${FORMAT_JOUR.format(new Date(`${jourPrecis}T12:00:00Z`))}.` : null}
          </EtatVide>
        ) : simules > 0 ? (
          <EtatVide titre="Aucun appel réel pour l’instant." action={<LienAction href={lien({ ligne: 'simulation' })}>Voir les appels simulés</LienAction>}>
            Les appels simulés ne comptent pas parmi les appels réels.
          </EtatVide>
        ) : (
          <EtatVide titre="Aucun appel pour l’instant." action={<LienAction href="/entreprises">Voir les entreprises</LienAction>}>
            Lance un appel depuis la fiche d’un prospect ou une campagne.
          </EtatVide>
        )
      ) : (
        <>
          <ListeAppels
            appels={lignes}
            depuis={ici}
            vivantId={vivantId}
            navigationClavier
            rappels={rappels}
            comptesJours={comptesJours}
            {...(q ? { recherche: q } : {})}
            libelle={libelleIssue ? `Appels : ${libelleIssue}` : 'Appels'}
          />
          <div className="-mx-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-sm">
            {rappels ? (
              <span className="px-1.5 text-encre-3">
                {page.suivant ? `Les ${PAS} premiers rappels à faire ; les suivants apparaîtront une fois ceux-ci faits.` : 'Fin de la liste.'}
              </span>
            ) : page.suivant ? (
              <LienAction href={lien({ avant: page.suivant })} touche="N" raccourci="n" groupeRaccourci="Liste">
                Appels plus anciens
              </LienAction>
            ) : (
              <span className="px-1.5 text-encre-3">Fin de la liste.</span>
            )}
            {avant ? (
              <LienAction href={lien({})} ton="discret">
                Revenir aux plus récents
              </LienAction>
            ) : null}
          </div>
        </>
      )}
    </Page>
  );
}
