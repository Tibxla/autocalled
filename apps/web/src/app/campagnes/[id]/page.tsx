import { ISSUES_SYSTEME, LIBELLES_ISSUES, type IssueSysteme } from '@autocalled/domain';
import { and, eq, gte } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { comptesCampagne, dateCourte, duree, issueEffective, numeroMasque, STATUTS_CAMPAGNE } from '@/components/format-appel';
import { EnTetePage, GlypheEtape, LienAction, Page, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { appels, campagnes, entreprises, issuesPersonnalisees, prospects, versionsScript } from '@/db/schema';
import { rafraichirSiAncien } from '@/lib/agenda';
import { autorisationsDe } from '@/lib/autorisations';
import { numeroLisible } from '@/lib/format';
import { commanderPont } from '@/lib/pont';
import { ajoutParMcp } from '@/lib/prospects';
import { versionsDeLEntreprise } from '@/lib/versions';
import { File, type EntreeFile } from './file';
import type { ProspectRecapitulatif } from './recapitulatif';
import { Regie, type EtatPont, type RaisonSuspension } from './regie';

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
  if (!reponse) return { etat: 'inconnu', plafond: null, reglages: null };
  if (!reponse.ok) return { etat: 'injoignable', plafond: null, reglages: null };
  const corps = reponse.corps as { connecte?: boolean; plafond?: unknown; reglages?: EtatPont['reglages'] };
  return {
    etat: corps.connecte ? 'joignable' : 'deconnecte',
    plafond: typeof corps.plafond === 'string' ? corps.plafond : null,
    reglages: corps.reglages ?? null,
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
      .select({ id: prospects.id, nom: prospects.nom, societe: prospects.societe, telephone: prospects.telephone })
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
    suivreLePont ? db.$count(appels, and(eq(appels.ligne, 'bluetooth'), gte(appels.debutLe, ilYA24Heures()))) : Promise.resolve(null),
  ]);
  if (!entreprise) notFound();

  const prospectDe = new Map(listeProspects.map((p) => [p.id, p]));
  const appelDe = new Map(listeAppels.map((a) => [a.id, a]));
  const libellePerso = new Map(issuesPerso.map((i) => [`perso:${i.id}`, i.libelle]));
  const libelleVersion = versions.find((v) => v.id === campagne.versionScriptId)?.libelle ?? 'Version supprimée';
  const nombreEtapes = version?.etapes.length ?? null;
  const comptes = comptesCampagne(campagne.entrees);
  const ouvert = campagne.entrees.find((e) => e.etat === 'en-appel');
  const prochaineEntree = campagne.entrees.find((e) => e.etat === 'a-appeler');
  const prochainProspect = prochaineEntree ? prospectDe.get(prochaineEntree.prospectId) : undefined;
  const prochain = prochaineEntree
    ? { id: prochaineEntree.prospectId, nom: prochainProspect?.nom ?? prochaineEntree.prospectId, societe: prochainProspect?.societe ?? null }
    : null;

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

  // Dernier appel de la campagne, pour dire pourquoi elle s'est arrêtée s'il n'est pas parti.
  const dernier = [...listeAppels].sort((a, b) => b.debutLe.getTime() - a.debutLe.getTime())[0];
  const dernierEchec = dernier?.statut === 'echec' && !dernier.conversationId ? (dernier.erreur ?? 'l’appel n’est pas parti.') : null;

  // Prête : les numéros relus maintenant, pour le récapitulatif qui sert de confirmation.
  let recapitulatif: { prospects: ProspectRecapitulatif[]; autorises: number } | null = null;
  if (campagne.statut === 'prete') {
    const aAppeler = campagne.entrees.filter((e) => e.etat === 'a-appeler');
    const autorisations = await autorisationsDe(aAppeler.flatMap((e) => prospectDe.get(e.prospectId)?.telephone ?? []));
    // Au téléphone, les numéros autorisés entrés par le serveur MCP (ADR 0009) sont signalés avant le lancement.
    const aVerifier = telephone ? [...autorisations].filter(([, a]) => a.autorise).map(([n]) => n) : [];
    const datesMcp = new Map(await Promise.all(aVerifier.map(async (n) => [n, await ajoutParMcp(n)] as const)));
    const lignes = aAppeler.map((e, i) => {
      const p = prospectDe.get(e.prospectId);
      return {
        rang: i + 1,
        id: e.prospectId,
        nom: p?.nom ?? e.prospectId,
        societe: p?.societe ?? null,
        numero: p ? numeroMasque(numeroLisible(p.telephone)) : '',
        autorisation: p ? autorisations.get(p.telephone) : undefined,
        ajoutMcp: p ? (datesMcp.get(p.telephone) ?? null) : null,
      };
    });
    recapitulatif = { prospects: lignes, autorises: lignes.filter((l) => l.autorisation?.autorise).length };
  }

  const entreesFile: EntreeFile[] = campagne.entrees.map((e, i) => {
    const p = prospectDe.get(e.prospectId);
    const a = 'appelId' in e ? appelDe.get(e.appelId) : undefined;
    return {
      rang: i + 1,
      prospectId: e.prospectId,
      nom: p?.nom ?? e.prospectId,
      societe: p?.societe ?? null,
      etat: e.etat,
      suivant: e.prospectId === prochain?.id && campagne.statut !== 'terminee',
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

  return (
    <Page largeur="pleine">
      <EnTetePage
        titre={`Campagne du ${dateCourte(campagne.creeLe).replace(' ', ' · ')}`}
        sousTitre={`${libelleVersion} · ${PHRASES_LIGNE[campagne.ligne] ?? campagne.ligne}`}
        retour={{ href: `/entreprises/${entreprise.slug}/campagnes`, libelle: `${entreprise.nom} · Campagnes` }}
        action={
          <p className="flex items-baseline gap-3 text-md">
            {/* Terminée : le bloc « Campagne terminée » le dit déjà, l'en-tête garde le seul compte. */}
            {campagne.statut === 'terminee' ? null : (
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
          prochain={prochain}
          restants={comptes.aAppeler}
          enAppel={comptes.enAppel > 0}
          appelOuvertNavigateur={campagne.ligne === 'navigateur' && ouvert?.etat === 'en-appel' ? ouvert.appelId : null}
          appelTelephone={appelTelephone}
          pont={pont}
          passes24h={passes24h}
          raison={campagne.statut === 'en-pause' ? raisonSuspension({ enAppel: comptes.enAppel > 0, dernierEchec, pont }) : null}
          recapitulatif={recapitulatif}
        />

        {campagne.statut === 'terminee' ? (
          <BilanCampagne
            appels={listeAppels}
            sautes={comptes.sautees}
            nombreEtapes={nombreEtapes}
            ordre={campagne.entrees.flatMap((e) => ('appelId' in e ? [e.appelId] : []))}
            slug={entreprise.slug}
            simulee={campagne.ligne === 'simulation'}
          />
        ) : null}

        <section aria-labelledby="titre-file" className="grid grid-cols-1">
          <TitreSection id="titre-file" compte={comptes.total}>
            File
          </TitreSection>
          <File
            entrees={entreesFile}
            nombreEtapes={nombreEtapes}
            slug={entreprise.slug}
            campagneId={campagne.id}
            filtreInitial={typeof filtreFile === 'string' ? filtreFile : undefined}
          />
        </section>
      </div>
    </Page>
  );
}

/** Ce qu'a donné une campagne terminée, calculé sur la page à partir de ses appels. */
function BilanCampagne({
  appels: liste,
  sautes,
  nombreEtapes,
  ordre,
  slug,
  simulee,
}: {
  appels: {
    id: string;
    statut: string;
    issue: string | null;
    issueSysteme: IssueSysteme | null;
    dureeSecondes: number | null;
    bilan: { etapeAtteinte: number } | null;
  }[];
  sautes: number;
  nombreEtapes: number | null;
  ordre: string[];
  slug: string;
  simulee: boolean;
}) {
  const parIssue = new Map<IssueSysteme, number>();
  let sansIssue = 0;
  for (const a of liste) {
    const issue = issueEffective(a);
    if (issue) parIssue.set(issue, (parIssue.get(issue) ?? 0) + 1);
    else sansIssue += 1;
  }
  const rendezVous = parIssue.get('rendez-vous-pris') ?? 0;
  // Un appel abouti est une conversation : les non aboutis ne disent rien du script.
  const aboutis = liste.filter((a) => {
    const issue = issueEffective(a);
    return issue !== null && issue !== 'non-abouti';
  }).length;
  const secondes = liste.reduce((s, a) => s + (a.dureeSecondes ?? 0), 0);
  const appelDe = new Map(liste.map((a) => [a.id, a]));
  const piste = ordre.map((id) => appelDe.get(id)).filter((a) => a !== undefined);
  const mot = simulee ? 'appels simulés' : 'appels';

  let phrase: string;
  if (liste.length === 0) {
    phrase =
      sautes > 0
        ? `Aucun appel passé : ${sautes} prospect${sautes > 1 ? 's' : ''} sauté${sautes > 1 ? 's' : ''}, numéro non autorisé.`
        : 'Aucun appel passé.';
  } else if (aboutis === 0) {
    phrase = `Aucune conversation sur ${liste.length} ${mot}.`;
  } else {
    const taux = aboutis >= 10 ? ` · ${Math.round((rendezVous / aboutis) * 100)} %` : '';
    phrase = `${rendezVous} rendez-vous sur ${aboutis} ${mot} aboutis${taux}`;
  }

  return (
    <section aria-labelledby="titre-bilan" className="grid gap-4">
      <TitreSection id="titre-bilan" action={<LienAction href={`/entreprises/${slug}/analyse`}>Voir l’analyse de l’entreprise</LienAction>}>
        Campagne terminée
      </TitreSection>
      <div className="grid gap-1">
        <p className="text-lg font-medium">{phrase}</p>
        {aboutis > 0 && aboutis < 10 ? (
          <p className="text-sm text-encre-3">Pas de taux sous 10 conversations : il ne voudrait rien dire.</p>
        ) : null}
      </div>
      <dl className="flex flex-wrap gap-x-7 gap-y-2 text-md">
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
            <dt className="text-encre-2">Sautés</dt>
            <dd className="font-mono text-encre-3">{sautes}</dd>
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
                rendezVous={issueEffective(a) === 'rendez-vous-pris'}
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
