import { ISSUES_SYSTEME } from '@autocalled/domain';
import { z } from 'zod';

/**
 * Règles de saisie partagées par les formulaires de l'interface et le serveur MCP (ADR 0009) : une seule
 * définition, pour qu'aucune des deux portes n'accepte ce que l'autre refuse. Chaque contrôle a son message
 * en français, jusqu'au type attendu : zod répondrait sinon en anglais.
 */

/** Un texte obligatoire (le type faux compris), coupé de ses blancs. */
const chaine = (manquant = 'Un texte est attendu.') => z.string({ error: manquant }).trim();

const texte = (max: number) => chaine().max(max, `${max} caractères au plus.`);

/**
 * Une seule ligne, sans caractère de contrôle ni de mise en forme invisible : un nom finit dans les questions de
 * confirmation (ADR 0009), où un nom sur plusieurs lignes pourrait imiter une autre question.
 */
const SANS_CONTROLE = /^[^\p{Cc}\p{Cf}\u2028\u2029]*$/u;
const UNE_LIGNE = 'Une seule ligne, sans caractère de contrôle.';
const uneLigne = (max: number) => texte(max).regex(SANS_CONTROLE, UNE_LIGNE);

/** Un entier saisi dans un champ de formulaire (texte converti) ou envoyé tel quel par le serveur MCP. */
const entier = (min: number, max: number, messages: { min: string; max: string }) =>
  z.coerce
    .number({ error: 'Un nombre est attendu.' })
    .int('Un nombre entier, sans virgule.')
    .min(min, messages.min)
    .max(max, messages.max);

export const nomEntrepriseSchema = chaine('Donne un nom à l’entreprise.')
  .min(2, 'Donne un nom d’au moins deux lettres.')
  .max(80, 'Quatre-vingts caractères au plus.')
  .regex(SANS_CONTROLE, UNE_LIGNE);

export const ficheSchema = z.object({
  nom: chaine('Donne un nom à l’entreprise.').min(2, 'Deux lettres au moins.').max(80, 'Quatre-vingts caractères au plus.').regex(SANS_CONTROLE, UNE_LIGNE),
  offre: texte(400),
  cible: texte(400),
  arguments: texte(1200),
  prixConsigne: texte(400),
  interdits: texte(600),
  // Sans valeur par défaut : un formulaire ouvert avant l'arrivée du champ est refusé au lieu de l'effacer.
  complements: texte(1500),
  dureeRendezVousMinutes: entier(15, 120, { min: 'Quinze minutes au moins.', max: 'Deux heures au plus.' }),
  interlocuteur: chaine().max(60, 'Soixante caractères au plus.').regex(SANS_CONTROLE, UNE_LIGNE),
  delaiMinimumHeures: entier(0, 168, { min: 'Zéro au moins.', max: 'Une semaine au plus.' }),
  horizonJours: entier(1, 60, { min: 'Un jour au moins.', max: 'Soixante jours au plus.' }),
});
export type Fiche = z.infer<typeof ficheSchema>;

export const JOURS = [1, 2, 3, 4, 5, 6, 7] as const;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const plagesSchema = z
  .array(
    z
      .object({
        jour: z.literal([...JOURS], 'Le jour va de 1 (lundi) à 7 (dimanche).'),
        debut: chaine('Donne une heure de début (HH:MM).'),
        fin: chaine('Donne une heure de fin (HH:MM).'),
      })
      .refine((p) => HEURE.test(p.debut) && HEURE.test(p.fin) && p.debut < p.fin, {
        message: 'Chaque jour coché a besoin d’une heure de début avant l’heure de fin.',
      }),
    'Les plages sont une liste.',
  )
  .refine((plages) => new Set(plages.map((p) => p.jour)).size === plages.length, { message: 'Une seule plage par jour.' });
export type Plages = z.infer<typeof plagesSchema>;

export const objectionSchema = z.object({
  libelle: chaine('Écris l’objection telle qu’un prospect la dirait.')
    .min(2, 'Écris l’objection telle qu’un prospect la dirait.')
    .max(160, 'Cent soixante caractères au plus.')
    .regex(SANS_CONTROLE, UNE_LIGNE),
  creuser: texte(600),
  reformuler: texte(600),
  argumenter: texte(600),
  controler: texte(600),
});
export type SaisieObjection = z.infer<typeof objectionSchema>;

export const issueSchema = z.object({
  libelle: chaine('Donne un libellé à l’issue.').min(2, 'Deux lettres au moins.').max(80, 'Quatre-vingts caractères au plus.').regex(SANS_CONTROLE, UNE_LIGNE),
  issueSysteme: z.enum(ISSUES_SYSTEME, 'Choisis l’issue système à laquelle la rattacher.'),
});
export type SaisieIssue = z.infer<typeof issueSchema>;

/**
 * Correction d'une fiche prospect, champ par champ (`null` efface un champ facultatif). Les bornes fines (numéro
 * normalisé, adresse, contexte de 500 mots au plus) sont celles de l'import : la fiche corrigée passe par `lireFiche`.
 */
export const patchFicheSchema = z
  .strictObject({
    nom: chaine('Donne le nom du prospect.').min(1, 'Donne le nom du prospect.').max(120, 'Cent vingt caractères au plus.').regex(SANS_CONTROLE, UNE_LIGNE),
    societe: uneLigne(120).nullable(),
    role: uneLigne(120).nullable(),
    telephone: chaine('Donne un numéro de téléphone.').min(1, 'Donne un numéro de téléphone.').max(40, 'Quarante caractères au plus.').regex(SANS_CONTROLE, UNE_LIGNE),
    email: uneLigne(200).nullable(),
    contexte: z.string({ error: 'Un texte est attendu.' }).max(32 * 1024, 'La fiche entière tient en 32 Ko.'),
  })
  .partial()
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'Donne au moins un champ à corriger.');
export type PatchFiche = z.infer<typeof patchFicheSchema>;

export const nomScriptSchema = chaine('Donne un nom au script.')
  .min(2, 'Deux lettres au moins.')
  .max(80, 'Quatre-vingts caractères au plus.')
  .regex(SANS_CONTROLE, UNE_LIGNE);

/** Limites d'une version de script. */
const MAX_ETAPES = 10;
const MAX_FORMULATIONS = 4;
const MAX_CARACTERES = 300;
const MIN_INTENTION = 3;

/**
 * Message d'un contrôle d'étape, précédé de la position que zod lit dans le chemin de l'erreur : « Étape 3 : … »,
 * « Étape 3, formulation 2 : … ». Sans index dans le chemin (étape validée seule), le texte nu, avec une
 * majuscule : l'appelant situe l'étape lui-même.
 */
const aLEtape = (texte: string) => (iss: { path?: PropertyKey[] }) => {
  const chemin = iss.path ?? [];
  const i = chemin.findIndex((p) => typeof p === 'number');
  if (i < 0) return texte.charAt(0).toLocaleUpperCase('fr-FR') + texte.slice(1);
  const rang = chemin[i + 2];
  const formulation = chemin[i + 1] === 'exemples' && typeof rang === 'number' ? `, formulation ${rang + 1}` : '';
  return `Étape ${(chemin[i] as number) + 1}${formulation} : ${texte}`;
};

/** Une étape seule ; `etapesSchema` en fait la liste. */
export const etapeSchema = z.object(
  {
    intention: z
      .string({ error: aLEtape('écris son intention.') })
      .trim()
      .min(MIN_INTENTION, { error: aLEtape('l’intention fait moins de trois caractères.') })
      .max(MAX_CARACTERES, { error: aLEtape(`l’intention dépasse ${MAX_CARACTERES} caractères.`) }),
    exemples: z
      .array(
        z
          .string({ error: aLEtape('une formulation est un texte.') })
          .trim()
          .min(1, { error: aLEtape('formulation vide.') })
          .max(MAX_CARACTERES, { error: aLEtape(`la formulation dépasse ${MAX_CARACTERES} caractères.`) }),
        { error: aLEtape('les formulations sont une liste.') },
      )
      .max(MAX_FORMULATIONS, { error: aLEtape('quatre formulations au plus.') }),
  },
  { error: aLEtape('une étape a une intention et des formulations.') },
);

export const etapesSchema = z
  .array(etapeSchema, 'Les étapes sont une liste.')
  .min(1, 'Un script a au moins une étape.')
  .max(MAX_ETAPES, 'Dix étapes au plus.');

/**
 * Les étapes saisies dans l'éditeur de version (intentions et formulations, une par ligne, dans l'ordre du
 * formulaire). Les étapes entièrement vides sont ignorées. Toutes les erreurs sont gardées, sous la clé
 * `rang:champ` (rang dans le formulaire, à partir de 0) avec la position que voit l'opérateur ; celles de la
 * liste (aucune étape, trop d'étapes) sous `etapes`.
 */
export function verifierEtapes(
  intentions: string[],
  exemples: string[],
): { ok: true; etapes: z.infer<typeof etapesSchema> } | { ok: false; erreurs: Record<string, string> } {
  const saisies = intentions.map((intention, rang) => ({
    rang,
    etape: {
      intention,
      exemples: (exemples[rang] ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    },
  }));
  const remplies = saisies.filter((s) => s.etape.intention.trim() || s.etape.exemples.length);

  const erreurs: Record<string, string> = {};
  for (const { rang, etape } of remplies) {
    const r = etapeSchema.safeParse(etape);
    if (r.success) continue;
    for (const iss of r.error.issues) {
      const champ = iss.path[0] === 'exemples' ? 'exemples' : 'intention';
      const formulation = champ === 'exemples' && typeof iss.path[1] === 'number' ? `, formulation ${iss.path[1] + 1}` : '';
      erreurs[`${rang}:${champ}`] ??= `Étape ${rang + 1}${formulation} : ${iss.message.charAt(0).toLocaleLowerCase('fr-FR')}${iss.message.slice(1)}`;
    }
  }
  const liste = etapesSchema.safeParse(remplies.map((s) => s.etape));
  if (!liste.success) {
    const globale = liste.error.issues.find((iss) => iss.path.length === 0);
    if (globale) erreurs.etapes = globale.message;
  }
  if (Object.keys(erreurs).length > 0 || !liste.success) return { ok: false, erreurs: Object.keys(erreurs).length ? erreurs : { etapes: 'Étapes invalides.' } };
  return { ok: true, etapes: liste.data };
}

export const campagneSchema = z.object({
  versionScriptId: z.uuid('Choisis une version de script.'),
  ligne: z.enum(['navigateur', 'bluetooth', 'simulation'], 'Choisis la ligne : navigateur, téléphone ou simulation.'),
  prospects: z
    .array(z.string('Un prospect est désigné par son identifiant.').min(1, 'Un prospect sans identifiant.'), 'Choisis au moins un prospect.')
    .min(1, 'Choisis au moins un prospect.')
    .max(200, 'Deux cents prospects au plus par campagne.'),
});
export type SaisieCampagne = z.infer<typeof campagneSchema>;
