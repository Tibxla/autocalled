import { type IssueSysteme, LIBELLES_ISSUES } from '@autocalled/domain';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { FUSEAU, LIGNES_LONGUES, duree, etatAppel, heure, issueEffective, jourCourt, numeroMasque, prenom } from '@/components/format-appel';
import { cleFiltreIssue, estFiltreIssue } from '@/components/liste-appels';
import { EtatVide, GlypheEtape, LienAction, Message, Page, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { campagnes, scripts } from '@/db/schema';
import { numeroLisible } from '@/lib/format';
import { LIGNES, type Ligne, listerAppels, lireAppel } from '@/lib/lecture';
import { Actualisation, Ecoule } from './actualisation';
import { BoutonRelancer } from './bouton-relancer';
import { LecteurAppel } from './lecteur-appel';
import { SuiviTelephone } from './suivi-telephone';

const lire = cache(lireAppel);
const FORME_ID = /^[0-9a-f-]{36}$/;

/** Au-delà, une analyse qui n'a pas abouti est déclarée bloquée. */
const ANALYSE_MAX_S = 5 * 60;
/** Au-delà, un appel navigateur ou simulé encore « en cours » n'est plus présenté comme vivant. */
const VIE_MAX_S = 10 * 60;

type Parametres = { depuis?: string; q?: string };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const lu = FORME_ID.test(id) ? await lire(id) : null;
  return { title: lu ? `Appel de ${lu.prospect?.nom ?? lu.appel.prospectId}` : 'Appel' };
}

/** Secondes écoulées depuis une date (hors rendu : l'heure courante n'est lue qu'ici). */
function ecouleDepuis(d: Date): number {
  return (Date.now() - d.getTime()) / 1000;
}

const FORMAT_JOUR_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: FUSEAU });
const FORMAT_JOUR_MOIS = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: FUSEAU });

/** D'où vient l'opérateur : libellé et lien du retour, et la liste d'appels d'origine s'il y en a une. */
function origine(depuis: string | undefined, nomProspect: string): { href: string; libelle: string; liste: URL | null } {
  const defaut = { href: '/appels', libelle: 'Appels', liste: null };
  // Chemin interne seulement : ni autre hôte (//), ni schéma, ni antislash.
  if (!depuis || !depuis.startsWith('/') || depuis.startsWith('//') || depuis.includes('\\') || depuis.length > 2000) return defaut;
  let url: URL;
  try {
    url = new URL(depuis, 'http://interne');
  } catch {
    return defaut;
  }
  if (url.host !== 'interne') return defaut;
  const href = `${url.pathname}${url.search}`;
  if (url.pathname === '/appels') return { href, libelle: 'Appels', liste: url };
  if (url.pathname === '/') return { href, libelle: 'Accueil', liste: null };
  if (/^\/campagnes\/[^/]+\/?$/.test(url.pathname)) return { href, libelle: 'Campagne', liste: null };
  if (/^\/entreprises\/[^/]+\/prospects\/[^/]+\/?$/.test(url.pathname)) return { href, libelle: nomProspect, liste: null };
  return defaut;
}

/** L'appel précédent et le suivant dans la liste d'origine, mêmes filtres et même fenêtre. */
async function voisins(id: string, liste: URL | null) {
  if (!liste) return { precedent: null, suivant: null };
  const p = Object.fromEntries(liste.searchParams);
  const ligne = (LIGNES as readonly string[]).includes(p.ligne ?? '') ? (p.ligne as Ligne) : undefined;
  const n = Math.min(1000, Math.max(200, Math.ceil((Number.parseInt(p.n ?? '', 10) || 200) / 200) * 200));
  const fenetre = await listerAppels({ entreprise: p.entreprise, ligne, recherche: p.q?.trim() ?? '' }, n);
  const issue = estFiltreIssue(p.issue) ? p.issue : null;
  const ordre = (issue ? fenetre.filter((f) => cleFiltreIssue(f.appel) === issue) : fenetre).map((f) => f.appel.id);
  const i = ordre.indexOf(id);
  if (i < 0) return { precedent: null, suivant: null };
  return { precedent: ordre[i - 1] ?? null, suivant: ordre[i + 1] ?? null };
}

function lienVoisin(id: string, depuis: string, q: string): string {
  const s = new URLSearchParams({ depuis });
  if (q) s.set('q', q);
  return `/appels/${id}?${s.toString()}`;
}

export default async function PageAppel({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Parametres> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!FORME_ID.test(id)) notFound();
  const lu = await lire(id);
  if (!lu) notFound();
  const { appel, entreprise, prospect, version, objections: listeObjections, personnalisees, rendezVous: rdv } = lu;

  const nomProspect = prospect?.nom ?? appel.prospectId;
  const retour = origine(sp.depuis, nomProspect);
  const q = sp.q?.trim() ?? '';
  const [[script], [campagne], proches] = await Promise.all([
    version ? db.select({ nom: scripts.nom }).from(scripts).where(eq(scripts.id, version.scriptId)) : Promise.resolve([]),
    appel.campagneId ? db.select({ creeLe: campagnes.creeLe }).from(campagnes).where(eq(campagnes.id, appel.campagneId)) : Promise.resolve([]),
    voisins(appel.id, retour.liste),
  ]);

  const bilan = appel.bilan;
  const etapes = version?.etapes ?? [];
  const enDirect = appel.statut === 'en-cours';
  const telephone = appel.ligne === 'bluetooth';
  const age = ecouleDepuis(appel.debutLe);
  const ageAnalyse = ecouleDepuis(appel.finLe ?? appel.debutLe);
  const analyseBloquee = appel.statut === 'traitement' && ageAnalyse > ANALYSE_MAX_S;

  const issue = issueEffective({ issueSysteme: appel.issueSysteme, issue: appel.issue });
  const cleIssue = bilan?.issue ?? appel.issue ?? null;
  const perso = cleIssue?.startsWith('perso:') ? (personnalisees.find((p) => `perso:${p.id}` === cleIssue)?.libelle ?? null) : null;
  const libelleIssue = perso ?? (issue ? LIBELLES_ISSUES[issue as IssueSysteme] : etatAppel(appel).libelle);
  const rendezVousPris = issue === 'rendez-vous-pris' || rdv !== null;

  const numero = numeroLisible(appel.numero);
  const meta: React.ReactNode[] = [
    <span key="date">
      {jourCourt(appel.debutLe)} {heure(appel.debutLe)}
    </span>,
  ];
  if (appel.dureeSecondes) meta.push(<span key="duree">{duree(appel.dureeSecondes)}</span>);
  meta.push(<span key="ligne">{LIGNES_LONGUES[appel.ligne] ?? appel.ligne}</span>);
  if (appel.versionAgent) meta.push(<span key="mina">Mina {appel.versionAgent.slice(-6)}</span>);
  if (version) meta.push(<span key="script">{`${script?.nom ?? 'Script'} v${version.numero}`}</span>);
  if (appel.campagneId && campagne)
    meta.push(
      <Link
        key="campagne"
        href={`/campagnes/${appel.campagneId}`}
        className="decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline"
      >
        Campagne du {FORMAT_JOUR_MOIS.format(campagne.creeLe)}
      </Link>,
    );
  meta.push(
    <span key="numero" title={numero}>
      {numeroMasque(numero)}
    </span>,
  );

  const ficheProspect = `/entreprises/${entreprise.slug}/prospects/${appel.prospectId}`;
  const precedent = proches.precedent ? lienVoisin(proches.precedent, retour.href, q) : null;
  const suivant = proches.suivant ? lienVoisin(proches.suivant, retour.href, q) : null;

  const rapatrier = (ton: 'fort' | 'normal' = 'fort') => (
    <BoutonRelancer appelId={appel.id} libelle="Rapatrier la conversation et le bilan" ton={ton} suivre statut={appel.statut} />
  );

  // Le suivi direct : même place et même clé pour en-cours puis traitement (le fil survit au rapatriement).
  const suiviDirect =
    telephone && (appel.statut === 'en-cours' || appel.statut === 'traitement') ? (
      <SuiviTelephone
        key={appel.id}
        appelId={appel.id}
        statut={appel.statut}
        debutLe={appel.debutLe.toISOString()}
        finLe={appel.finLe?.toISOString() ?? null}
        conversation={Boolean(appel.conversationId)}
        {...(prospect?.nom ? { libelleProspect: prenom(prospect.nom) } : {})}
      />
    ) : null;

  let etatDirect: React.ReactNode = null;
  let actualisation: React.ReactNode = null;
  if (appel.statut === 'en-cours' && telephone) {
    // Filet de sécurité : la fin peut ne jamais arriver par le fil (pont redémarré). La bande garde son fil.
    actualisation = <Actualisation secondes={10} />;
  } else if (appel.statut === 'en-cours' && appel.ligne === 'simulation' && age < VIE_MAX_S) {
    etatDirect = <Message ton="neutre">Simulation en cours : un modèle joue le prospect. La page se met à jour à la fin.</Message>;
    actualisation = <Actualisation secondes={3} dureeMaxSecondes={Math.ceil(VIE_MAX_S - age)} />;
  } else if (appel.statut === 'en-cours' && appel.ligne === 'navigateur' && age < VIE_MAX_S) {
    etatDirect = <Message ton="neutre">Appel en cours sur la ligne navigateur, dans la page qui l’a lancé.</Message>;
    actualisation = <Actualisation secondes={10} dureeMaxSecondes={Math.ceil(VIE_MAX_S - age)} />;
  } else if (appel.statut === 'en-cours') {
    etatDirect = (
      <Message ton="neutre" titre="Appel resté ouvert : la page qui le portait a été fermée pendant l’appel.">
        {appel.conversationId ? <div className="-mx-1.5 pt-1.5">{rapatrier()}</div> : 'Rien à rapatrier : la conversation n’a pas été ouverte.'}
      </Message>
    );
  } else if (appel.statut === 'traitement' && analyseBloquee) {
    etatDirect = (
      <Message ton="neutre" titre="L’analyse ne progresse plus.">
        Le rapatriement a commencé il y a plus de cinq minutes sans aboutir.
        {appel.conversationId ? <div className="-mx-1.5 pt-1.5">{rapatrier()}</div> : null}
      </Message>
    );
  } else if (appel.statut === 'traitement') {
    if (!telephone)
      etatDirect = (
        <Message ton="neutre">
          Rapatriement et analyse en cours · <Ecoule depuis={(appel.finLe ?? appel.debutLe).toISOString()} />
        </Message>
      );
    actualisation = <Actualisation secondes={3} dureeMaxSecondes={Math.max(3, Math.ceil(ANALYSE_MAX_S - ageAnalyse))} />;
  } else if (appel.statut === 'echec' && !appel.conversationId) {
    etatDirect = (
      <Message ton="alerte" action={<LienAction href="/telephone">Voir la ligne</LienAction>}>
        L’appel n’est pas parti : {appel.erreur ?? 'aucune raison enregistrée.'}
      </Message>
    );
  } else if (appel.statut === 'echec') {
    etatDirect = (
      <Message ton="alerte" titre={`L’analyse a échoué : ${appel.erreur ?? 'aucune raison enregistrée.'}`}>
        <div className="-mx-1.5 pt-1.5">
          <BoutonRelancer appelId={appel.id} libelle="Relancer l’analyse" ton="fort" suivre statut={appel.statut} />
        </div>
      </Message>
    );
  }

  const blocIssue =
    appel.statut === 'termine' ? (
      <section aria-label="Issue de l’appel" className="grid gap-3 border-b border-filet pb-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <GlypheEtape
            hauteur={20}
            etat={bilan ? 'bilan' : 'sans-bilan'}
            etape={bilan?.etapeAtteinte ?? null}
            nombre={etapes.length || null}
            rendezVous={rendezVousPris}
          />
          <p className="text-xl font-semibold tracking-[-0.01em] text-encre">{libelleIssue}</p>
          {perso && issue ? <span className="text-md text-encre-3">{LIBELLES_ISSUES[issue as IssueSysteme]}</span> : null}
        </div>
        {bilan?.rappel ? <p className="text-base text-encre-2">Rappel convenu : {bilan.rappel}</p> : null}
        {rendezVousPris && !rdv ? (
          <p className="text-sm text-encre-3">Aucun rendez-vous réservé dans l’agenda pour cet appel : seul le bilan le dit.</p>
        ) : null}
        {bilan && etapes.length ? (
          <div className="grid gap-1.5">
            <p className="text-sm text-encre-3">
              {bilan.etapeAtteinte > 0 ? (
                <>
                  Étape atteinte <span className="font-mono">{Math.min(bilan.etapeAtteinte, etapes.length)}</span> sur{' '}
                  <span className="font-mono">{etapes.length}</span>
                </>
              ) : (
                'Aucune étape du script atteinte'
              )}
            </p>
            <ol aria-label="Étapes du script" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {etapes.map((e, i) => (
                <li
                  key={i}
                  title={e.intention}
                  className={`flex max-w-[32ch] min-w-0 items-baseline gap-1.5 ${i < bilan.etapeAtteinte ? 'text-encre' : 'text-encre-3'}`}
                >
                  <span className="font-mono text-xs">{i + 1}</span>
                  <span className="truncate">{e.intention}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {rdv ? (
          <div className="grid gap-1 text-sm">
            <p className="text-base text-encre">
              {rdv.lienVisio ? 'Visio' : 'Rendez-vous'} {FORMAT_JOUR_LONG.format(rdv.debut)},{' '}
              <span className="font-mono">
                {heure(rdv.debut)} à {heure(rdv.fin)}
              </span>
            </p>
            <div className="-mx-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              {rdv.statut === 'cree' ? <span className="px-1.5 text-encre-2">Dans l’agenda</span> : null}
              {rdv.statut === 'a-creer' ? <span className="px-1.5 text-encre-3">Événement à créer</span> : null}
              {rdv.statut === 'echec' ? (
                <>
                  <span className="px-1.5 text-alerte">Création échouée : {rdv.erreur ?? 'raison inconnue.'}</span>
                  <LienAction href="/reglages">Voir dans Réglages</LienAction>
                </>
              ) : null}
              {rdv.lienVisio ? (
                <a
                  href={rdv.lienVisio}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center rounded-[4px] px-1.5 text-md font-medium text-encre-2 decoration-souligne underline-offset-4 hover:text-encre hover:underline pointer-coarse:h-11"
                >
                  Ouvrir la visio
                </a>
              ) : null}
            </div>
            {rdv.email ? (
              <p className="text-encre-3">
                Invitation envoyée à <span className="font-mono">{rdv.email}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    ) : null;

  const objections = (bilan?.objections ?? []).map((o) => ({
    libelle: o.objectionId ? (listeObjections.find((x) => x.id === o.objectionId)?.libelle ?? o.libelle) : o.libelle,
    levee: o.levee,
    tempsBloquant: o.tempsBloquant,
    citation: o.citation,
    repertoriee: o.objectionId !== null,
  }));

  const hautBilan = bilan ? (
    <>
      <TitreSection>Bilan</TitreSection>
      <section className="grid gap-1.5">
        <h3 className="text-md font-semibold">Résumé</h3>
        <p className="text-base text-encre-2">{bilan.resume}</p>
      </section>
    </>
  ) : null;

  const basBilan = bilan ? (
    <>
      {bilan.pointsForts.length ? (
        <section className="grid gap-1.5">
          <h3 className="text-md font-semibold">Ce qui a marché</h3>
          <ul className="grid gap-1.5 text-base text-encre-2">
            {bilan.pointsForts.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {bilan.pointsFaibles.length ? (
        <section className="grid gap-1.5">
          <h3 className="text-md font-semibold">Ce qui a moins marché</h3>
          <ul className="grid gap-1.5 text-base text-encre-2">
            {bilan.pointsFaibles.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="grid gap-1 border-t border-filet pt-3 text-sm text-encre-3">
        <p>Chaque objection cite la phrase exacte du prospect ; un bilan qui invente une citation est refusé.</p>
        {appel.versionAnalyseur ? (
          <p>
            Analyseur <span className="font-mono">{appel.versionAnalyseur}</span>
          </p>
        ) : null}
      </div>
      {appel.statut === 'termine' ? (
        <div className="-mx-1.5">
          <BoutonRelancer
            appelId={appel.id}
            libelle="Réanalyser ce bilan"
            ton="discret"
            suivre
            statut={appel.statut}
            confirmer={{
              question: 'Remplacer ce bilan par une nouvelle analyse ?',
              texte: 'L’analyse relit la transcription et remplace l’issue, le résumé et les objections.',
              libelle: 'Réanalyser',
            }}
          />
        </div>
      ) : null}
    </>
  ) : null;

  const transcription = appel.transcription ?? [];
  const voisinsVisibles = precedent || suivant;

  return (
    <Page largeur="lecture">
      {actualisation}
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 pt-6 pb-5">
        <div className="grid min-w-0 gap-1">
          <div className="-mx-1.5 justify-self-start">
            <LienAction
              href={retour.href}
              ton="discret"
              {...(enDirect ? {} : { touche: 'Échap', raccourci: 'Escape', libelleRaccourci: `Revenir : ${retour.libelle}` })}
            >
              {retour.libelle}
            </LienAction>
          </div>
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-balance">{nomProspect}</h1>
          <p className="text-md text-encre-3">
            <Link href={`/entreprises/${entreprise.slug}`} className="decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline">
              {entreprise.nom}
            </Link>
            {' · '}
            <Link href={ficheProspect} className="decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline">
              {prospect?.societe || 'Fiche du prospect'}
            </Link>
          </p>
          <p className="flex flex-wrap gap-x-2 font-mono text-sm text-encre-3">
            {meta.map((m, i) => (
              <span key={i} className="inline-flex gap-x-2">
                {i > 0 ? <span aria-hidden="true">·</span> : null}
                {m}
              </span>
            ))}
          </p>
        </div>
        {voisinsVisibles ? (
          <nav aria-label="Appels voisins dans la liste" className="-mx-1.5 flex gap-x-4 max-sm:hidden">
            {precedent ? (
              <LienAction href={precedent} ton="discret" {...(enDirect ? {} : { touche: 'K', raccourci: 'k' })}>
                Appel précédent
              </LienAction>
            ) : null}
            {suivant ? (
              <LienAction href={suivant} ton="discret" {...(enDirect ? {} : { touche: 'J', raccourci: 'j' })}>
                Appel suivant
              </LienAction>
            ) : null}
          </nav>
        ) : null}
      </header>

      <div className="grid gap-8">
        {suiviDirect || etatDirect ? (
          <div className="grid gap-4">
            {suiviDirect}
            {etatDirect}
          </div>
        ) : null}
        {blocIssue}
        {transcription.length > 0 || bilan ? (
          <LecteurAppel
            appelId={appel.id}
            audio={Boolean(appel.audio)}
            transcription={transcription}
            objections={objections}
            nomProspect={prenom(nomProspect)}
            recherche={q}
            bilan={hautBilan}
            pied={basBilan}
            raccourcis={!enDirect}
          />
        ) : appel.statut === 'termine' ? (
          <EtatVide titre="Aucune conversation enregistrée : messagerie, pas de réponse ou appel coupé avant le décroché." />
        ) : null}
      </div>

      {voisinsVisibles ? (
        <nav aria-label="Appels voisins" className="-mx-1.5 mt-10 flex justify-between gap-x-4 border-t border-filet pt-3 sm:hidden">
          {precedent ? (
            <LienAction href={precedent} ton="discret">
              Appel précédent
            </LienAction>
          ) : (
            <span />
          )}
          {suivant ? (
            <LienAction href={suivant} ton="discret">
              Appel suivant
            </LienAction>
          ) : null}
        </nav>
      ) : null}
    </Page>
  );
}
