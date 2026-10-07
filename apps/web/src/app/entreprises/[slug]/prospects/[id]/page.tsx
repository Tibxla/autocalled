import { bilanEntier } from '@autocalled/domain';
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { ListeAppels } from '@/components/liste-appels';
import { dateCourte, etatAppel, quandRappeler, rappelEnRetard } from '@/components/format-appel';
import { Chevron, EtatVide, LienAction, LienTexte, Page, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { appels, issuesPersonnalisees, prospects, rendezVous, versionsScript } from '@/db/schema';
import { ligneBloquee } from '@/app/_accueil/situation';
import type { EtatLigneServeur } from '@/lib/accueil';
import { rafraichirSiAncien } from '@/lib/agenda';
import { preparerAppel } from '@/lib/appels';
import { appelabiliteDe } from '@/lib/appelables';
import { inventaireEffacement, phrasesEffacement } from '@/lib/effacement';
import { numeroLisible } from '@/lib/format';
import { appelIdVivant, etatLigneBorne } from '@/lib/ligne-vivante';
import { assistantePourLaPage, entrepriseParSlug, prospectParId } from '@/lib/pages';
import { rappelEnAttente } from '@/lib/rappels';
import { rappelSeraAutomatique } from '@/lib/rappels-automatiques';
import { lireReglagesRappels } from '@/lib/reglages-rappels';
import { reglagesDuPont } from '@/lib/pont';
import { versionsDeLEntreprise } from '@/lib/versions';
import { GestesProspect } from './gestes-prospect';
import { NumeroMasquable, PanneauAppel, type BlocageTelephone, type PlafondsLigne } from './panneau-appel';

export const metadata: Metadata = { title: 'Prospect' };

const JOUR_MOIS = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });

/**
 * Plafonds de la ligne téléphone et appels des dernières 24 heures, pour la confirmation d'un appel. Promesse
 * passée telle quelle au panneau : le pont peut tarder (15 s au pire), la fiche ne l'attend jamais.
 */
async function lirePlafonds(): Promise<PlafondsLigne> {
  const borne = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<null>((resoudre) => {
    minuterie = setTimeout(() => resoudre(null), 6000);
  });
  try {
    const [reglages, passes24h] = await Promise.all([
      Promise.race([reglagesDuPont(), delai]),
      // Les compositions seulement, comme le plafond du pont : un prospect qui rappelle n'y compte pas.
      db.$count(appels, and(eq(appels.ligne, 'bluetooth'), eq(appels.sens, 'sortant'), gte(appels.debutLe, borne))),
    ]);
    return { reglages, passes24h };
  } catch {
    return { reglages: null, passes24h: null };
  } finally {
    clearTimeout(minuterie);
  }
}

/**
 * Pourquoi aucun appel ne peut partir par le téléphone passerelle, ou null (ligne prête, ou trop lente à
 * répondre : le serveur garde sa propre vérification au moment d'appeler). Lecture seule, sans bloquer la fiche.
 */
async function lireBlocageTelephone(lecture: Promise<EtatLigneServeur | null>): Promise<BlocageTelephone | null> {
  const etat = await lecture;
  if (!etat) return null;
  if (etat.joignable && (etat.appelEnCours || etat.appelId)) return { texte: 'Un appel est déjà en ligne sur le téléphone.', court: 'en appel' };
  const texte = ligneBloquee(etat);
  if (!texte) return null;
  return { texte, court: !etat.joignable ? 'injoignable' : !etat.connecte ? 'déconnecté' : 'plafond atteint' };
}

/** L'heure se lit hors du rendu. */
function lireMaintenant(): Date {
  return new Date();
}

export default async function PageProspect({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const prospect = await prospectParId(entreprise.id, id);
  const { nom: nomAssistante } = await assistantePourLaPage();
  // L'agenda se relit dès l'ouverture de la fiche : il sera à jour quand l'assistante proposera des créneaux.
  await rafraichirSiAncien();
  const [verifies, partages, toutesVersions, historique, ordre, issuesPerso, inventaire] = await Promise.all([
    appelabiliteDe([prospect.telephone]),
    db.$count(prospects, and(eq(prospects.entrepriseId, entreprise.id), eq(prospects.telephone, prospect.telephone))),
    versionsDeLEntreprise(entreprise.id),
    db
      .select()
      .from(appels)
      .where(and(eq(appels.entrepriseId, entreprise.id), eq(appels.prospectId, prospect.id)))
      .orderBy(desc(appels.debutLe)),
    // L'ordre de la liste : les archivés n'y sont pas, sauf celui qu'on regarde.
    db
      .select({ id: prospects.id })
      .from(prospects)
      .where(and(eq(prospects.entrepriseId, entreprise.id), or(isNull(prospects.archiveLe), eq(prospects.id, prospect.id))))
      .orderBy(asc(prospects.nom), asc(prospects.id)),
    db
      .select({ id: issuesPersonnalisees.id, libelle: issuesPersonnalisees.libelle })
      .from(issuesPersonnalisees)
      .where(eq(issuesPersonnalisees.entrepriseId, entreprise.id)),
    // Ce qu'un effacement supprimerait, pour la confirmation en ligne.
    inventaireEffacement(entreprise.id, prospect.id),
  ]);
  // Les scripts archivés ne sont plus proposés au lancement.
  const versions = toutesVersions.filter((v) => !v.scriptArchive);
  const verification = verifies.get(prospect.telephone);
  const appelable = Boolean(verification?.appelable);
  const lisible = numeroLisible(prospect.telephone);
  const base = `/entreprises/${slug}/prospects`;

  // Ce que l'assistante recevra au début de l'appel (lecture seule, avec la première version proposée).
  const preparation = appelable && !prospect.archiveLe && versions[0] ? await preparerAppel(entreprise.id, prospect.id, versions[0].id) : null;

  // Précédent et suivant, dans l'ordre alphabétique de la liste.
  const rang = ordre.findIndex((p) => p.id === prospect.id);
  const precedent = rang > 0 ? ordre[rang - 1] : undefined;
  const suivant = rang >= 0 ? ordre[rang + 1] : undefined;

  // Dernier appel et rappel à faire (CONTEXT.md : la fiche affiche le rappel convenu).
  const dernier = historique[0];
  const libellePerso = new Map(issuesPerso.map((i) => [`perso:${i.id}`, i.libelle]));

  // Historique : nombre d'étapes de chaque version (hauteur du trait) et appels qui ont posé un rendez-vous.
  const idsVersions = [...new Set(historique.map((a) => a.versionScriptId))];
  const [etapesVersions, rdvHistorique] = historique.length
    ? await Promise.all([
        db
          .select({ id: versionsScript.id, nombre: sql<number>`jsonb_array_length(${versionsScript.etapes})` })
          .from(versionsScript)
          .where(inArray(versionsScript.id, idsVersions)),
        db
          .select({ appelId: rendezVous.appelId })
          .from(rendezVous)
          .where(
            inArray(
              rendezVous.appelId,
              historique.map((a) => a.id),
            ),
          ),
      ])
    : [[], []];
  const nombreEtapes = new Map(etapesVersions.map((e) => [e.id, Number(e.nombre)]));
  const avecRendezVous = new Set(rdvHistorique.map((r) => r.appelId));
  // Une seule lecture de la ligne : l'appel vivant (attendu seulement si un appel téléphone est encore « en cours » en
  // base) et le blocage du panneau d'appel (jamais attendu).
  const lectureLigne = etatLigneBorne();
  const vivantId = historique.some((a) => a.statut === 'en-cours' && a.ligne === 'bluetooth') ? appelIdVivant(await lectureLigne) : null;
  const maintenant = lireMaintenant();
  const etatDernier = dernier
    ? etatAppel(dernier, { vivant: dernier.id === vivantId, libellePerso: dernier.issue ? libellePerso.get(dernier.issue) : null, maintenant })
    : null;
  // Le rappel à faire : le dernier appel hors simulation a fini en rappel convenu (un appel plus récent le fait).
  const rappel = rappelEnAttente(historique);
  const retard = rappel?.rappelLe ? rappelEnRetard(rappel.rappelLe, rappel.quand, maintenant) : false;
  const rappelAutomatique = rappel ? rappelSeraAutomatique({ ligne: historique.find((a) => a.id === rappel.appelId)?.ligne ?? 'simulation', rappelLe: rappel.rappelLe }, (await lireReglagesRappels()).valeur) : false;

  let blocage: { texte: string; lien?: { href: string; libelle: string } } | null = null;
  if (prospect.archiveLe) {
    blocage = { texte: 'Prospect archivé : il n’est plus appelé. Réactive-le pour l’appeler.' };
  } else if (!appelable) {
    const raison = verification && !verification.appelable ? verification.raison : 'numero-invalide';
    blocage =
      raison === 'numero-efface'
        ? { texte: 'Numéro d’une personne effacée à sa demande : il ne sera plus jamais composé.' }
        : raison === 'opposition-illisible'
          ? { texte: 'La liste d’opposition ne se lit plus (SEL_OPPOSITION manque ou a changé dans le .env) : aucun numéro n’est composé.' }
          : { texte: 'Numéro invalide : corrige-le dans la fiche.', lien: { href: `${base}/${prospect.id}/modifier`, libelle: 'Modifier la fiche' } };
  } else if (versions.length === 0) {
    blocage = {
      texte: toutesVersions.length > 0 ? 'Tous les scripts sont archivés : réactives-en un ou crées-en un dans Scripts.' : 'Aucun script : crées-en un dans Scripts.',
      lien: { href: `/entreprises/${slug}/scripts`, libelle: 'Ouvrir les scripts' },
    };
  }

  // Sous 1024 px, une seule colonne dans l'ordre du geste : l'identité, l'appel, le numéro, l'historique, puis les
  // gestes qui retirent (Archiver, Effacer). Dès 1024 px, l'encart de droite garde le numéro au-dessus de
  // l'appel et les gestes dessous. Sous 640 px, Précédent et Suivant passent en bas de la fiche.
  return (
    <Page largeur="lecture">
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6">
        <div className="grid gap-1 pb-8 max-sm:pb-6">
          <LienTexte isole href={base} className="justify-self-start text-sm text-encre-3 hover:text-encre-2">
            Prospects
          </LienTexte>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">{prospect.nom}</h2>
            <LienAction ton="discret" href={`${base}/${prospect.id}/modifier`}>Modifier la fiche</LienAction>
          </div>
          {prospect.role || prospect.societe ? <p className="text-md text-encre-2">{[prospect.role, prospect.societe].filter(Boolean).join(', ')}</p> : null}
          {prospect.archiveLe ? (
            <p className="max-w-[68ch] pt-1 text-sm text-encre-2">
              Archivé le <span className="font-mono">{JOUR_MOIS.format(prospect.archiveLe)}</span> : plus proposé pour un appel ni une campagne. Ses appels
              et ses bilans restent.
            </p>
          ) : null}
          {dernier && etatDernier ? (
            <p className="flex flex-wrap gap-x-4 gap-y-0.5 pt-1 text-sm text-encre-3">
              {/* Le rappel d'abord : c'est ce qui reste à faire. */}
              {rappel ? (
                <span className="text-encre">
                  {rappel.rappelLe ? (
                    <>
                      {retard ? <span className="text-alerte">{rappelAutomatique ? 'Rappel automatique en attente' : 'Rappel en retard'}</span> : rappelAutomatique ? 'Rappel automatique prévu' : 'Prochain rappel'} :{' '}
                      {quandRappeler(rappel.rappelLe, rappel.quand, maintenant)}
                    </>
                  ) : (
                    'Rappel convenu'
                  )}
                  {rappel.texte ? <span className="text-encre-3"> · « {rappel.texte} »</span> : rappel.rappelLe ? null : ' : moment non précisé'}
                </span>
              ) : null}
              <LienTexte href={`/appels/${dernier.id}?depuis=${encodeURIComponent(`${base}/${prospect.id}`)}`} className="hover:text-encre-2 sm:-order-1">
                Dernier appel le <span className="font-mono">{dateCourte(dernier.debutLe).split(' ')[0]}</span> :{' '}
                <span className={etatDernier.cle === 'en-cours' && dernier.id === vivantId ? 'text-antenne' : undefined}>{etatDernier.libelle}</span>
              </LienTexte>
            </p>
          ) : (
            <p className="pt-1 text-sm text-encre-3">Jamais appelé.</p>
          )}
        </div>
        {precedent || suivant ? (
          <nav aria-label="Autres prospects" className="self-start max-sm:order-last max-sm:mt-10 max-sm:border-t max-sm:border-filet max-sm:pt-2">
            <div className="-mx-1.5 flex gap-x-3 max-sm:justify-between">
              {precedent ? (
                <LienAction ton="discret" touche="K" raccourci="k" libelleRaccourci="Prospect précédent" href={`${base}/${precedent.id}`}>
                  Précédent
                </LienAction>
              ) : (
                <span className="sm:hidden" />
              )}
              {suivant ? (
                <LienAction ton="discret" touche="J" raccourci="j" libelleRaccourci="Prospect suivant" href={`${base}/${suivant.id}`}>
                  Suivant
                </LienAction>
              ) : null}
            </div>
          </nav>
        ) : null}

        <div className="grid grid-cols-1 gap-12 sm:col-span-2 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:gap-y-6">
          <div className="grid min-w-0 grid-cols-1 content-start gap-10 max-lg:order-2 lg:row-span-2">
            <section aria-labelledby="titre-sait" className="grid gap-4">
              <TitreSection id="titre-sait">Ce que {nomAssistante} sait</TitreSection>
              <p className="max-w-[68ch] text-base whitespace-pre-line">{prospect.contexte || 'Pas de contexte dans la fiche.'}</p>
              <p className="text-sm text-encre-3">
                Fiche <span className="font-mono">{prospect.id}.md</span>, mise à jour le{' '}
                <span className="font-mono">{dateCourte(prospect.majLe)}</span>.
              </p>
              {preparation?.ok ? (
                <details className="group max-w-[68ch]">
                  <summary className="-mx-1.5 inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-[4px] px-1.5 text-md text-encre-2 hover:text-encre pointer-coarse:h-11 pointer-coarse:active:bg-survol [&::-webkit-details-marker]:hidden">
                    <Chevron className="stroke-encre-3 group-open:rotate-90" />
                    <span className="decoration-souligne underline-offset-4 group-hover:underline pointer-coarse:underline">Ce que {nomAssistante} saura en appelant</span>
                  </summary>
                  <dl className="grid gap-3 rounded-md bg-surface px-3.5 py-3 text-sm">
                    <div className="grid gap-0.5">
                      <dt className="font-medium text-encre">Appels précédents</dt>
                      <dd className="whitespace-pre-line text-encre-2">{preparation.variables.historique_appels}</dd>
                    </div>
                    <div className="grid gap-0.5">
                      <dt className="font-medium text-encre">Rendez-vous à proposer</dt>
                      <dd className="text-encre-2">{preparation.variables.rendez_vous}</dd>
                    </div>
                    <div className="grid gap-0.5">
                      <dt className="font-medium text-encre">E-mail pour l’invitation</dt>
                      <dd className="font-mono break-all text-encre-2">{preparation.variables.prospect_email}</dd>
                    </div>
                  </dl>
                </details>
              ) : null}
            </section>

            <section aria-labelledby="titre-appels" className="grid min-w-0 grid-cols-1">
              <TitreSection id="titre-appels" compte={historique.length}>
                Appels
              </TitreSection>
              {historique.length === 0 ? (
                <EtatVide titre="Aucun appel pour l’instant.">
                  Chaque appel s’affichera ici avec son issue et son bilan ; {nomAssistante} s’en souviendra au prochain appel.
                </EtatVide>
              ) : (
                <ListeAppels
                  depuis={`${base}/${prospect.id}`}
                  vivantId={vivantId}
                  appels={historique.map((a) => {
                    const cleIssue = a.issue ?? a.bilan?.issue ?? null;
                    return {
                      ...a,
                      resume: bilanEntier(a.bilan)?.resume ?? null,
                      nombreEtapes: nombreEtapes.get(a.versionScriptId) ?? null,
                      rendezVous: avecRendezVous.has(a.id),
                      libellePerso: cleIssue ? (libellePerso.get(cleIssue) ?? null) : null,
                    };
                  })}
                />
              )}
            </section>
          </div>

          <aside aria-label="Numéro et appel" className="grid content-start gap-6 max-lg:order-1 lg:col-start-2 lg:row-start-1">
            <div className="grid gap-2.5 border-t border-filet pt-4 max-lg:order-last">
              <NumeroMasquable lisible={lisible} />
              {prospect.email ? <p className="font-mono text-sm break-all text-encre-2">{prospect.email}</p> : null}
              {partages > 1 ? (
                <p className="text-sm text-encre-3">
                  Numéro partagé par <span className="font-mono">{partages}</span> prospects.
                </p>
              ) : null}
            </div>
            <PanneauAppel
              entrepriseId={entreprise.id}
              prospectId={prospect.id}
              prospectNom={prospect.nom}
              versions={versions.map((v) => ({ id: v.id, libelle: v.libelle }))}
              appelable={appelable}
              numero={lisible}
              blocage={blocage}
              plafonds={lirePlafonds()}
              telephoneBloque={lireBlocageTelephone(lectureLigne)}
            />
          </aside>

          {/* Les gestes qui retirent : en dernier sous 1024 px, sous l'encart dès 1024 px. */}
          <div className="grid content-start gap-6 max-lg:order-3 lg:col-start-2 lg:row-start-2">
            {inventaire ? (
              <GestesProspect
                entrepriseId={entreprise.id}
                prospectId={prospect.id}
                nom={prospect.nom}
                archive={Boolean(prospect.archiveLe)}
                effacement={{ ...phrasesEffacement(inventaire, undefined, { numeroInsecable: true }), obstacle: inventaire.obstacle }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </Page>
  );
}
