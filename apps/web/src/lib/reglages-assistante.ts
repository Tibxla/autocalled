import { z } from 'zod';

/**
 * Les réglages ElevenLabs de l'assistante qui se modifient hors du code (ADR 0010) : une liste fermée, ses bornes et
 * leur place dans `agent/mina.config.json`. Sans dépendance serveur : le serveur MCP, les actions de la page Assistante
 * (par lib/configuration-assistante.ts, seul à écrire) et son formulaire, qui prévient avant l'envoi, partagent ces
 * mêmes bornes. Tout autre champ se change par le code et `pnpm agent push`.
 */

const unite = (message: string) => z.number({ error: 'Un nombre est attendu.' }).min(0, message).max(1, message);
const courte = (max: number) => z.string({ error: 'Un texte est attendu.' }).trim().min(1, 'Un texte est attendu.').max(max, `${max} caractères au plus.`);
const langue = z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/, 'Un code de langue, par exemple fr ou en.');
const expressions = z.array(z.strictObject({ tag: courte(50).regex(/^[a-zA-Z][a-zA-Z _-]*$/, 'Une balise d’expression en anglais, sans crochets.'), description: courte(500) })).max(32, 'Trente-deux expressions au plus.');
const caseSchema = z.boolean({ error: 'Vrai ou faux.' });

/** Les bornes de chaque réglage que le MCP sait écrire. */
export const BORNES = {
  langue,
  expressions,
  case: caseSchema,
  languesMotsIgnores: z.array(langue).max(20, 'Vingt langues au plus.'),
  nombreRelances: z.number().int('Un entier est attendu.').min(0, 'Entre 0 et 5.').max(5, 'Entre 0 et 5.'),
  llm: z.string().regex(/^[a-z0-9._-]{1,60}$/, 'Un identifiant de modèle : 1 à 60 caractères a-z, 0-9, . _ -.'),
  temperature: unite('Entre 0 et 1.'),
  voiceId: z.string().regex(/^[A-Za-z0-9]{10,40}$/, 'Un identifiant de voix ElevenLabs : 10 à 40 lettres ou chiffres.'),
  modeleVoix: z.string().regex(/^eleven_[a-z0-9_]+$/, 'Un modèle de voix eleven_….'),
  stabilite: unite('Entre 0 et 1.'),
  similarite: unite('Entre 0 et 1.'),
  vitesse: z.number({ error: 'Un nombre est attendu.' }).min(0.7, 'Entre 0,7 et 1,2.').max(1.2, 'Entre 0,7 et 1,2.'),
  empressement: z.enum(['patient', 'normal', 'eager'], { error: 'patient, normal ou eager.' }),
  delaiSilenceS: z.number({ error: 'Un nombre est attendu.' }).min(1, 'Entre 1 et 30 s.').max(30, 'Entre 1 et 30 s.'),
  speculatif: z.boolean({ error: 'Vrai ou faux.' }),
  motsIgnores: z.array(courte(30)).max(50, 'Cinquante mots au plus.'),
  premiereRelance: courte(40),
  relancesSuivantes: z.array(courte(40)).max(5, 'Cinq relances au plus.'),
  delaiRelancesS: z.number({ error: 'Un nombre est attendu.' }).min(0.5, 'Entre 0,5 et 5 s.').max(5, 'Entre 0,5 et 5 s.'),
  // Le pont raccroche de lui-même à 360 s (DUREE_MAX_S) : la fin voulue par l'assistante doit venir avant.
  dureeMaxS: z.number({ error: 'Un nombre est attendu.' }).int('Un nombre entier de secondes.').min(60, 'Entre 60 et 330 s.').max(330, 'Entre 60 et 330 s.'),
  libelle: courte(60).min(2, 'Deux caractères au moins.'),
};

/** Les réglages ElevenLabs que le MCP sait écrire. Tout le reste se change par le code et `pnpm agent push`. */
export const REGLAGES_MODIFIABLES: readonly { cle: string; chemin: string; schema: z.ZodType }[] = [
  { cle: 'langue', chemin: 'conversation_config.agent.language', schema: BORNES.langue },
  { cle: 'llm', chemin: 'conversation_config.agent.prompt.llm', schema: BORNES.llm },
  { cle: 'temperature', chemin: 'conversation_config.agent.prompt.temperature', schema: BORNES.temperature },
  { cle: 'voix.voiceId', chemin: 'conversation_config.tts.voice_id', schema: BORNES.voiceId },
  { cle: 'voix.modele', chemin: 'conversation_config.tts.model_id', schema: BORNES.modeleVoix },
  { cle: 'voix.stabilite', chemin: 'conversation_config.tts.stability', schema: BORNES.stabilite },
  { cle: 'voix.similarite', chemin: 'conversation_config.tts.similarity_boost', schema: BORNES.similarite },
  { cle: 'voix.vitesse', chemin: 'conversation_config.tts.speed', schema: BORNES.vitesse },
  { cle: 'voix.expressif', chemin: 'conversation_config.tts.expressive_mode', schema: BORNES.case },
  { cle: 'voix.expressions', chemin: 'conversation_config.tts.suggested_audio_tags', schema: BORNES.expressions },
  { cle: 'tour.empressement', chemin: 'conversation_config.turn.turn_eagerness', schema: BORNES.empressement },
  { cle: 'tour.delaiSilenceS', chemin: 'conversation_config.turn.turn_timeout', schema: BORNES.delaiSilenceS },
  { cle: 'tour.speculatif', chemin: 'conversation_config.turn.speculative_turn', schema: BORNES.speculatif },
  { cle: 'tour.motsIgnores', chemin: 'conversation_config.turn.interruption_ignore_terms', schema: BORNES.motsIgnores },
  { cle: 'tour.languesMotsIgnores', chemin: 'conversation_config.turn.interruption_ignore_term_languages', schema: BORNES.languesMotsIgnores },
  { cle: 'tour.fusionMotsParDefaut', chemin: 'conversation_config.turn.merge_with_default_ignore_terms', schema: BORNES.case },
  { cle: 'relances.premiere', chemin: 'conversation_config.turn.soft_timeout_config.message', schema: BORNES.premiereRelance },
  {
    cle: 'relances.suivantes',
    chemin: 'conversation_config.turn.soft_timeout_config.additional_soft_timeout_messages',
    schema: BORNES.relancesSuivantes,
  },
  { cle: 'relances.delaiS', chemin: 'conversation_config.turn.soft_timeout_config.timeout_seconds', schema: BORNES.delaiRelancesS },
  { cle: 'relances.genererParModele', chemin: 'conversation_config.turn.soft_timeout_config.use_llm_generated_message', schema: BORNES.case },
  { cle: 'relances.aleatoires', chemin: 'conversation_config.turn.soft_timeout_config.randomize_fillers', schema: BORNES.case },
  { cle: 'relances.nombreMax', chemin: 'conversation_config.turn.soft_timeout_config.max_soft_timeouts_per_generation', schema: BORNES.nombreRelances },
  { cle: 'relances.desactiverAvantPremierMessage', chemin: 'conversation_config.turn.soft_timeout_config.disable_until_first_user_message', schema: BORNES.case },
  { cle: 'dureeMaxS', chemin: 'conversation_config.conversation.max_duration_seconds', schema: BORNES.dureeMaxS },
  { cle: 'libelleTableauDeBord', chemin: 'name', schema: BORNES.libelle },
];

/** Les réglages modifiables, regroupés comme ils se lisent : `{ voix: { vitesse: 1 } }`. Chaque clé est facultative. */
export const patchReglagesSchema = z.strictObject({
  langue: BORNES.langue.optional(),
  llm: BORNES.llm.optional(),
  temperature: BORNES.temperature.optional(),
  voix: z
    .strictObject({
      voiceId: BORNES.voiceId.optional(),
      modele: BORNES.modeleVoix.optional(),
      stabilite: BORNES.stabilite.optional(),
      similarite: BORNES.similarite.optional(),
      vitesse: BORNES.vitesse.optional(),
      expressif: BORNES.case.optional(),
      expressions: BORNES.expressions.optional(),
    })
    .optional(),
  tour: z
    .strictObject({
      empressement: BORNES.empressement.optional(),
      delaiSilenceS: BORNES.delaiSilenceS.optional(),
      speculatif: BORNES.speculatif.optional(),
      motsIgnores: BORNES.motsIgnores.optional(),
      languesMotsIgnores: BORNES.languesMotsIgnores.optional(),
      fusionMotsParDefaut: BORNES.case.optional(),
    })
    .optional(),
  relances: z
    .strictObject({
      premiere: BORNES.premiereRelance.optional(),
      suivantes: BORNES.relancesSuivantes.optional(),
      delaiS: BORNES.delaiRelancesS.optional(),
      genererParModele: BORNES.case.optional(),
      aleatoires: BORNES.case.optional(),
      nombreMax: BORNES.nombreRelances.optional(),
      desactiverAvantPremierMessage: BORNES.case.optional(),
    })
    .optional(),
  dureeMaxS: BORNES.dureeMaxS.optional(),
  libelleTableauDeBord: BORNES.libelle.optional(),
});
export type PatchReglages = z.infer<typeof patchReglagesSchema>;
