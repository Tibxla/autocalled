import 'server-only';
import { join } from 'node:path';
import {
  appliquerRemplacements,
  avecPrompt,
  CHAMPS_GERES,
  CHEMIN_PROMPT,
  type ClientAgent,
  clientElevenLabs,
  difference,
  distanteModifieeDepuis,
  ecrireChemin,
  ecrireLocal,
  empreinte,
  type Json,
  lireChemin,
  lireLocal,
  pousser,
  rapatrier,
  separerPrompt,
  type Verrou,
  validerPrompt,
  versionDe,
} from '@autocalled/agent';
import { VARIABLES_DE_L_APPEL } from '@autocalled/domain';
import { and, count, desc, eq, isNotNull, ne } from 'drizzle-orm';
import { db } from '@/db';
import { appels, campagnes, type OrigineVersionAssistante, versionsAssistante } from '@/db/schema';
import type { Refus } from './entreprises';
import { type PatchReglages, patchReglagesSchema, REGLAGES_MODIFIABLES } from './reglages-assistante';

/**
 * La configuration ElevenLabs de l'assistante (prompt, voix, tour de parole…) vue et écrite par le serveur MCP et par
 * la page Assistante (ADR 0010). `agent/` reste la seule source : on y écrit, on relit dans git, et rien ne change pour
 * les appels avant `pousserAssistante`, que l'opérateur confirme sur une différence rédigée ici. Lit et écrit des
 * fichiers et parle à ElevenLabs : côté interface, seuls la page Assistante et ses actions serveur l'importent, par
 * lib/edition-assistante.ts (règle eslint) ; jamais un composant client. Le prompt ne s'écrit que par le MCP.
 */

/** Le dossier `agent/` de la copie où tourne le code (le serveur MCP tourne depuis apps/web). */
export function dossierAgent(): string {
  return process.env.DOSSIER_AGENT ?? join(process.cwd(), '..', '..', 'agent');
}

/** Le client ElevenLabs de `.env`, ou null sans clé ni agent. */
export function clientAgentParDefaut(): ClientAgent | null {
  const cle = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  return cle && agentId ? clientElevenLabs({ cle, agentId }) : null;
}

/** `client` : null pour ne pas joindre ElevenLabs, absent pour le client de `.env`. Les tests injectent un faux. */
type Options = { client?: ClientAgent | null; dossier?: string };

const dossierDe = (o: Options) => o.dossier ?? dossierAgent();
const clientDe = (o: Options) => (o.client === undefined ? clientAgentParDefaut() : o.client);

/** Au-delà, une différence ne se relit pas dans une question : la poussée passe par `pnpm agent push`. */
export const LONGUEUR_MAX_DIFFERENCE = 4000;

export { type PatchReglages, patchReglagesSchema, REGLAGES_MODIFIABLES };

/** Les valeurs actuelles des réglages modifiables, au format de `PatchReglages`. */
function reglagesDe(configuration: Json): Json {
  const sortie: Json = {};
  for (const r of REGLAGES_MODIFIABLES) {
    const valeur = lireChemin(configuration, r.chemin);
    if (valeur !== undefined) ecrireChemin(sortie, r.cle, valeur);
  }
  return sortie;
}

const cheminPermis = (chemin: string) => chemin === CHEMIN_PROMPT || REGLAGES_MODIFIABLES.some((r) => r.chemin === chemin);

export interface SynchroAssistante {
  empreinteLocale: string;
  verrou: Verrou | null;
  distante: { versionId: string | null; empreinte: string } | null;
  /** `agent/` diffère de la dernière configuration poussée ou rapatriée. */
  modificationsLocalesNonPoussees: boolean;
  /** ElevenLabs a changé depuis (tableau de bord) : rapatrier avant toute écriture. */
  distanteModifieeDepuisLeVerrou: boolean;
  erreurDistante?: string;
}

export interface VueConfigurationAssistante {
  prompt: string;
  reglages: PatchReglages;
  /** Ce que le MCP ne modifie pas : contrat avec le code ou garde de sécurité. */
  lectureSeule: {
    langue: unknown;
    outils: { nom: string; type: string }[];
    surcharges: unknown;
    authentification: unknown;
    firstMessage: unknown;
    valeursExemple: string[];
  };
  variablesDisponibles: readonly string[];
  synchro: SynchroAssistante;
}

async function lireDistante(client: ClientAgent | null): Promise<{ config: Json | null; erreur?: string }> {
  if (!client) return { config: null, erreur: 'ElevenLabs n’est pas configuré (ELEVENLABS_API_KEY ou ELEVENLABS_AGENT_ID absente).' };
  try {
    return { config: await client.lire() };
  } catch (erreur) {
    return { config: null, erreur: `ElevenLabs ne répond pas : ${(erreur as Error).message}` };
  }
}

function synchroDe(locale: { prompt: string; configuration: Json; verrou: Verrou | null }, distante: Json | null, erreurDistante?: string): SynchroAssistante {
  const empreinteLocale = empreinte(avecPrompt(locale.configuration, locale.prompt));
  const vueDistante = distante ? { versionId: versionDe(distante), empreinte: empreinte(distante) } : null;
  return {
    empreinteLocale,
    verrou: locale.verrou,
    distante: vueDistante,
    modificationsLocalesNonPoussees: locale.verrou ? locale.verrou.empreinte !== empreinteLocale : true,
    distanteModifieeDepuisLeVerrou: vueDistante ? distanteModifieeDepuis(locale.verrou, vueDistante) : false,
    ...(erreurDistante ? { erreurDistante } : {}),
  };
}

/** Tout ce que `agent/` dit de l'assistante, et où en est la synchronisation avec ElevenLabs (lu seulement si `distante`). */
export async function lireConfigurationAssistante(o: Options & { distante?: boolean } = {}): Promise<VueConfigurationAssistante> {
  const locale = await lireLocal(dossierDe(o));
  const { config, erreur } = o.distante === false ? { config: null, erreur: 'non lue' } : await lireDistante(clientDe(o));
  const c = locale.configuration;
  const outils = [
    ...((lireChemin(c, 'conversation_config.agent.prompt.tools') as { name?: string; type?: string }[] | undefined) ?? []).map((t) => ({
      nom: String(t.name ?? ''),
      type: String(t.type ?? ''),
    })),
  ];
  const valeursExemple = Object.keys((lireChemin(c, 'conversation_config.agent.dynamic_variables.dynamic_variable_placeholders') as Json | undefined) ?? {});
  return {
    prompt: locale.prompt,
    reglages: reglagesDe(c) as PatchReglages,
    lectureSeule: {
      langue: lireChemin(c, 'conversation_config.agent.language'),
      outils,
      surcharges: lireChemin(c, 'platform_settings.overrides'),
      authentification: lireChemin(c, 'platform_settings.auth.enable_auth'),
      firstMessage: lireChemin(c, 'conversation_config.agent.first_message'),
      valeursExemple,
    },
    variablesDisponibles: VARIABLES_DE_L_APPEL,
    synchro: synchroDe(locale, config, erreur),
  };
}

/**
 * Avant d'écrire `agent/` : les fichiers n'ont pas bougé depuis la lecture (`empreinteConnue`), et ElevenLabs n'a
 * pas été modifié ailleurs (sinon on écrirait sur une base périmée). ElevenLabs injoignable : l'écriture passe,
 * avec un avertissement.
 */
async function avantEcriture(
  empreinteConnue: string,
  o: Options,
): Promise<Refus | { ok: true; locale: Awaited<ReturnType<typeof lireLocal>>; avertissement?: string }> {
  const locale = await lireLocal(dossierDe(o));
  if (empreinte(avecPrompt(locale.configuration, locale.prompt)) !== empreinteConnue) {
    return { ok: false, raison: 'agent/ a changé depuis ta lecture (autre session ou modification à la main) : relis avec lire_assistante.' };
  }
  const { config, erreur } = await lireDistante(clientDe(o));
  if (config && distanteModifieeDepuis(locale.verrou, { versionId: versionDe(config), empreinte: empreinte(config) })) {
    return { ok: false, raison: 'La configuration ElevenLabs a été modifiée ailleurs depuis le dernier rapatriement : rapatrier_assistante d’abord.' };
  }
  return { ok: true, locale, ...(erreur ? { avertissement: `${erreur} L’écriture locale est faite ; la poussée demandera ElevenLabs.` } : {}) };
}

const RAPPEL_GIT = 'agent/ modifié : à relire (git diff agent/) et à commiter. Rien ne change pour les appels avant pousser_assistante.';

/**
 * Modifie `agent/prompt.md` par remplacements exacts (chacun doit apparaître une seule fois), tout ou rien. Le
 * résultat doit rester un prompt valide : variables exactement celles de l'application, section Règles présente.
 */
export async function modifierPromptAssistante(
  remplacements: { avant: string; apres: string }[],
  empreinteConnue: string,
  o: Options = {},
): Promise<{ ok: true; empreinteLocale: string; lignesModifiees: number; rappel: string; avertissement?: string } | Refus> {
  if (remplacements.length < 1 || remplacements.length > 20) return { ok: false, raison: 'De 1 à 20 remplacements.' };
  if (remplacements.some((r) => r.avant.length > 4000 || r.apres.length > 4000)) return { ok: false, raison: '4 000 caractères au plus par passage.' };
  const avant = await avantEcriture(empreinteConnue, o);
  if (!avant.ok) return avant;
  const { locale } = avant;

  const resultat = appliquerRemplacements(locale.prompt, remplacements);
  if (!resultat.ok) return resultat;
  const validation = validerPrompt(resultat.texte, VARIABLES_DE_L_APPEL);
  if (!validation.ok) return { ok: false, raison: `Prompt refusé, rien n’est écrit : ${validation.erreurs.join(' ')}` };
  if (resultat.texte === locale.prompt) return { ok: false, raison: 'Ces remplacements ne changent rien au prompt.' };

  await ecrireLocal(dossierDe(o), { prompt: resultat.texte });
  const d = difference(locale, { prompt: resultat.texte, configuration: locale.configuration });
  return {
    ok: true,
    empreinteLocale: empreinte(avecPrompt(locale.configuration, resultat.texte)),
    lignesModifiees: d.texte.split('\n').filter((l) => l.startsWith('− ') || l.startsWith('+ ')).length,
    rappel: RAPPEL_GIT,
    ...(avant.avertissement ? { avertissement: avant.avertissement } : {}),
  };
}

/** Modifie les réglages de la liste blanche dans `agent/mina.config.json`. Sans effet avant la poussée. */
export async function modifierReglagesAssistante(
  patch: PatchReglages,
  empreinteConnue: string,
  o: Options = {},
): Promise<{ ok: true; empreinteLocale: string; champs: string[]; rappel: string; avertissement?: string } | Refus> {
  const saisie = patchReglagesSchema.safeParse(patch);
  if (!saisie.success) {
    const probleme = saisie.error.issues[0];
    return { ok: false, raison: `Réglage refusé (${probleme?.path.join('.') || 'saisie'}) : ${probleme?.message ?? 'valeur invalide'}` };
  }
  const valeurs = REGLAGES_MODIFIABLES.map((r) => ({ ...r, valeur: lireChemin(saisie.data, r.cle) })).filter((r) => r.valeur !== undefined);
  if (valeurs.length === 0) return { ok: false, raison: 'Aucun réglage à modifier.' };

  const avant = await avantEcriture(empreinteConnue, o);
  if (!avant.ok) return avant;
  const configuration = structuredClone(avant.locale.configuration);
  for (const r of valeurs) ecrireChemin(configuration, r.chemin, r.valeur);

  await ecrireLocal(dossierDe(o), { configuration });
  return {
    ok: true,
    empreinteLocale: empreinte(avecPrompt(configuration, avant.locale.prompt)),
    champs: valeurs.map((r) => r.cle),
    rappel: RAPPEL_GIT,
    ...(avant.avertissement ? { avertissement: avant.avertissement } : {}),
  };
}

type EtatPoussee =
  | { ok: true; rien: true }
  | {
      ok: true;
      rien: false;
      diff: string;
      tropLong: boolean;
      horsListe: string[];
      campagneEnCours: boolean;
      attendu: { empreinteLocale: string; versionIdDistante: string | null };
    };

async function etatPoussee(o: Options): Promise<Refus | (EtatPoussee & { distante?: Json; client?: ClientAgent })> {
  const client = clientDe(o);
  if (!client) return { ok: false, raison: 'ElevenLabs n’est pas configuré (ELEVENLABS_API_KEY ou ELEVENLABS_AGENT_ID absente) : rien ne peut partir.' };
  const locale = await lireLocal(dossierDe(o));
  const validation = validerPrompt(locale.prompt, VARIABLES_DE_L_APPEL);
  if (!validation.ok) return { ok: false, raison: `Le prompt de agent/ n’est pas valide, rien ne part : ${validation.erreurs.join(' ')}` };

  const { config: distante, erreur } = await lireDistante(client);
  if (!distante) return { ok: false, raison: erreur ?? 'ElevenLabs ne répond pas.' };
  const versionIdDistante = versionDe(distante);
  if (distanteModifieeDepuis(locale.verrou, { versionId: versionIdDistante, empreinte: empreinte(distante) })) {
    return { ok: false, raison: 'La configuration ElevenLabs a été modifiée ailleurs depuis le dernier rapatriement : rapatrier_assistante d’abord.' };
  }
  const d = difference(separerPrompt(distante), locale);
  if (d.vide) return { ok: true, rien: true };

  const [enCours] = await db.select({ id: campagnes.id }).from(campagnes).where(eq(campagnes.statut, 'en-cours')).limit(1);
  return {
    ok: true,
    rien: false,
    diff: d.texte,
    tropLong: d.texte.length > LONGUEUR_MAX_DIFFERENCE,
    horsListe: d.champs.map((c) => c.chemin).filter((c) => !cheminPermis(c)),
    campagneEnCours: Boolean(enCours),
    attendu: { empreinteLocale: empreinte(avecPrompt(locale.configuration, locale.prompt)), versionIdDistante },
    distante,
    client,
  };
}

/**
 * Ce qu'une poussée changerait, du distant vers `agent/`, rédigé ici (jamais par le modèle) pour la question posée
 * à l'opérateur. `attendu` se repasse tel quel à `pousserAssistante`.
 */
export async function preparerPousseeAssistante(o: Options = {}): Promise<EtatPoussee | Refus> {
  const etat = await etatPoussee(o);
  if (!etat.ok || etat.rien) return etat;
  return {
    ok: true,
    rien: false,
    diff: etat.diff,
    tropLong: etat.tropLong,
    horsListe: etat.horsListe,
    campagneEnCours: etat.campagneEnCours,
    attendu: etat.attendu,
  };
}

/** Garde un instantané d'une configuration ElevenLabs, sauf si sa version est déjà consignée. */
async function consigner(config: Json, origine: OrigineVersionAssistante): Promise<void> {
  const versionId = versionDe(config);
  if (!versionId) return;
  const { prompt, configuration } = separerPrompt(config);
  await db
    .insert(versionsAssistante)
    .values({ versionId, empreinte: empreinte(config), prompt, configuration, origine })
    .onConflictDoNothing({ target: versionsAssistante.versionId });
}

/**
 * Envoie `agent/` à ElevenLabs, après l'accord de l'opérateur sur la différence de `preparerPousseeAssistante` :
 * refus si les fichiers ou la version distante ont bougé depuis (`attendu`). Par le MCP comme par l'interface, seuls
 * le prompt et les réglages de la liste blanche partent, et une différence trop longue pour être relue passe par la
 * ligne de commande. `origine` est consignée avec la nouvelle version.
 */
export async function pousserAssistante(
  o: Options & { attendu: { empreinteLocale: string; versionIdDistante: string | null }; origine: 'mcp' | 'interface' | 'cli' },
): Promise<{ ok: true; versionAvant: string | null; versionApres: string | null; rappel: string } | Refus> {
  const etat = await etatPoussee(o);
  if (!etat.ok) return etat;
  if (etat.rien) return { ok: false, raison: 'Rien à pousser : agent/ est identique à la configuration ElevenLabs.' };
  if (o.origine !== 'cli' && etat.horsListe.length) {
    return {
      ok: false,
      raison: `Ces champs se poussent par \`pnpm agent push\`, après relecture du code : ${etat.horsListe.join(', ')}.`,
    };
  }
  if (o.origine !== 'cli' && etat.tropLong) {
    return { ok: false, raison: `La différence dépasse ${LONGUEUR_MAX_DIFFERENCE} caractères : relis \`git diff agent/\` et pousse par \`pnpm agent push\`.` };
  }
  if (etat.attendu.empreinteLocale !== o.attendu.empreinteLocale || etat.attendu.versionIdDistante !== o.attendu.versionIdDistante) {
    return { ok: false, raison: 'La configuration a changé depuis la question : rien n’est parti, relis la différence.' };
  }
  const { client, distante } = etat as { client: ClientAgent; distante: Json };
  // La version remplacée est forcément celle du verrou, écrite par la ligne de commande si le MCP ne la connaît pas.
  await consigner(distante, 'cli');
  const resultat = await pousser(dossierDe(o), client, o.attendu);
  if (!resultat.ok) return resultat;
  await consigner(resultat.apres, o.origine);
  return {
    ok: true,
    versionAvant: versionDe(resultat.avant),
    versionApres: resultat.versionId,
    rappel: 'agent/ réécrit d’après ElevenLabs : à relire (git diff agent/) et à commiter.',
  };
}

/** Rapatrie la configuration ElevenLabs dans `agent/` (jamais de force) et la consigne, d'origine « distante » quel que soit le geste. */
export async function rapatrierAssistante(o: Options = {}): Promise<{ ok: true; versionId: string | null; rappel: string } | Refus> {
  const client = clientDe(o);
  if (!client) return { ok: false, raison: 'ElevenLabs n’est pas configuré (ELEVENLABS_API_KEY ou ELEVENLABS_AGENT_ID absente).' };
  let resultat: Awaited<ReturnType<typeof rapatrier>>;
  try {
    resultat = await rapatrier(dossierDe(o), client);
  } catch (erreur) {
    return { ok: false, raison: `ElevenLabs ne répond pas : ${(erreur as Error).message}` };
  }
  if (!resultat.ok) {
    return {
      ok: false,
      raison: `${resultat.raison} Le MCP ne tranche pas : au terminal, git diff agent/, git stash, pnpm agent pull, puis réappliquer.`,
    };
  }
  await consigner(resultat.distante, 'distante');
  return { ok: true, versionId: versionDe(resultat.distante), rappel: 'agent/ réécrit d’après ElevenLabs : à relire (git diff agent/) et à commiter.' };
}

export interface LigneHistoriqueAssistante {
  versionId: string;
  consigneLe: Date;
  origine: OrigineVersionAssistante;
  empreinte: string;
  longueurPrompt: number;
  /** Appels réels (hors simulation) passés avec cette version d'agent. */
  appels: number;
  estLeVerrou: boolean;
}

async function appelsParVersion(): Promise<Map<string, number>> {
  const lignes = await db
    .select({ version: appels.versionAgent, n: count() })
    .from(appels)
    .where(and(isNotNull(appels.versionAgent), ne(appels.ligne, 'simulation')))
    .groupBy(appels.versionAgent);
  return new Map(lignes.map((l) => [l.version ?? '', Number(l.n)]));
}

async function verrouActuel(o: Options): Promise<Verrou | null> {
  try {
    return (await lireLocal(dossierDe(o))).verrou;
  } catch {
    return null;
  }
}

/** Les configurations consignées, de la plus récente à la plus ancienne. */
export async function historiqueAssistante(o: Options = {}): Promise<LigneHistoriqueAssistante[]> {
  const [lignes, parVersion, verrou] = await Promise.all([
    db.select().from(versionsAssistante).orderBy(desc(versionsAssistante.consigneLe)),
    appelsParVersion(),
    verrouActuel(o),
  ]);
  return lignes.map((l) => ({
    versionId: l.versionId,
    consigneLe: l.consigneLe,
    origine: l.origine,
    empreinte: l.empreinte.slice(0, 12),
    longueurPrompt: l.prompt.length,
    appels: parVersion.get(l.versionId) ?? 0,
    estLeVerrou: verrou?.versionId === l.versionId,
  }));
}

export interface InstantaneAssistante {
  versionId: string;
  consigneLe: Date;
  origine: OrigineVersionAssistante;
  empreinte: string;
  prompt: string;
  configuration: Json;
  appels: number;
}

/** Un instantané complet, et ce qui le sépare des fichiers de `agent/` (de l'instantané vers les fichiers). */
export async function versionAssistante(versionId: string, o: Options = {}): Promise<(InstantaneAssistante & { differenceAvecLocal: string }) | null> {
  const [ligne] = await db.select().from(versionsAssistante).where(eq(versionsAssistante.versionId, versionId));
  if (!ligne) return null;
  const [parVersion, locale] = await Promise.all([appelsParVersion(), lireLocal(dossierDe(o))]);
  const d = difference({ prompt: ligne.prompt, configuration: ligne.configuration }, locale);
  return {
    versionId: ligne.versionId,
    consigneLe: ligne.consigneLe,
    origine: ligne.origine,
    empreinte: ligne.empreinte,
    prompt: ligne.prompt,
    configuration: ligne.configuration,
    appels: parVersion.get(ligne.versionId) ?? 0,
    differenceAvecLocal: d.vide ? 'Identique aux fichiers de agent/.' : d.texte,
  };
}

/**
 * Réécrit `agent/` depuis un instantané, champs gérés seulement, pour un retour arrière qu'il faudra ensuite
 * pousser. Refuse s'il reste des modifications locales non poussées (on les perdrait) ou si le prompt de
 * l'instantané ne passe plus la validation (variables d'une autre époque).
 */
export async function restaurerAssistante(versionId: string, o: Options = {}): Promise<{ ok: true; empreinteLocale: string; rappel: string } | Refus> {
  const [ligne] = await db.select().from(versionsAssistante).where(eq(versionsAssistante.versionId, versionId));
  if (!ligne) return { ok: false, raison: 'Cette version n’est pas consignée : historique_assistante liste celles qui le sont.' };
  const locale = await lireLocal(dossierDe(o));
  const empreinteLocale = empreinte(avecPrompt(locale.configuration, locale.prompt));
  if (!locale.verrou || locale.verrou.empreinte !== empreinteLocale) {
    return { ok: false, raison: 'agent/ contient des modifications non poussées, que la restauration effacerait : pousse-les ou mets-les de côté (git stash) d’abord.' };
  }
  const validation = validerPrompt(ligne.prompt, VARIABLES_DE_L_APPEL);
  if (!validation.ok) return { ok: false, raison: `Le prompt de cette version ne correspond plus à l’application : ${validation.erreurs.join(' ')}` };

  const configuration = structuredClone(locale.configuration);
  for (const chemin of CHAMPS_GERES) {
    if (chemin !== CHEMIN_PROMPT) ecrireChemin(configuration, chemin, lireChemin(ligne.configuration, chemin));
  }
  await ecrireLocal(dossierDe(o), { prompt: ligne.prompt, configuration });
  return {
    ok: true,
    empreinteLocale: empreinte(avecPrompt(configuration, ligne.prompt)),
    rappel: 'agent/ restauré : à relire (git diff agent/), puis pousser_assistante pour que les appels l’utilisent.',
  };
}
