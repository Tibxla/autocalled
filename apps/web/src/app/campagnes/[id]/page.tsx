import { finDemandee, ISSUES_SYSTEME, LIBELLES_ISSUES, type IssueSysteme, type OrigineGeste, traceDeFin } from '@autocalled/domain';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  comptesCampagne,
  dateCourte,
  duree,
  etatAppel,
  heure,
  numeroMasque,
  parQui,
  prochaineEntreeDue,
  prochaineTentative,
  quandRappeler,
  quandTentative,
  STATUTS_CAMPAGNE,
} from '@/components/format-appel';
import { refusDe } from '@/components/refus-numero';
import { EnTetePage, GlypheEtape, LienAction, Page, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { appels, campagnes, entreprises, issuesPersonnalisees, prospects, versionsScript } from '@/db/schema';
import { rafraichirSiAncien } from '@/lib/agenda';
import { appelabiliteDe } from '@/lib/appelables';
import { numeroLisible } from '@/lib/format';
import { commanderPont } from '@/lib/pont';
import { versionsDeLEntreprise } from '@/lib/versions';
import { SectionFile, type ProspectAjoutable } from './ajout-prospects';
import { File, type EntreeFile } from './file';
import type { ProspectRecapitulatif } from './recapitulatif';
import { Regie, type EtatPont, type RaisonSuspension } from './regie';
import { SuppressionCampagne } from './suppression-campagne';

export const metadata: Metadata = { title: 'Campagne' };

/** Ce que la ligne d'une campagne veut dire, en toutes lettres (sous-titre de la page). */
const PHRASES_LIGNE: Record<string, string> = {
  bluetooth: 'Téléphone passerelle : vrais numéros',
  navigateur: 'Ligne navigateur : tu joues chaque prospect',
  simulation: 'Appel simulé : un modèle joue chaque prospect',
  twilio: 'Téléphone (Twilio)',
};

/** L'antenne est réservée à ce qui vit : « En cours » ne la prend que si un appel de la campagne est en ligne. */
const TON_STATUT = { prete: 'text-encre-2', 'en-cours': 'text-encre', 'en-pause': 'text-encre-2', terminee: 'text-encre-3' } as const;

/** Borne des « dernières 24 heures » (hors composant : l'heure se lit ici, jamais pendant un rendu). */
function ilYA24Heures(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

/** L'instant du rendu, lu hors composant : ce qui est dû dans la file, et « demain » ou « aujourd'hui ». */
function maintenant(): Date {
  return new Date();
}

/** Le prospect de l'appel que porte la ligne quand ce n'est pas celui de la campagne (un prospect qui rappelle). */
async function appelDeLaLigne(appelId: string): Promise<{ id: string; prospect: string | null; entrant: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(appelId)) return null;
  const [a] = await db
    .select({ id: appels.id, sens: appels.sens, prospect: prospects.nom })
    .from(appels)
    .leftJoin(prospects, and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId)))
    .where(eq(appels.id, appelId));
  return a ? { id: a.id, prospect: a.prospect, entrant: a.sens === 'entrant' } : null;
}

/**
 * L'état du pont pour la régie téléphone. Le pont peut mettre 15 s à ne pas répondre : au-delà de 4 s, la
 * page n'attend plus et dit qu'elle ne sait pas, plutôt que de bloquer le rafraîchissement de la régie.
 */
async function lirePont(): Promise<EtatPont> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<null>((resoudre) => {
    minuterie = setTimeout(() => resoudre(null), 4000);
  });
  const reponse = await Promise.race([commanderPont('/etat'), delai]);
  clearTimeout(minuterie);
  const libre = { occupee: false, appelId: null, entrant: false };
  if (!reponse) return { etat: 'inconnu', plafond: null, reglages: null, ...libre };
  if (!reponse.ok) return { etat: 'injoignable', plafond: null, reglages: null, ...libre };
  const corps = reponse.corps as {
    connecte?: boolean;
    plafond?: unknown;
    reglages?: EtatPont['reglages'];
    appelEnCours?: unknown;
    appelId?: unknown;
    entrantEnCours?: unknown;
    sens?: unknown;
  };
  const appelId = typeof corps.appelId === 'string' ? corps.appelId : null;
  return {
    etat: corps.connecte ? 'joignable' : 'deconnecte',
    plafond: typeof corps.plafond === 'string' ? corps.plafond : null,
    reglages: corps.reglages ?? null,
    occupee: Boolean(corps.appelEnCours) || Boolean(corps.entrantEnCours) || appelId !== null,
    appelId,
    // Un numéro inconnu qui sonne (sans appel suivi) est aussi un entrant : la ligne est prise, personne ne décroche.
    entrant: corps.sens === 'entrant' || (appelId === null && Boolean(corps.entrantEnCours)),
  };
}

/** La raison d'une suspension, déduite de ce qu'on sait ; jamais inventée (la base ne la garde pas). */
function raisonSuspension(p: { enAppel: boolean; dernierEchec: string | null; pont: EtatPont | null }): RaisonSuspension {
  if (p.enAppel) return { texte: 'Suspendue : l’appel en cours va à son terme, aucun autre ne part.', ton: 'neutre' };
  if (p.dernierEchec) return { texte: `Suspendue après un échec : ${p.dernierEchec}`, ton: 'alerte' };
  if (p.pont?.plafond) return { texte: p.pont.plafond, ton: 'alerte' };
  if (p.pont?.etat === 'injoignable')
    return { texte: 'Ligne injoignable : le service du téléphone passerelle ne répond pas.', ton: 'alerte', lienTelephone: true };
  if (p.pont?.etat === 'deconnecte')
    return { texte: 'Téléphone passerelle déconnecté : hors de portée ou Bluetooth coupé.', ton: 'alerte', lienTelephone: true };
  return { texte: 'Suspendue : aucun appel ne part avant la reprise.', ton: 'neutre' };
}

export default async function PageCampagne({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ file?: string | string[] }>;
}) {
  const [{ id }, { file: filtreFile }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [campagne] = await db.select().from(campagnes).where(eq(campagnes.id, id));
  if (!campagne) notFound();
  // L'agenda se relit avant les appels : il sera à jour quand Mina proposera des créneaux.
  if (campagne.statut !== 'terminee') await rafraichirSiAncien();

  const telephone = campagne.ligne === 'bluetooth';
  const suivreLePont = telephone && campagne.statut !== 'terminee';
  const [[entreprise], listeProspects, listeAppels, versions, [version], issuesPerso, pont, passes24h] = await Promise.all([
    db.select().from(entreprises).where(eq(entreprises.id, campagne.entrepriseId)),
    db
      .select({ id: prospects.id, nom: prospects.nom, societe: prospects.societe, telephone: prospects.telephone, archiveLe: prospects.archiveLe })
      .from(prospects)
      .where(eq(prospects.entrepriseId, campagne.entrepriseId)),
    db
      .select({
        id: appels.id,
        prospectId: appels.prospectId,
        ligne: appels.ligne,
        numero: appels.numero,
        statut: appels.statut,
        issue: appels.issue,
        issueSysteme: appels.issueSysteme,
        erreur: appels.erreur,
        conversationId: appels.conversationId,
        debutLe: appels.debutLe,
        finLe: appels.finLe,
        dureeSecondes: appels.dureeSecondes,
        bilan: appels.bilan,
      })
      .from(appels)
      .where(eq(appels.campagneId, campagne.id)),
    versionsDeLEntreprise(campagne.entrepriseId),
    db.select({ etapes: versionsScript.etapes }).from(versionsScript).where(eq(versionsScript.id, campagne.versionScriptId)),
    db
      .select({ id: issuesPersonnalisees.id, libelle: issuesPersonnalisees.libelle })
      .from(issuesPersonnalisees)
      .where(eq(issuesPersonnalisees.entrepriseId, campagne.entrepriseId)),
    suivreLePont ? lirePont() : Promise.resolve(null),
    // Les compositions seulement, comme le plafond du pont : un prospect qui rappelle n'y compte pas.
    suivreLePont
      ? db.$count(appels, and(eq(appels.ligne, 'bluetooth'), eq(appels.sens, 'sortant'), gte(appels.debutLe, ilYA24Heures())))
      : Promise.resolve(null),
  ]);
  if (!entreprise) notFound();

  const prospectDe = new Map(listeProspects.map((p) => [p.id, p]));
  const appelDe = new Map(listeAppels.map((a) => [a.id, a]));
  const libellePerso = new Map(issuesPerso.map((i) => [`perso:${i.id}`, i.libelle]));
  const libelleVersion = versions.find((v) => v.id === campagne.versionScriptId)?.libelle ?? 'Version supprimée';
  const nombreEtapes = version?.etapes.length ?? null;
  const comptes = comptesCampagne(campagne.entrees);
  const seTermine = finDemandee(campagne);
  const instant = maintenant();
  const ouvert = campagne.entrees.find((e) => e.etat === 'en-appel');
  // Le prochain appelé est le premier DÛ : une nouvelle tentative attend son heure à sa place dans la file.
  const prochaineEntree = prochaineEntreeDue(campagne.entrees, instant);
  const prochainProspect = prochaineEntree ? prospectDe.get(prochaineEntree.prospectId) : undefined;
  const prochain = prochaineEntree
    ? {
        id: prochaineEntree.prospectId,
        nom: prochainProspect?.nom ?? prochaineEntree.prospectId,
        societe: prochainProspect?.societe ?? null,
        tentative: prochaineEntree.tentative ?? 1,
      }
    : null;
  const tentativeAVenir = prochaineTentative(campagne.entrees, instant);
  const attente = tentativeAVenir ? { quand: quandTentative(tentativeAVenir.le, instant), nombre: tentativeAVenir.nombre } : null;

  // Appel téléphone de la campagne encore ouvert : la bande le suit (en cours, puis rapatriement).
  const appelOuvert = ouvert?.etat === 'en-appel' ? appelDe.get(ouvert.appelId) : undefined;
  const prospectOuvert = appelOuvert ? prospectDe.get(appelOuvert.prospectId) : undefined;
  const appelTelephone =
    telephone && appelOuvert && (appelOuvert.statut === 'en-cours' || appelOuvert.statut === 'traitement')
      ? {
          id: appelOuvert.id,
          statut: appelOuvert.statut,
          debutLe: appelOuvert.debutLe.toISOString(),
          finLe: appelOuvert.finLe?.toISOString() ?? null,
          conversation: Boolean(appelOuvert.conversationId),
          identite: {
            prospect: prospectOuvert?.nom ?? appelOuvert.prospectId,
            societe: prospectOuvert?.societe ?? null,
            entreprise: entreprise.nom,
            version: libelleVersion,
            numeroMasque: numeroMasque(numeroLisible(appelOuvert.numero)),
            lien: `/appels/${appelOuvert.id}?depuis=${encodeURIComponent(`/campagnes/${campagne.id}`)}`,
          },
        }
      : null;

  // La ligne prise par un autre appel que celui de la file (un prospect qui rappelle, un appel lancé d'une fiche) :
  // la campagne attend qu'il finisse, rien ne part.
  // Sans appel suivi (un numéro inconnu qui sonne), la ligne est prise aussi ; jamais par l'appel de la campagne lui-même.
  const ouvertId = ouvert?.etat === 'en-appel' ? ouvert.appelId : null;
  const ligneAutreAppel = pont && pont.occupee && !appelTelephone && (pont.appelId === null || pont.appelId !== ouvertId) ? pont : null;
  const autre = ligneAutreAppel?.appelId ? await appelDeLaLigne(ligneAutreAppel.appelId) : null;
  const ligneOccupee = ligneAutreAppel
    ? {
        entrant: ligneAutreAppel.entrant || Boolean(autre?.entrant),
        prospect: autre?.prospect ?? null,
        lien: autre ? `/appels/${autre.id}?depuis=${encodeURIComponent(`/campagnes/${campagne.id}`)}` : null,
      }
    : null;

  // Dernier appel de la campagne, pour dire pourquoi elle s'est arrêtée s'il n'est pas parti.
  const dernier = [...listeAppels].sort((a, b) => b.debutLe.getTime() - a.debutLe.getTime())[0];
  const dernierEchec = dernier?.statut === 'echec' && !dernier.conversationId ? (dernier.erreur ?? 'l’appel n’est pas parti.') : null;

  // Prête : les numéros relus maintenant, pour le récapitulatif qui sert de confirmation.
  let recapitulatif: { prospects: ProspectRecapitulatif[]; appelables: number } | null = null;
  if (campagne.statut === 'prete') {
    const aAppeler = campagne.entrees.filter((e) => e.etat === 'a-appeler');
    const verifies = await appelabiliteDe(aAppeler.flatMap((e) => prospectDe.get(e.prospectId)?.telephone ?? []));
    const lignes = aAppeler.map((e, i) => {
      const p = prospectDe.get(e.prospectId);
      return {
        rang: i + 1,
        id: e.prospectId,
        nom: p?.nom ?? e.prospectId,
        societe: p?.societe ?? null,
        numero: p ? numeroMasque(numeroLisible(p.telephone)) : '',
        refus: refusDe(p ? verifies.get(p.telephone) : undefined),
      };
    });
    recapitulatif = { prospects: lignes, appelables: lignes.filter((l) => l.refus === null).length };
  }

  const entreesFile: EntreeFile[] = campagne.entrees.map((e, i) => {
    const p = prospectDe.get(e.prospectId);
    const precedents = (('appelsPrecedents' in e ? e.appelsPrecedents : undefined) ?? []).flatMap((id) => appelDe.get(id) ?? []);
    // L'appel montré par la ligne : celui de l'entrée, sinon la dernière tentative passée (tentative prévue, retrait).
    const a = 'appelId' in e ? appelDe.get(e.appelId) : precedents.at(-1);
    const tentative = e.etat === 'sautee' || e.etat === 'retiree' ? precedents.length : (e.tentative ?? 1);
    const pasAvant = e.etat === 'a-appeler' && e.pasAvant && Date.parse(e.pasAvant) > instant.getTime() ? e.pasAvant : null;
    return {
      rang: i + 1,
      prospectId: e.prospectId,
      nom: p?.nom ?? e.prospectId,
      societe: p?.societe ?? null,
      etat: e.etat,
      suivant: e.prospectId === prochain?.id && campagne.statut !== 'terminee',
      sauts: e.etat === 'a-appeler' ? (e.sauts ?? 0) : 0,
      retrait: e.etat === 'retiree' ? { motif: e.motif, le: e.le, par: e.par } : null,
      tentative,
      prevue: pasAvant ? { jour: quandRappeler(pasAvant, { heure: null, moment: null }, instant), heure: heure(pasAvant) } : null,
      // Les appels passés, le dernier compris quand il porte la ligne, dans l'ordre : un lien chacun.
      tentatives: [...precedents, ...(a && !precedents.includes(a) ? [a] : [])].map((t, rang) => ({
        id: t.id,
        rang: rang + 1,
        libelle: `${dateCourte(t.debutLe).replace(' ', ' à ')} · ${etatAppel(t, { libellePerso: t.issue ? libellePerso.get(t.issue) : null }).libelle}`,
      })),
      appel: a
        ? {
            id: a.id,
            ligne: a.ligne,
            statut: a.statut,
            issue: a.issue,
            issueSysteme: a.issueSysteme,
            erreur: a.erreur,
            conversation: Boolean(a.conversationId),
            debutLe: a.debutLe.toISOString(),
            dureeSecondes: a.dureeSecondes,
            etape: a.bilan?.etapeAtteinte ?? null,
            libellePerso: a.issue ? (libellePerso.get(a.issue) ?? null) : null,
          }
        : null,
    };
  });

  // Ajouter des prospects : ceux de l'entreprise au numéro appelable et absents de la file, avec leur dernier appel.
  let ajoutables: ProspectAjoutable[] | null = null;
  let blocageAjout: string | null = null;
  if (campagne.statut !== 'terminee') {
    const dansLaFile = new Set(campagne.entrees.map((e) => e.prospectId));
    // Un prospect archivé n'est jamais proposé.
    const candidats = listeProspects.filter((p) => !dansLaFile.has(p.id) && !p.archiveLe).sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || a.id.localeCompare(b.id));
    const [verifies, derniers] = await Promise.all([
      appelabiliteDe(candidats.map((p) => p.telephone)),
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
        .where(eq(appels.entrepriseId, campagne.entrepriseId))
        .orderBy(appels.prospectId, desc(appels.debutLe)),
    ]);
    const dernierDe = new Map(derniers.map((d) => [d.prospectId, d]));
    ajoutables = candidats
      .filter((p) => verifies.get(p.telephone)?.appelable)
      .map((p) => {
        const d = dernierDe.get(p.id);
        return {
          id: p.id,
          nom: p.nom,
          societe: p.societe,
          derniere: d ? { cle: d.issueSysteme, libelle: etatAppel(d, { libellePerso: d.issue ? libellePerso.get(d.issue) : null }).libelle } : null,
        };
      });
    const scriptArchive = versions.find((v) => v.id === campagne.versionScriptId)?.scriptArchive ?? false;
    blocageAjout = seTermine
      ? 'La campagne se termine à la fin de l’appel en cours : plus rien ne s’y ajoute.'
      : scriptArchive
        ? 'Le script de cette campagne est archivé : réactive-le dans Scripts pour y ajouter des prospects, ou lance une nouvelle campagne.'
        : null;
  }

  return (
    <Page largeur="pleine">
      <EnTetePage
        titre={`Campagne du ${dateCourte(campagne.creeLe).replace(' ', ' · ')}`}
        sousTitre={`${libelleVersion} · ${PHRASES_LIGNE[campagne.ligne] ?? campagne.ligne}`}
        retour={{ href: `/entreprises/${entreprise.slug}/campagnes`, libelle: `${entreprise.nom} · Campagnes` }}
        action={
          <p className="flex items-baseline gap-3 text-md">
            {/* Terminée : dite discrètement, comme dans la liste des campagnes, pour que le compte ne reste pas seul. */}
            {campagne.statut === 'terminee' ? (
              <span className="text-encre-3">{STATUTS_CAMPAGNE.terminee}</span>
            ) : (
              <span className={`font-medium ${campagne.statut === 'en-cours' && comptes.enAppel > 0 ? 'text-antenne' : TON_STATUT[campagne.statut]}`}>
                {STATUTS_CAMPAGNE[campagne.statut]}
              </span>
            )}
            <span className="font-mono text-encre-3">
              <span aria-hidden="true">
                {comptes.traites}/{comptes.total}
              </span>
              <span className="sr-only">
                {comptes.traites} traités sur {comptes.total}
              </span>
            </span>
          </p>
        }
      />

      <div className="grid grid-cols-1 gap-10">
        <Regie
          campagneId={campagne.id}
          statut={campagne.statut}
          ligne={campagne.ligne}
          entrepriseId={campagne.entrepriseId}
          entreprise={{ nom: entreprise.nom, slug: entreprise.slug }}
          versionScriptId={campagne.versionScriptId}
          version={libelleVersion}
          etapes={version?.etapes.map((e) => e.intention) ?? []}
          prochain={prochain}
          attente={attente}
          enAnalyse={comptes.enAnalyse}
          aRetenter={comptes.aRetenter}
          ligneOccupee={ligneOccupee}
          restants={comptes.aAppeler}
          enAppel={comptes.enAppel > 0}
          appelOuvertNavigateur={campagne.ligne === 'navigateur' && ouvert?.etat === 'en-appel' ? ouvert.appelId : null}
          appelTelephone={appelTelephone}
          pont={pont}
          passes24h={passes24h}
          raison={campagne.statut === 'en-pause' ? raisonSuspension({ enAppel: comptes.enAppel > 0, dernierEchec, pont }) : null}
          recapitulatif={recapitulatif}
          seTermine={seTermine}
        />

        {campagne.statut === 'prete' && listeAppels.length === 0 ? <SuppressionCampagne campagneId={campagne.id} entrepriseSlug={entreprise.slug} /> : null}

        {campagne.statut === 'terminee' ? (
          <BilanCampagne
            appels={listeAppels}
            sautes={comptes.sautees}
            retires={comptes.retirees}
            finAnticipee={finAnticipee(campagne.entrees)}
            nombreEtapes={nombreEtapes}
            // Dans l'ordre d'appel : les nouvelles tentatives d'un prospect tombent à leur heure, pas à sa place dans la file.
            ordre={[...listeAppels].sort((x, y) => x.debutLe.getTime() - y.debutLe.getTime()).map((x) => x.id)}
            slug={entreprise.slug}
            simulee={campagne.ligne === 'simulation'}
          />
        ) : null}

        <SectionFile campagneId={campagne.id} compte={comptes.total} ajoutables={ajoutables} blocage={blocageAjout}>
          <File
            entrees={entreesFile}
            nombreEtapes={nombreEtapes}
            slug={entreprise.slug}
            campagneId={campagne.id}
            filtreInitial={typeof filtreFile === 'string' ? filtreFile : undefined}
            gestes={campagne.statut !== 'terminee' && !seTermine}
            terminee={campagne.statut === 'terminee'}
          />
        </SectionFile>
      </div>
    </Page>
  );
}

/** Quand et par où la campagne a été terminée avant la fin : la trace des entrées retirées, ou celle de l'appel qui était en ligne. */
function finAnticipee(entrees: typeof campagnes.$inferSelect.entrees): { le: string; par: OrigineGeste } | null {
  return traceDeFin({ entrees });
}

/** Ce qu'a donné une campagne terminée, calculé sur la page à partir de ses appels. */
function BilanCampagne({
  appels: liste,
  sautes,
  retires,
  finAnticipee: fin,
  nombreEtapes,
  ordre,
  slug,
  simulee,
}: {
  appels: {
    id: string;
    prospectId: string;
    statut: string;
    issue: string | null;
    issueSysteme: IssueSysteme | null;
    dureeSecondes: number | null;
    bilan: { etapeAtteinte: number } | null;
  }[];
  sautes: number;
  retires: number;
  finAnticipee: { le: string; par: OrigineGeste } | null;
  nombreEtapes: number | null;
  ordre: string[];
  slug: string;
  simulee: boolean;
}) {
  const parIssue = new Map<IssueSysteme, number>();
  let sansIssue = 0;
  for (const a of liste) {
    const issue = a.issueSysteme;
    if (issue) parIssue.set(issue, (parIssue.get(issue) ?? 0) + 1);
    else sansIssue += 1;
  }
  const rendezVous = parIssue.get('rendez-vous-pris') ?? 0;
  // Un appel abouti est une conversation : les non aboutis ne disent rien du script.
  const aboutis = liste.filter((a) => {
    const issue = a.issueSysteme;
    return issue !== null && issue !== 'non-abouti';
  }).length;
  const secondes = liste.reduce((s, a) => s + (a.dureeSecondes ?? 0), 0);
  const appelDe = new Map(liste.map((a) => [a.id, a]));
  const piste = ordre.map((id) => appelDe.get(id)).filter((a) => a !== undefined);
  const mot = simulee ? 'appels simulés' : 'appels';
  // Un prospect sans réponse est rappelé : ses appels de plus sont des nouvelles tentatives, pas d'autres prospects.
  const retentes = liste.length - new Set(liste.map((a) => a.prospectId)).size;
  const dontRetentes = retentes > 0 ? `, dont ${retentes} nouvelle${retentes > 1 ? 's' : ''} tentative${retentes > 1 ? 's' : ''}` : '';

  let phrase: string;
  if (liste.length === 0) {
    phrase =
      sautes > 0
        ? `Aucun appel passé : ${sautes} prospect${sautes > 1 ? 's' : ''} non appelé${sautes > 1 ? 's' : ''}, numéro invalide ou effacé.`
        : retires > 0
          ? `Aucun appel passé : ${retires} prospect${retires > 1 ? 's' : ''} retiré${retires > 1 ? 's' : ''} de la file.`
          : 'Aucun appel passé.';
  } else if (aboutis === 0) {
    phrase = `Aucun appel abouti sur ${liste.length} ${mot}${dontRetentes}.`;
  } else {
    const taux = aboutis >= 10 ? ` · ${Math.round((rendezVous / aboutis) * 100)}\u00a0%` : '';
    phrase = `${rendezVous} rendez-vous sur ${aboutis} ${mot} aboutis${taux}`;
  }

  return (
    <section aria-labelledby="titre-bilan" className="grid gap-4">
      <TitreSection
        id="titre-bilan"
        action={
          <LienAction href={`/entreprises/${slug}/analyse`} aria-label="Voir l’analyse de l’entreprise">
            <span className="sm:hidden">Voir l’analyse</span>
            <span className="max-sm:hidden">Voir l’analyse de l’entreprise</span>
          </LienAction>
        }
      >
        Campagne terminée
      </TitreSection>
      <div className="grid gap-1">
        <p className="text-lg font-medium">{phrase}</p>
        {fin ? (
          <p className="text-sm text-encre-3">
            Terminée avant la fin le <span className="font-mono">{dateCourte(fin.le).replace(' ', ' à ')}</span>
            {parQui(fin.par)} : les prospects restants n’ont pas été appelés.
          </p>
        ) : null}
        {retentes > 0 && aboutis > 0 ? (
          <p className="text-sm text-encre-3">
            <span className="font-mono">{liste.length}</span> {mot}
            {dontRetentes} : un prospect sans réponse est rappelé jusqu’à trois fois.
          </p>
        ) : null}
        {aboutis > 0 && aboutis < 10 ? (
          <p className="text-sm text-encre-3">Pas de taux sous 10 appels aboutis : il ne voudrait rien dire.</p>
        ) : null}
        {/* Sous 640 px, la phrase et la durée cumulée suffisent : les comptes par issue restent dans la file (ses filtres). */}
        {secondes > 0 ? (
          <p className="text-sm text-encre-3 sm:hidden">
            Durée cumulée <span className="font-mono">{duree(secondes)}</span>
          </p>
        ) : null}
      </div>
      <dl className="flex flex-wrap gap-x-7 gap-y-2 text-md max-sm:hidden">
        {ISSUES_SYSTEME.filter((i) => parIssue.has(i)).map((i) => (
          <div key={i} className="flex items-baseline gap-2">
            <dt className={i === 'rendez-vous-pris' ? 'text-encre' : 'text-encre-2'}>{LIBELLES_ISSUES[i]}</dt>
            <dd className="font-mono text-encre-3">{parIssue.get(i)}</dd>
          </div>
        ))}
        {sansIssue > 0 ? (
          <div className="flex items-baseline gap-2">
            <dt className="text-encre-2">Sans issue</dt>
            <dd className="font-mono text-encre-3">{sansIssue}</dd>
          </div>
        ) : null}
        {sautes > 0 ? (
          <div className="flex items-baseline gap-2">
            <dt className="text-encre-2">Non appelables</dt>
            <dd className="font-mono text-encre-3">{sautes}</dd>
          </div>
        ) : null}
        {retires > 0 ? (
          <div className="flex items-baseline gap-2">
            <dt className="text-encre-2">Retirés</dt>
            <dd className="font-mono text-encre-3">{retires}</dd>
          </div>
        ) : null}
        {secondes > 0 ? (
          <div className="flex items-baseline gap-2">
            <dt className="text-encre-2">Durée cumulée</dt>
            <dd className="font-mono text-encre-3">{duree(secondes)}</dd>
          </div>
        ) : null}
      </dl>
      {/* Sans conversation, la frise ne montrerait que des traits minimaux : la phrase suffit. */}
      {piste.length > 0 && aboutis > 0 ? (
        <figure className="grid gap-1.5">
          <div aria-hidden="true" className="flex min-h-6 flex-wrap items-end gap-[3px] border-b border-filet-2">
            {piste.map((a) => (
              <GlypheEtape
                key={a.id}
                hauteur={24}
                etape={a.bilan?.etapeAtteinte ?? null}
                nombre={nombreEtapes}
                etat={a.statut === 'echec' ? 'echec' : a.bilan ? 'bilan' : 'sans-bilan'}
                rendezVous={a.issueSysteme === 'rendez-vous-pris'}
              />
            ))}
          </div>
          <figcaption className="text-sm text-encre-3">
            Un trait par appel, dans l’ordre d’appel : sa hauteur dit jusqu’où l’appel est allé dans le script ; en blanc, un rendez-vous pris.
          </figcaption>
        </figure>
      ) : null}
    </section>
  );
}
