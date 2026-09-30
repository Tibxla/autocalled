import 'server-only';
import { VARIABLES_DE_L_APPEL, type VariablesDeLAppel } from '@autocalled/domain';
import { and, countDistinct, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { assistante, campagnes, consentements, type Origine, type OrigineVersionAssistante, versionsAssistante } from '@/db/schema';
import { auteurEtMoment, type Conflit, type Ecriture, type Refus } from './entreprises';

/**
 * Ce que l'application envoie à l'assistante avec chaque appel et qui vaut dès l'appel suivant, sans poussée
 * vers ElevenLabs : son nom et son premier message (ADR 0010). Base seulement : importable par les pages, le
 * serveur MCP et les scripts. Le prompt et la configuration ElevenLabs vivent dans `agent/`
 * (lib/configuration-assistante.ts, que seules la page Assistante et ses actions importent côté interface).
 */

export const ASSISTANTE_PAR_DEFAUT = { nom: 'Mina', premierMessage: 'Allô ?' } as const;

/** Au-delà, le pont ignore le premier message et dit « Allô ? » (apps/pont/pont/appel.py). */
export const LONGUEUR_MAX_PREMIER_MESSAGE_COMPOSE = 300;

const VARIABLES_CONNUES = new Set<string>(VARIABLES_DE_L_APPEL);

/** Un ou deux mots faits de lettres, joints par une espace, une apostrophe ou un trait d'union : « Mina », « Anne-Sophie ». */
export const nomAssistanteSchema = z
  .string({ error: 'Un nom est attendu.' })
  .trim()
  .min(2, 'Deux lettres au moins.')
  .max(24, 'Vingt-quatre caractères au plus.')
  .regex(/^\p{L}+(?:[ '’-]\p{L}+)?$/u, 'Un prénom d’un ou deux mots, fait de lettres seulement.');

/** Une phrase sur une ligne ; ses `{{variables}}` sont celles que l'application envoie à chaque appel. */
export const premierMessageSchema = z
  .string({ error: 'Une phrase est attendue.' })
  .trim()
  .min(1, 'Le premier message ne peut pas être vide.')
  .max(160, 'Cent soixante caractères au plus.')
  .refine((t) => !/[\r\n]/.test(t), 'Une seule ligne.')
  .superRefine((t, ctx) => {
    const inconnues = [...t.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] as string).filter((v) => !VARIABLES_CONNUES.has(v));
    if (inconnues.length) {
      ctx.addIssue({
        code: 'custom',
        message: `Variables inconnues : ${[...new Set(inconnues)].map((v) => `{{${v}}}`).join(', ')}. Permises : ${VARIABLES_DE_L_APPEL.join(', ')}.`,
      });
    }
  });

export interface Assistante {
  nom: string;
  premierMessage: string;
  /** Null tant que rien n'a été enregistré (valeurs par défaut). */
  modifieLe: Date | null;
  modifiePar: Origine | null;
}

export async function lireAssistante(): Promise<Assistante> {
  const [ligne] = await db.select().from(assistante).where(eq(assistante.id, 1));
  if (!ligne) return { ...ASSISTANTE_PAR_DEFAUT, modifieLe: null, modifiePar: null };
  return { nom: ligne.nom, premierMessage: ligne.premierMessage, modifieLe: ligne.modifieLe, modifiePar: ligne.modifiePar };
}

/**
 * Change le nom et/ou le premier message, sauf s'ils ont changé depuis `ecriture.connu` (le `modifieLe` lu, en
 * ISO). Effet dès l'appel suivant : c'est à l'appelant d'obtenir l'accord de l'opérateur avant d'écrire.
 */
export async function modifierAssistante(
  saisie: { nom?: string; premierMessage?: string },
  ecriture: Ecriture,
): Promise<{ ok: true; modifieLe: Date } | Refus | Conflit> {
  if (saisie.nom === undefined && saisie.premierMessage === undefined) {
    return { ok: false, raison: 'Rien à modifier : donne un nom ou un premier message.' };
  }
  const valeurs: { nom?: string; premierMessage?: string } = {};
  if (saisie.nom !== undefined) {
    const nom = nomAssistanteSchema.safeParse(saisie.nom);
    if (!nom.success) return { ok: false, raison: `Nom refusé : ${nom.error.issues[0]?.message}` };
    valeurs.nom = nom.data;
  }
  if (saisie.premierMessage !== undefined) {
    const message = premierMessageSchema.safeParse(saisie.premierMessage);
    if (!message.success) return { ok: false, raison: `Premier message refusé : ${message.error.issues[0]?.message}` };
    valeurs.premierMessage = message.data;
  }

  return db.transaction(async (tx) => {
    const [actuelle] = await tx
      .select({ modifieLe: assistante.modifieLe, modifiePar: assistante.modifiePar })
      .from(assistante)
      .where(eq(assistante.id, 1))
      .for('update');
    if (ecriture.connu != null) {
      if (!actuelle) return { ok: false as const, raison: 'La configuration de l’assistante a changé depuis sa lecture : relis-la.' };
      if (Date.parse(ecriture.connu) !== actuelle.modifieLe.getTime()) {
        return {
          ok: false as const,
          raison: `Assistante modifiée ${auteurEtMoment(actuelle.modifieLe, actuelle.modifiePar)}, depuis que tu l’as lue.`,
          conflit: { le: actuelle.modifieLe, origine: actuelle.modifiePar, jeton: actuelle.modifieLe.toISOString() },
        };
      }
    }
    const modifieLe = new Date();
    await tx
      .insert(assistante)
      .values({ id: 1, ...valeurs, modifieLe, modifiePar: ecriture.origine })
      .onConflictDoUpdate({ target: assistante.id, set: { ...valeurs, modifieLe, modifiePar: ecriture.origine } });
    return { ok: true as const, modifieLe };
  });
}

/** Le texte de consentement v1 nomme « Mina » : combien de numéros ont encore un accord actif donné sur ce texte. */
export async function consentementsActifsV1(): Promise<number> {
  const [r] = await db
    .select({ n: countDistinct(consentements.numero) })
    .from(consentements)
    .where(and(isNull(consentements.revoqueLe), eq(consentements.texteVersion, 1)));
  return Number(r?.n ?? 0);
}

async function campagneEnCours(): Promise<boolean> {
  const [c] = await db.select({ id: campagnes.id }).from(campagnes).where(eq(campagnes.statut, 'en-cours')).limit(1);
  return Boolean(c);
}

export interface PreparationAssistante {
  ok: true;
  actuelle: Assistante;
  /** Ce qui change vraiment, valeurs normalisées : à passer tel quel à `modifierAssistante`. */
  changement: { nom?: string; premierMessage?: string };
  /** La question posée à l'opérateur, phrase par phrase, rédigée ici d'après la base (jamais par un modèle). */
  lignes: string[];
  /** Ce que l'opérateur a vu : le jeton de sa confirmation. */
  jeton: (string | null)[];
}

/**
 * Valide un changement de nom et/ou de premier message et rédige la question à poser à l'opérateur : ancien et
 * nouveau texte, effet dès l'appel suivant (campagne en cours comprise), consentements v1 encore actifs quand le nom
 * change. Refuse une saisie invalide, une lecture périmée (`connu`, le `modifieLe` lu, en ISO) ou un changement nul.
 * Partagé par le serveur MCP (modifier_assistante) et la page Assistante ; `relire` dit comment relire, selon l'endroit.
 */
export async function preparerModificationAssistante(
  saisie: { nom?: string; premierMessage?: string },
  o: { connu?: string | null; relire: string },
): Promise<PreparationAssistante | Refus> {
  const nouveauNom = saisie.nom === undefined ? undefined : nomAssistanteSchema.safeParse(saisie.nom);
  if (nouveauNom && !nouveauNom.success) return { ok: false, raison: `Nom refusé : ${nouveauNom.error.issues[0]?.message}` };
  const nouveauMessage = saisie.premierMessage === undefined ? undefined : premierMessageSchema.safeParse(saisie.premierMessage);
  if (nouveauMessage && !nouveauMessage.success) return { ok: false, raison: `Premier message refusé : ${nouveauMessage.error.issues[0]?.message}` };

  const actuelle = await lireAssistante();
  if (o.connu && actuelle.modifieLe?.getTime() !== Date.parse(o.connu)) {
    return { ok: false, raison: `La configuration de l’assistante a changé depuis ta lecture : ${o.relire}.` };
  }
  const changeNom = nouveauNom?.data !== undefined && nouveauNom.data !== actuelle.nom;
  const changeMessage = nouveauMessage?.data !== undefined && nouveauMessage.data !== actuelle.premierMessage;
  if (!changeNom && !changeMessage) return { ok: false, raison: 'Rien ne change : ce sont déjà le nom et le premier message de l’assistante.' };

  const [enCours, v1] = await Promise.all([campagneEnCours(), changeNom ? consentementsActifsV1() : Promise.resolve(0)]);
  const lignes = [
    changeNom && `Changer le nom de l’assistante : « ${actuelle.nom} » → « ${nouveauNom?.data} ».`,
    changeMessage && `Changer son premier message, dit quand le prospect se tait au décroché : « ${actuelle.premierMessage} » → « ${nouveauMessage?.data} ».`,
    `Les prospects l’entendront dès le prochain appel${enCours ? ', y compris dans la campagne en cours' : ''}, sans autre relecture.`,
    changeNom && v1 > 0 && `${v1} numéro${v1 > 1 ? 's ont' : ' a'} un consentement actif donné sur le texte version 1, qui nomme l’assistante « Mina ».`,
  ].filter((l): l is string => Boolean(l));
  return {
    ok: true,
    actuelle,
    changement: { ...(changeNom ? { nom: nouveauNom?.data } : {}), ...(changeMessage ? { premierMessage: nouveauMessage?.data } : {}) },
    lignes,
    jeton: [
      actuelle.nom,
      actuelle.premierMessage,
      actuelle.modifieLe?.toISOString() ?? null,
      changeNom ? (nouveauNom?.data ?? null) : null,
      changeMessage ? (nouveauMessage?.data ?? null) : null,
    ],
  };
}

/**
 * Le premier message tel que le pont le dira : variables remplacées, sur une ligne. L'application compose la
 * phrase elle-même, pour ne pas dépendre de la substitution d'ElevenLabs dans une surcharge. Vide ou trop long
 * une fois composé (un contexte de fiche entier, par exemple), il redevient « Allô ? ».
 */
export function composerPremierMessage(modele: string, variables: VariablesDeLAppel): string {
  const compose = modele
    .replace(/\{\{(\w+)\}\}/g, (tout, nom: string) => (VARIABLES_CONNUES.has(nom) ? variables[nom as keyof VariablesDeLAppel] : tout))
    .replace(/\s+/g, ' ')
    .trim();
  if (!compose || compose.length > LONGUEUR_MAX_PREMIER_MESSAGE_COMPOSE) return ASSISTANTE_PAR_DEFAUT.premierMessage;
  return compose;
}

/** La dernière configuration ElevenLabs consignée (poussée ou rapatriée par le MCP), pour la page Réglages. */
export async function derniereVersionAssistante(): Promise<{ versionId: string; origine: OrigineVersionAssistante; consigneLe: Date } | null> {
  const [ligne] = await db
    .select({ versionId: versionsAssistante.versionId, origine: versionsAssistante.origine, consigneLe: versionsAssistante.consigneLe })
    .from(versionsAssistante)
    .orderBy(desc(versionsAssistante.consigneLe))
    .limit(1);
  return ligne ?? null;
}
