import 'server-only';
import type { ClientAgent } from '@autocalled/agent';
import { and, eq, gt, ne } from 'drizzle-orm';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { modifierAssistante, preparerModificationAssistante } from './assistante';
import {
  historiqueAssistante,
  type LigneHistoriqueAssistante,
  lireConfigurationAssistante,
  modifierReglagesAssistante,
  type PatchReglages,
  pousserAssistante,
  preparerPousseeAssistante,
  rapatrierAssistante,
  REGLAGES_MODIFIABLES,
  restaurerAssistante,
  versionAssistante,
} from './configuration-assistante';
import { type ConfirmationJournal, noterAuJournal } from './journal';
import { journalMcpRecent } from './lecture';
import { POUSSEE, RAPATRIEMENT, RESTAURATION } from './questions-assistante';

/**
 * Ce que la page Assistante modifie (décision de l'opérateur du 30/09/2026 : tout, sauf le prompt), par les mêmes
 * fonctions que les outils du serveur MCP (mcp/assistante.ts), avec les mêmes validations, le même verrou et la même
 * garde de concurrence (`connu`, `empreinteConnue`, `attendu`). Deux différences voulues : l'origine consignée est
 * « interface », et une poussée est refusée pendant un appel. La confirmation se fait dans la page, sur la question et
 * la différence rédigées ici. Le prompt ne s'écrit que par Claude Code (modifier_prompt_assistante).
 *
 * Chaque geste d'écriture laisse sa trace au journal des gestes (ADR 0016), d'origine « interface », sous le nom de
 * l'outil du MCP qui fait la même chose et au même format : pour un geste confirmé dans la page, une ligne
 * `confirmation-demandee` (la question lue) puis la ligne du résultat, avec l'accord de l'opérateur. Sans la première,
 * rien ne part. Une préparation (question, différence) ne fait que lire : elle n'est pas journalisée.
 *
 * Les fonctions prennent les options du MCP (`client`, `dossier`) : les tests injectent un faux ElevenLabs et un
 * `agent/` jetable ; les actions serveur (app/assistante/actions.ts) passent les valeurs par défaut de `.env`.
 */

export type OptionsAgent = { client?: ClientAgent | null; dossier?: string };
export type Resultat<T extends object = object> = ({ ok: true } & T) | { ok: false; raison: string };

/** Les refus et rappels de la bibliothèque nomment les outils du MCP : la page dit le geste qui lui correspond. */
const POUR_LA_PAGE: [string, string][] = [
  [' : relis avec lire_assistante.', ' : recharge la page.'],
  ['rapatrier_assistante d’abord.', 'rapatrie-la d’abord.'],
  ['Le MCP ne tranche pas : au terminal,', 'La page ne tranche pas : au terminal,'],
  ['historique_assistante liste celles qui le sont.', 'l’historique liste celles qui le sont.'],
  ['puis pousser_assistante pour que les appels l’utilisent.', 'puis pousse-la pour que les appels l’utilisent.'],
  ['avant pousser_assistante.', 'avant la poussée.'],
];

export function pourLaPage(texte: string): string {
  return POUR_LA_PAGE.reduce((t, [mcp, page]) => t.replaceAll(mcp, page), texte);
}

const refus = (raison: string) => ({ ok: false as const, raison: pourLaPage(raison) });

const messageDe = (erreur: unknown) => (erreur instanceof Error ? erreur.message : String(erreur));

/** Un échec inattendu (ElevenLabs qui répond une erreur, fichier illisible) : dit en une phrase, jamais levé vers la page. */
function echec(erreur: unknown): { ok: false; raison: string } {
  const message = messageDe(erreur);
  return { ok: false, raison: `Échec : ${message.length > 300 ? `${message.slice(0, 300)}…` : message}` };
}

async function sansException<T extends object>(travail: () => Promise<Resultat<T>>): Promise<Resultat<T>> {
  try {
    return await travail();
  } catch (erreur) {
    return echec(erreur);
  }
}

/* ------------------------------------------------------------------ journal des gestes */

/** Les gestes d'écriture de la page, nommés comme l'outil du MCP qui fait la même chose. */
export type GesteAssistante = 'modifier_assistante' | 'modifier_reglages_assistante' | 'pousser_assistante' | 'rapatrier_assistante' | 'restaurer_assistante';

/** Les outils qui changent l'assistante, par le MCP ou par la page : ce que la page montre de ses derniers gestes. */
export const GESTES_SUR_L_ASSISTANTE = [
  'modifier_assistante',
  'modifier_prompt_assistante',
  'modifier_reglages_assistante',
  'pousser_assistante',
  'rapatrier_assistante',
  'restaurer_assistante',
] as const;

export const JOURNAL_INDISPONIBLE = 'Le journal des gestes est indisponible : un geste confirmé ne se fait pas sans trace. Rien n’a été fait.';

/** Ce qu'un geste en cours écrit au journal : ses arguments (complétés en chemin) et le résumé d'un succès. */
interface Carnet {
  arguments: Record<string, unknown>;
  resume?: string;
  /** Écrit la question lue et acceptée par l'opérateur ; faux si le journal la refuse : le geste s'arrête là. */
  confirmer: (question: string) => Promise<boolean>;
}

/**
 * Déroule un geste de la page et le journalise comme mcp/outil.ts un outil : refus avec sa raison, succès avec son
 * résumé, exception avec son détail (la page n'en reçoit qu'une phrase). Après une confirmation, la ligne du résultat
 * porte l'accord de l'opérateur.
 */
async function journaliser<T extends object>(
  outil: GesteAssistante,
  args: Record<string, unknown>,
  travail: (carnet: Carnet) => Promise<Resultat<T>>,
): Promise<Resultat<T>> {
  let confirmation: ConfirmationJournal | null = null;
  let enPanne = false;
  const carnet: Carnet = {
    arguments: args,
    confirmer: async (question) => {
      const ecrite = await noterAuJournal({
        origine: 'interface',
        outil,
        arguments: carnet.arguments,
        resultat: 'confirmation-demandee',
        message: question,
        confirmation: null,
      });
      if (ecrite) confirmation = 'acceptee';
      else enPanne = true;
      return ecrite;
    },
  };
  const noter = (resultat: 'ok' | 'refus' | 'erreur', message: string | null) =>
    noterAuJournal({ origine: 'interface', outil, arguments: carnet.arguments, resultat, message, confirmation });

  let r: Resultat<T>;
  try {
    r = await travail(carnet);
  } catch (erreur) {
    await noter('erreur', messageDe(erreur));
    return echec(erreur);
  }
  // Le journal a refusé la question : il refuserait aussi la ligne du refus.
  if (enPanne) return r;
  await noter(r.ok ? 'ok' : 'refus', r.ok ? (carnet.resume ?? null) : r.raison);
  return r;
}

/** Les cinq derniers gestes faits sur l'assistante, par Claude Code ou par la page, pour la page Assistante. */
export async function derniersGestesAssistante(limite = 5) {
  return journalMcpRecent(limite, { outil: GESTES_SUR_L_ASSISTANTE, sansDemandes: true });
}

/** Le pont raccroche de lui-même à 360 s : un appel « en cours » plus vieux que cela est une ligne périmée. */
const FENETRE_APPEL_EN_COURS_MS = 15 * 60_000;

/** Un vrai appel (téléphone ou navigateur, hors simulation) est-il en cours ? D'après la base, sans joindre le pont. */
export async function appelEnCours(maintenant = new Date()): Promise<boolean> {
  const [a] = await db
    .select({ id: appels.id })
    .from(appels)
    .where(
      and(eq(appels.statut, 'en-cours'), ne(appels.ligne, 'simulation'), gt(appels.debutLe, new Date(maintenant.getTime() - FENETRE_APPEL_EN_COURS_MS))),
    )
    .limit(1);
  return Boolean(a);
}

const REFUS_APPEL_EN_COURS = 'Un appel est en cours : rien ne part vers ElevenLabs pendant qu’il dure. Pousse quand il sera fini.';

/* ------------------------------------------------------------------ lecture */

export interface EditionAssistante {
  reglages: PatchReglages;
  empreinteLocale: string;
  modificationsLocalesNonPoussees: boolean;
  historique: LigneHistoriqueAssistante[];
}

/** Ce que les formulaires de la page affichent : réglages actuels, empreinte de `agent/` et historique. Sans ElevenLabs. */
export async function lireEditionAssistante(o: OptionsAgent = {}): Promise<EditionAssistante> {
  const [configuration, historique] = await Promise.all([lireConfigurationAssistante({ ...o, distante: false }), historiqueAssistante(o)]);
  return {
    reglages: configuration.reglages,
    empreinteLocale: configuration.synchro.empreinteLocale,
    modificationsLocalesNonPoussees: configuration.synchro.modificationsLocalesNonPoussees,
    historique,
  };
}

/* ------------------------------------------------------------------ nom et premier message */

type SaisieIdentite = { nom?: string; premierMessage?: string };

/** La question de la confirmation, rédigée par la même fonction que celle de modifier_assistante. */
export async function preparerIdentite(saisie: SaisieIdentite, connu: string | null): Promise<Resultat<{ lignes: string[] }>> {
  const prep = await preparerModificationAssistante(saisie, { connu, relire: 'recharge la page' });
  if (!prep.ok) return refus(prep.raison);
  return { ok: true, lignes: prep.lignes };
}

/**
 * Après la confirmation : revalide la saisie et la lecture (`connu`) comme modifier_assistante, puis écrit, d'origine
 * « interface ». Le rappel sur le libellé du tableau de bord est celui du MCP, avec le geste de la page.
 */
export async function enregistrerIdentite(
  saisie: SaisieIdentite,
  connu: string | null,
  o: OptionsAgent = {},
): Promise<Resultat<{ modifieLe: string; rappel: string }>> {
  return journaliser('modifier_assistante', { ...saisie }, async (carnet) => {
    const prep = await preparerModificationAssistante(saisie, { connu, relire: 'recharge la page' });
    if (!prep.ok) return refus(prep.raison);
    // L'ancien et le nouveau texte de ce qui change seulement : un prénom d'assistante et un modèle de phrase.
    carnet.arguments = {
      ...(prep.changement.nom !== undefined ? { nomAvant: prep.actuelle.nom, nom: prep.changement.nom } : {}),
      ...(prep.changement.premierMessage !== undefined
        ? { premierMessageAvant: prep.actuelle.premierMessage, premierMessage: prep.changement.premierMessage }
        : {}),
    };
    if (!(await carnet.confirmer(prep.lignes.join(' ')))) return refus(JOURNAL_INDISPONIBLE);
    const r = await modifierAssistante(prep.changement, { origine: 'interface', connu: prep.actuelle.modifieLe?.toISOString() ?? null });
    if (!r.ok) return refus(r.raison);
    let libelle: string | undefined;
    try {
      libelle = (await lireConfigurationAssistante({ ...o, distante: false })).reglages.libelleTableauDeBord;
    } catch {
      libelle = undefined;
    }
    return {
      ok: true,
      modifieLe: r.modifieLe.toISOString(),
      rappel: `Le changement vaut dès le prochain appel.${
        prep.changement.nom !== undefined && libelle
          ? ` Le libellé du tableau de bord ElevenLabs reste « ${libelle} » : il se change dans les réglages ci-dessous, puis par une poussée.`
          : ''
      }`,
    };
  });
}

/* ------------------------------------------------------------------ réglages de la liste fermée */

const valeurDe = (objet: unknown, cle: string): unknown =>
  cle.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), objet);

/**
 * Pour le journal : chaque réglage saisi, avec sa valeur dans `agent/` avant l'écriture. Des réglages de voix et de
 * tour de parole : rien de personnel. Si `agent/` ne se lit pas, l'écriture le dira : la saisie seule est gardée.
 */
async function argumentsDeReglages(patch: PatchReglages, o: OptionsAgent): Promise<Record<string, unknown>> {
  let avant: PatchReglages;
  try {
    avant = (await lireConfigurationAssistante({ ...o, distante: false })).reglages;
  } catch {
    return { reglages: patch };
  }
  const changements: Record<string, { avant: unknown; apres: unknown }> = {};
  for (const { cle } of REGLAGES_MODIFIABLES) {
    const apres = valeurDe(patch, cle);
    if (apres !== undefined) changements[cle] = { avant: valeurDe(avant, cle) ?? null, apres };
  }
  return { changements };
}

/** Écrit `agent/mina.config.json` comme modifier_reglages_assistante : mêmes bornes, même garde (`empreinteConnue`). */
export async function enregistrerReglagesAssistante(
  patch: PatchReglages,
  empreinteConnue: string,
  o: OptionsAgent = {},
): Promise<Resultat<{ empreinteLocale: string; champs: string[]; rappel: string; avertissement?: string }>> {
  return journaliser('modifier_reglages_assistante', { reglages: patch }, async (carnet) => {
    carnet.arguments = await argumentsDeReglages(patch, o);
    const r = await modifierReglagesAssistante(patch, empreinteConnue, o);
    if (!r.ok) return refus(r.raison);
    return {
      ok: true,
      empreinteLocale: r.empreinteLocale,
      champs: r.champs,
      rappel: pourLaPage(r.rappel),
      ...(r.avertissement ? { avertissement: pourLaPage(r.avertissement) } : {}),
    };
  });
}

/* ------------------------------------------------------------------ poussée et rapatriement */

export type Attendu = { empreinteLocale: string; versionIdDistante: string | null };

/**
 * Ce qu'une poussée changerait, rédigé par le serveur, avec les refus de pousser_assistante (rien à pousser, champ hors
 * de la liste, différence trop longue) et celui de la page : pas pendant un appel.
 */
type Preparation = { question: string; difference: string; campagneEnCours: boolean; attendu: Attendu };

/** Lit ElevenLabs et rédige la question d'une poussée, avec les refus de pousser_assistante et celui de la page. */
async function lirePoussee(o: OptionsAgent): Promise<Resultat<Preparation>> {
  if (await appelEnCours()) return refus(REFUS_APPEL_EN_COURS);
  const prep = await preparerPousseeAssistante(o);
  if (!prep.ok) return refus(prep.raison);
  if (prep.rien) return refus('Rien à pousser : agent/ est identique à la configuration ElevenLabs.');
  if (prep.horsListe.length) return refus(`Ces champs se poussent par \`pnpm agent push\`, après relecture du code : ${prep.horsListe.join(', ')}.`);
  if (prep.tropLong) return refus('La différence dépasse 4 000 caractères : relis `git diff agent/` et pousse par `pnpm agent push`.');
  return {
    ok: true,
    question: `Pousser vers ElevenLabs la configuration de l’assistante. Elle servira dès le prochain appel${prep.campagneEnCours ? ', y compris dans la campagne en cours' : ''}.`,
    difference: prep.diff,
    campagneEnCours: prep.campagneEnCours,
    attendu: prep.attendu,
  };
}

/**
 * Ce qu'une poussée changerait, rédigé par le serveur, avec les refus de pousser_assistante (rien à pousser, champ hors
 * de la liste, différence trop longue) et celui de la page : pas pendant un appel. Une lecture : pas de journal.
 */
export async function preparerPoussee(o: OptionsAgent = {}): Promise<Resultat<Preparation>> {
  return sansException(() => lirePoussee(o));
}

/**
 * Après la confirmation sur la différence : relit ElevenLabs, garde au journal la question que l'opérateur a lue
 * (celle du MCP : phrase et différence), puis pousse si rien n'a bougé depuis (`attendu`), consigné « interface ».
 */
export async function pousser(
  attendu: Attendu,
  o: OptionsAgent = {},
): Promise<Resultat<{ versionAvant: string | null; versionApres: string | null; rappel: string }>> {
  return journaliser('pousser_assistante', { versionDistante: attendu.versionIdDistante }, async (carnet) => {
    const prep = await lirePoussee(o);
    if (!prep.ok) return prep;
    if (prep.attendu.empreinteLocale !== attendu.empreinteLocale || prep.attendu.versionIdDistante !== attendu.versionIdDistante) {
      return refus('La configuration a changé depuis la question : rien n’est parti, relis la différence.');
    }
    if (!(await carnet.confirmer(`${prep.question}\n\n${POUSSEE.difference}\n${prep.difference}`))) return refus(JOURNAL_INDISPONIBLE);
    const r = await pousserAssistante({ ...o, attendu, origine: 'interface' });
    if (!r.ok) return refus(r.raison);
    carnet.resume = `version ${r.versionAvant ?? '?'} → ${r.versionApres ?? '?'}`;
    return { ok: true, versionAvant: r.versionAvant, versionApres: r.versionApres, rappel: pourLaPage(r.rappel) };
  });
}

/** Réécrit `agent/` d'après ElevenLabs, comme rapatrier_assistante : refusé s'il reste des modifications non poussées. */
export async function rapatrier(o: OptionsAgent = {}): Promise<Resultat<{ versionId: string | null; rappel: string }>> {
  return journaliser('rapatrier_assistante', {}, async (carnet) => {
    if (!(await carnet.confirmer(`${RAPATRIEMENT.question} ${RAPATRIEMENT.explication}`))) return refus(JOURNAL_INDISPONIBLE);
    const r = await rapatrierAssistante(o);
    if (!r.ok) return refus(r.raison);
    carnet.resume = `version ${r.versionId ?? '?'}`;
    return { ok: true, versionId: r.versionId, rappel: pourLaPage(r.rappel) };
  });
}

/* ------------------------------------------------------------------ historique et retour arrière */

/** Une version consignée et ce qui la sépare des fichiers de `agent/`, pour la confirmation d'une restauration. */
export async function detailVersion(
  versionId: string,
  o: OptionsAgent = {},
): Promise<Resultat<{ versionId: string; difference: string; appels: number; identique: boolean }>> {
  return sansException(async () => {
    const v = await versionAssistante(versionId, o);
    if (!v) return refus('Cette version n’est pas consignée : historique_assistante liste celles qui le sont.');
    const identique = v.differenceAvecLocal === 'Identique aux fichiers de agent/.';
    return { ok: true, versionId: v.versionId, difference: v.differenceAvecLocal, appels: v.appels, identique };
  });
}

/** Réécrit `agent/` depuis une version consignée, comme restaurer_assistante ; elle ne sert aux appels qu'après une poussée. */
export async function restaurer(versionId: string, o: OptionsAgent = {}): Promise<Resultat<{ empreinteLocale: string; rappel: string }>> {
  return journaliser('restaurer_assistante', { versionId }, async (carnet) => {
    // La question lue par l'opérateur, relue ici : la version, et ce que la restauration défait.
    const detail = await detailVersion(versionId, o);
    if (!detail.ok) return detail;
    const question = [
      `${RESTAURATION.question} Version ${versionId}.`,
      RESTAURATION.explication,
      detail.identique ? RESTAURATION.identique : `${RESTAURATION.difference}\n${detail.difference}`,
    ].join('\n\n');
    if (!(await carnet.confirmer(question))) return refus(JOURNAL_INDISPONIBLE);
    const r = await restaurerAssistante(versionId, o);
    if (!r.ok) return refus(r.raison);
    return { ok: true, empreinteLocale: r.empreinteLocale, rappel: pourLaPage(r.rappel) };
  });
}
