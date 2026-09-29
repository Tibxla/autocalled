import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AjoutClaudeCode } from '@/components/ajout-claude-code';
import { ListeAppels } from '@/components/liste-appels';
import { PastilleAutorisation } from '@/components/pastille-autorisation';
import { cleJour, dateCourte, etatAppel, quandRappeler } from '@/components/format-appel';
import { Chevron, EtatVide, LienAction, Page, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { appels, consentements, issuesPersonnalisees, prospects, rendezVous, versionsScript } from '@/db/schema';
import { ligneBloquee } from '@/app/_accueil/situation';
import { etatLigneServeur } from '@/lib/accueil';
import { rafraichirSiAncien } from '@/lib/agenda';
import { preparerAppel } from '@/lib/appels';
import { autorisationsDe } from '@/lib/autorisations';
import { numeroLisible } from '@/lib/format';
import { entrepriseParSlug, prospectParId } from '@/lib/pages';
import { ajoutParMcp } from '@/lib/prospects';
import { rappelEnAttente } from '@/lib/rappels';
import { reglagesDuPont } from '@/lib/pont';
import { versionsDeLEntreprise } from '@/lib/versions';
import { BoutonRevoquer } from './bouton-revoquer';
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
      db.$count(appels, and(eq(appels.ligne, 'bluetooth'), gte(appels.debutLe, borne))),
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
async function lireBlocageTelephone(): Promise<BlocageTelephone | null> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const attente = new Promise<null>((resoudre) => {
    minuterie = setTimeout(() => resoudre(null), 1500);
  });
  try {
    const etat = await Promise.race([etatLigneServeur(), attente]);
    if (!etat) return null;
    const texte = ligneBloquee(etat);
    if (!texte) return null;
    return { texte, court: !etat.joignable ? 'injoignable' : !etat.connecte ? 'déconnecté' : 'plafond atteint' };
  } catch {
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}

/** L'heure se lit hors du rendu. */
function lireMaintenant(): Date {
  return new Date();
}

export default async function PageProspect({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const entreprise = await entrepriseParSlug(slug);
  const prospect = await prospectParId(entreprise.id, id);
  // L'agenda se relit dès l'ouverture de la fiche : il sera à jour quand Mina proposera des créneaux.
  await rafraichirSiAncien();
  const [autorisations, partages, toutesVersions, historique, [derniereRevocation], ordre, issuesPerso, ajoutMcp] = await Promise.all([
    autorisationsDe([prospect.telephone]),
    db.$count(prospects, and(eq(prospects.entrepriseId, entreprise.id), eq(prospects.telephone, prospect.telephone))),
    versionsDeLEntreprise(entreprise.id),
    db
      .select()
      .from(appels)
      .where(and(eq(appels.entrepriseId, entreprise.id), eq(appels.prospectId, prospect.id)))
      .orderBy(desc(appels.debutLe)),
    db
      .select({ le: consentements.revoqueLe })
      .from(consentements)
      .where(and(eq(consentements.numero, prospect.telephone), isNotNull(consentements.revoqueLe)))
      .orderBy(desc(consentements.revoqueLe))
      .limit(1),
    db
      .select({ id: prospects.id })
      .from(prospects)
      .where(eq(prospects.entrepriseId, entreprise.id))
      .orderBy(asc(prospects.nom), asc(prospects.id)),
    db
      .select({ id: issuesPersonnalisees.id, libelle: issuesPersonnalisees.libelle })
      .from(issuesPersonnalisees)
      .where(eq(issuesPersonnalisees.entrepriseId, entreprise.id)),
    // Consentement entré par le serveur MCP (ADR 0009) : rappelé sur la fiche et dans la confirmation d'appel.
    ajoutParMcp(prospect.telephone),
  ]);
  // Les scripts archivés ne sont plus proposés au lancement.
  const versions = toutesVersions.filter((v) => !v.scriptArchive);
  const autorisation = autorisations.get(prospect.telephone);
  const autorise = Boolean(autorisation?.autorise);
  const revocation = autorise ? null : (derniereRevocation?.le ?? null);
  const lisible = numeroLisible(prospect.telephone);
  const base = `/entreprises/${slug}/prospects`;

  // Ce que Mina recevra au début de l'appel (lecture seule, avec la première version proposée).
  const preparation = autorise && versions[0] ? await preparerAppel(entreprise.id, prospect.id, versions[0].id) : null;

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
  const etatDernier = dernier ? etatAppel(dernier, { libellePerso: dernier.issue ? libellePerso.get(dernier.issue) : null }) : null;
  // Le rappel à faire : le dernier appel hors simulation a fini en rappel convenu (un appel plus récent le fait).
  const rappel = rappelEnAttente(historique);
  const maintenant = lireMaintenant();
  const rappelEnRetard = rappel?.rappelLe ? cleJour(rappel.rappelLe) < cleJour(maintenant) : false;

  let blocage: { texte: string; lien?: { href: string; libelle: string } } | null = null;
  if (!autorise) {
    const raison = autorisation && !autorisation.autorise ? autorisation.raison : 'aucun-consentement';
    blocage =
      raison === 'consentement-revoque'
        ? { texte: `Numéro révoqué${revocation ? ` le ${JOUR_MOIS.format(revocation)}` : ''} : il ne sera plus jamais composé.` }
        : raison === 'numero-invalide'
          ? { texte: 'Numéro invalide : corrige-le dans la fiche puis réimporte-la.', lien: { href: `${base}?import=1`, libelle: 'Importer des fiches' } }
          : { texte: 'Pas de consentement : réimporte la fiche en cochant l’attestation.', lien: { href: `${base}?import=1`, libelle: 'Importer des fiches' } };
  } else if (versions.length === 0) {
    blocage = {
      texte: toutesVersions.length > 0 ? 'Tous les scripts sont archivés : réactives-en un ou crées-en un dans Scripts.' : 'Aucun script : crées-en un dans Scripts.',
      lien: { href: `/entreprises/${slug}/scripts`, libelle: 'Ouvrir les scripts' },
    };
  }

  return (
    <Page largeur="lecture">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-8">
        <div className="grid gap-1">
          <Link href={base} className="justify-self-start text-sm text-encre-3 decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline">
            Prospects
          </Link>
          <h2 className="text-lg font-semibold tracking-[-0.01em]">{prospect.nom}</h2>
          {prospect.role || prospect.societe ? <p className="text-md text-encre-2">{[prospect.role, prospect.societe].filter(Boolean).join(', ')}</p> : null}
          {dernier && etatDernier ? (
            <p className="flex flex-wrap gap-x-4 gap-y-0.5 pt-1 text-sm text-encre-3">
              <Link href={`/appels/${dernier.id}?depuis=${encodeURIComponent(`${base}/${prospect.id}`)}`} className="decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline">
                Dernier appel le <span className="font-mono">{dateCourte(dernier.debutLe).split(' ')[0]}</span> : {etatDernier.libelle}
              </Link>
              {rappel ? (
                <span className="text-encre">
                  {rappel.rappelLe ? (
                    <>
                      {rappelEnRetard ? 'Rappel en retard' : 'Prochain rappel'} :{' '}
                      {quandRappeler(rappel.rappelLe, rappel.quand, maintenant)}
                    </>
                  ) : (
                    'Rappel convenu'
                  )}
                  {rappel.texte ? <span className="text-encre-3"> · « {rappel.texte} »</span> : rappel.rappelLe ? null : ' : moment non précisé'}
                </span>
              ) : null}
            </p>
          ) : (
            <p className="pt-1 text-sm text-encre-3">Jamais appelé.</p>
          )}
        </div>
        <nav aria-label="Autres prospects" className="-mx-1.5 flex gap-x-3">
          {precedent ? (
            <LienAction ton="discret" touche="K" raccourci="k" libelleRaccourci="Prospect précédent" href={`${base}/${precedent.id}`}>
              Précédent
            </LienAction>
          ) : null}
          {suivant ? (
            <LienAction ton="discret" touche="J" raccourci="j" libelleRaccourci="Prospect suivant" href={`${base}/${suivant.id}`}>
              Suivant
            </LienAction>
          ) : null}
        </nav>
      </div>

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-10">
          <section aria-labelledby="titre-sait" className="grid gap-4">
            <TitreSection id="titre-sait">Ce que Mina sait</TitreSection>
            <p className="max-w-[68ch] text-base whitespace-pre-line">{prospect.contexte || 'Pas de contexte dans la fiche.'}</p>
            <p className="text-sm text-encre-3">
              Fiche <span className="font-mono">{prospect.id}.md</span>, mise à jour le{' '}
              <span className="font-mono">{dateCourte(prospect.majLe)}</span>.
            </p>
            {preparation?.ok ? (
              <details className="group max-w-[68ch]">
                <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 text-md text-encre-2 hover:text-encre pointer-coarse:h-11 [&::-webkit-details-marker]:hidden">
                  <Chevron className="stroke-encre-3 group-open:rotate-90" />
                  <span className="decoration-souligne underline-offset-4 group-hover:underline">Ce que Mina saura en appelant</span>
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
                    <dd className="font-mono text-encre-2">{preparation.variables.prospect_email}</dd>
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
                Chaque appel s’affichera ici avec son issue et son bilan ; Mina s’en souviendra au prochain appel.
              </EtatVide>
            ) : (
              <ListeAppels
                depuis={`${base}/${prospect.id}`}
                appels={historique.map((a) => {
                  const cleIssue = a.issue ?? a.bilan?.issue ?? null;
                  return {
                    ...a,
                    resume: a.bilan?.resume ?? null,
                    nombreEtapes: nombreEtapes.get(a.versionScriptId) ?? null,
                    rendezVous: avecRendezVous.has(a.id),
                    libellePerso: cleIssue ? (libellePerso.get(cleIssue) ?? null) : null,
                  };
                })}
              />
            )}
          </section>
        </div>

        <aside aria-label="Numéro et appel" className="order-first grid content-start gap-6 lg:order-none">
          <div className="grid gap-2.5 border-t border-filet pt-4">
            <NumeroMasquable lisible={lisible} />
            {prospect.email ? <p className="font-mono text-sm break-all text-encre-2">{prospect.email}</p> : null}
            <PastilleAutorisation autorisation={autorisation} />
            {ajoutMcp ? (
              <p className="text-sm text-encre-3">
                <AjoutClaudeCode le={ajoutMcp} />
              </p>
            ) : null}
            {revocation ? (
              <p className="text-sm text-encre-3">
                Révoqué le <span className="font-mono">{JOUR_MOIS.format(revocation)}</span>.
              </p>
            ) : null}
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
            autorise={autorise}
            numero={lisible}
            ajoutMcp={ajoutMcp}
            blocage={blocage}
            plafonds={lirePlafonds()}
            telephoneBloque={lireBlocageTelephone()}
          />
          <BoutonRevoquer numero={prospect.telephone} lisible={lisible} partages={partages} autorise={autorise} />
        </aside>
      </div>
    </Page>
  );
}
