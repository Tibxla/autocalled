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
  restaurerAssistante,
  versionAssistante,
} from './configuration-assistante';

/**
 * Ce que la page Assistante modifie (décision de l'opérateur du 30/09/2026 : tout, sauf le prompt), par les mêmes
 * fonctions que les outils du serveur MCP (mcp/assistante.ts), avec les mêmes validations, le même verrou et la même
 * garde de concurrence (`connu`, `empreinteConnue`, `attendu`). Deux différences voulues : l'origine consignée est
 * « interface », et une poussée est refusée pendant un appel. La confirmation se fait dans la page, sur la question et
 * la différence rédigées ici. Le prompt ne s'écrit que par Claude Code (modifier_prompt_assistante).
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

/** Un échec inattendu (ElevenLabs qui répond une erreur, fichier illisible) : dit en une phrase, jamais levé vers la page. */
async function sansException<T extends object>(travail: () => Promise<Resultat<T>>): Promise<Resultat<T>> {
  try {
    return await travail();
  } catch (erreur) {
    const message = (erreur as Error).message ?? String(erreur);
    return { ok: false, raison: `Échec : ${message.length > 300 ? `${message.slice(0, 300)}…` : message}` };
  }
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
  const prep = await preparerModificationAssistante(saisie, { connu, relire: 'recharge la page' });
  if (!prep.ok) return refus(prep.raison);
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
}

/* ------------------------------------------------------------------ réglages de la liste fermée */

/** Écrit `agent/mina.config.json` comme modifier_reglages_assistante : mêmes bornes, même garde (`empreinteConnue`). */
export async function enregistrerReglagesAssistante(
  patch: PatchReglages,
  empreinteConnue: string,
  o: OptionsAgent = {},
): Promise<Resultat<{ empreinteLocale: string; champs: string[]; rappel: string; avertissement?: string }>> {
  return sansException(async () => {
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
export async function preparerPoussee(
  o: OptionsAgent = {},
): Promise<Resultat<{ question: string; difference: string; campagneEnCours: boolean; attendu: Attendu }>> {
  return sansException(async () => {
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
  });
}

/** Après la confirmation sur la différence : pousse si rien n'a bougé depuis (`attendu`), consigné « interface ». */
export async function pousser(
  attendu: Attendu,
  o: OptionsAgent = {},
): Promise<Resultat<{ versionAvant: string | null; versionApres: string | null; rappel: string }>> {
  return sansException(async () => {
    if (await appelEnCours()) return refus(REFUS_APPEL_EN_COURS);
    const r = await pousserAssistante({ ...o, attendu, origine: 'interface' });
    if (!r.ok) return refus(r.raison);
    return { ok: true, versionAvant: r.versionAvant, versionApres: r.versionApres, rappel: pourLaPage(r.rappel) };
  });
}

/** Réécrit `agent/` d'après ElevenLabs, comme rapatrier_assistante : refusé s'il reste des modifications non poussées. */
export async function rapatrier(o: OptionsAgent = {}): Promise<Resultat<{ versionId: string | null; rappel: string }>> {
  return sansException(async () => {
    const r = await rapatrierAssistante(o);
    if (!r.ok) return refus(r.raison);
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
  return sansException(async () => {
    const r = await restaurerAssistante(versionId, o);
    if (!r.ok) return refus(r.raison);
    return { ok: true, empreinteLocale: r.empreinteLocale, rappel: pourLaPage(r.rappel) };
  });
}
