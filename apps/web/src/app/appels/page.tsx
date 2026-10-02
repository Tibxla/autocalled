import type { TourDeParole } from '@autocalled/domain';
import { asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { cleJour, FUSEAU, prenom } from '@/components/format-appel';
import { FILTRES_ISSUE, ListeAppels, type ExtraitAppel, type LigneAppel } from '@/components/liste-appels';
import { EnTetePage, EtatVide, Filtre, Filtres, LienAction, Page, Recherche } from '@/components/ui';
import { lienAvec } from '@/components/url';
import { GroupeFiltres, VoletFiltres } from '@/components/volet-filtres';
import { db } from '@/db';
import { appels, entreprises, issuesPersonnalisees } from '@/db/schema';
import { comptesAppels, comptesParJour, pageAppels, PERIODES } from '@/lib/lecture';
import { assistantePourLaPage } from '@/lib/pages';
import { appelTelephoneVivant } from '@/lib/ligne-vivante';
import { versionsDeLEntreprise } from '@/lib/versions';
import { LIGNES_FILTRE, lireFiltresAppels, SENS_FILTRE } from './filtres';
import { FiltreJour, FiltreSelection } from './filtres-client';

export const metadata: Metadata = { title: 'Appels' };

/** Appels par page ; « Appels plus anciens » (N) passe à la suivante par curseur, filtres gardés. */
const PAS = 100;
/** Au-delà, la liste s'affiche sans savoir quel appel la ligne porte : un pont qui pend ne la bloque pas. */
const ATTENTE_PONT_MS = 1500;

const LIBELLES_PERIODES: Record<(typeof PERIODES)[number], string> = {
  aujourdhui: 'Aujourd’hui',
  '7-jours': '7 jours',
  '30-jours': '30 jours',
  tout: 'Tout',
};

const FORMAT_JOUR_COURT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: FUSEAU });

const FORMAT_JOUR = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: FUSEAU,
});

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
  const { q = '', issue, ligne, periode, avant, sens } = parametres;

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
    appelTelephoneVivant(ATTENTE_PONT_MS),
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
      sens: a.sens,
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
      ...(rappels ? { ficheProspect: `/entreprises/${a.entrepriseSlug}/prospects/${a.prospectId}` } : {}),
    };
  });

  // Les liens de filtre repartent de la première page ; seul « Appels plus anciens » pose le curseur.
  const sansCurseur: Record<string, string | undefined> = {
    ...parametres,
    avant: undefined,
  };
  const lien = (changements: Record<string, string | null>) => lienAvec('/appels', sansCurseur, changements);
  const ici = lienAvec('/appels', { ...parametres }, {});
  const filtre = Boolean(q || parametres.entreprise || issue || ligne || parametres.version || periode || rappels || sens);
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

  // Sous 640 px, les familles secondaires (ligne, période, entreprise, version, issues personnalisées) passent dans le
  // volet « Filtres » ; son résumé dit celles qui sont actives, « Effacer les filtres » ne retire qu'elles.
  const persoChoisie = issue?.startsWith('perso:') ? (persos.find((p) => `perso:${p.id}` === issue)?.libelle ?? null) : null;
  const resumeVolet = [
    sens ? (SENS_FILTRE.find((x) => x.valeur === sens)?.libelle ?? null) : null,
    ligne ? (LIGNES_FILTRE.find((l) => l.valeur === ligne)?.libelle ?? null) : null,
    jourPrecis
      ? FORMAT_JOUR_COURT.format(new Date(`${jourPrecis}T12:00:00Z`))
      : periode && periode !== 'tout'
        ? (LIBELLES_PERIODES[periode as (typeof PERIODES)[number]] ?? null)
        : null,
    entreprise?.nom ?? null,
    parametres.version ? (versions.find((v) => v.id === parametres.version)?.libelle ?? null) : null,
    persoChoisie,
  ].filter((x): x is string => Boolean(x));
  const effacerVolet =
    resumeVolet.length > 0 ? lien({ sens: null, ligne: null, periode: null, entreprise: null, version: null, ...(persoChoisie ? { issue: null } : {}) }) : null;

  const filtreLigne = (
    <>
      <Filtre actif={!ligne} href={lien({ ligne: null })}>
        Réels
      </Filtre>
      {lignesProposees.map((l) => (
        <Filtre key={l.valeur} actif={ligne === l.valeur} href={lien({ ligne: l.valeur })}>
          {l.libelle}
        </Filtre>
      ))}
    </>
  );
  // Qui a appelé qui : l'assistante (sortants) ou le prospect, qui a rappelé le téléphone passerelle (entrants). Comme
  // « Rappels à faire », un second clic sur le filtre actif le retire : sans lui, les deux sens.
  const filtreSens = SENS_FILTRE.map((x) => (
    <Filtre key={x.valeur} actif={sens === x.valeur} href={lien({ sens: sens === x.valeur ? null : x.valeur })}>
      {x.libelle}
    </Filtre>
  ));
  const filtrePeriode = PERIODES.map((cle) => (
    <Filtre key={cle} actif={cle === 'tout' ? !periode : periode === cle} href={lien({ periode: cle === 'tout' ? null : cle })}>
      {LIBELLES_PERIODES[cle]}
    </Filtre>
  ));
  const filtresPerso = persosProposees.map((p) => (
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
  ));
  const choixEntreprise = (className?: string) =>
    listeEntreprises.length > 1 || parametres.entreprise ? (
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
        {...(className ? { className } : {})}
      />
    ) : null;
  const choixVersion = (className?: string) =>
    versions.length > 1 || parametres.version ? (
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
        {...(className ? { className } : {})}
      />
    ) : null;

  return (
    <Page>
      <EnTetePage
        titre="Appels"
        compte={compteFiltre}
        {...(entreprise && parametres.entreprise ? { retour: { href: `/entreprises/${parametres.entreprise}`, libelle: entreprise.nom } } : {})}
        sousTitre={
          rappels
            ? 'Rappels convenus encore à faire, du plus ancien au plus tardif ; les rappels sans date à la fin.'
            : sens === 'entrant'
              ? 'Appels entrants : les prospects qui ont rappelé le téléphone passerelle, du plus récent au plus ancien.'
              : ligne === 'simulation'
              ? 'Appels simulés, du plus récent au plus ancien ; ils ne comptent dans aucun chiffre.'
              : 'Appels réels, du plus récent au plus ancien ; les simulés sont à part.'
        }
      />

      <div className="grid gap-2.5 border-b border-filet pb-3">
        {/* Dès 640 px : les rangées de filtres habituelles. Sous 640 px, elles cèdent la place à une seule rangée qui
            défile (Tous, Rappels à faire, issues) et au volet « Filtres » ; les liens de filtre sont doublés, jamais la
            recherche, rendue une seule fois et remontée en tête. */}
        <Filtres libelle={`Issue, ${population}`} className="max-sm:hidden">
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
          <div className="flex flex-wrap items-baseline gap-x-[22px] gap-y-1 text-sm max-sm:hidden">
            <span aria-hidden="true" className="text-encre-3">
              Issues personnalisées
            </span>
            <Filtres libelle="Issues personnalisées de l’entreprise" className="text-sm!">
              {filtresPerso}
            </Filtres>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-10 gap-y-2 text-sm max-sm:hidden">
          {/* Un rappel convenu reste à faire tant qu'aucun appel plus récent n'est parti vers le prospect. Ce n'est pas une issue. */}
          <Filtres libelle="Rappels" className="text-sm!">
            <Filtre actif={rappels} compte={compteRappels} href={lien({ rappels: rappels ? null : '1', issue: null })}>
              Rappels à faire
            </Filtre>
          </Filtres>
          <Filtres libelle="Sens" className="text-sm!">
            {filtreSens}
          </Filtres>
          <Filtres libelle="Ligne" className="text-sm!">
            {filtreLigne}
          </Filtres>
          <div className="flex flex-wrap items-center gap-x-[22px] gap-y-1">
            <Filtres libelle="Période" className="text-sm!">
              {filtrePeriode}
            </Filtres>
            <FiltreJour valeur={jourPrecis} parametres={sansCurseur} />
          </div>
        </div>

        <Filtres libelle={`Issue et rappels, ${population}`} className="sm:hidden">
          <Filtre actif={!issue && !rappels} compte={comptes.total} href={lien({ issue: null, rappels: null })}>
            Tous
          </Filtre>
          <Filtre actif={rappels} compte={compteRappels} href={lien({ rappels: rappels ? null : '1', issue: null })}>
            Rappels à faire
          </Filtre>
          {FILTRES_ISSUE.map((f) => (
            <Filtre key={f.cle} actif={issue === f.cle} compte={comptes.parIssue[f.cle] ?? 0} href={lien({ issue: f.cle, rappels: null })}>
              {f.libelle}
            </Filtre>
          ))}
        </Filtres>
        <VoletFiltres resume={resumeVolet} effacer={effacerVolet}>
          <GroupeFiltres libelle="Sens">{filtreSens}</GroupeFiltres>
          <GroupeFiltres libelle="Ligne">{filtreLigne}</GroupeFiltres>
          <GroupeFiltres libelle="Période">
            {filtrePeriode}
            <FiltreJour valeur={jourPrecis} parametres={sansCurseur} />
          </GroupeFiltres>
          {choixEntreprise('w-full') ? <GroupeFiltres libelle="Entreprise">{choixEntreprise('w-full')}</GroupeFiltres> : null}
          {choixVersion('w-full') ? <GroupeFiltres libelle="Version de script">{choixVersion('w-full')}</GroupeFiltres> : null}
          {filtresPerso.length > 0 ? <GroupeFiltres libelle="Issues personnalisées">{filtresPerso}</GroupeFiltres> : null}
        </VoletFiltres>

        <div className="flex flex-wrap items-center gap-x-10 gap-y-2 text-sm max-sm:contents">
          {choixEntreprise() || choixVersion() ? (
            <div className="flex flex-wrap items-center gap-x-10 gap-y-2 max-sm:hidden">
              {choixEntreprise()}
              {choixVersion()}
            </div>
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
