import { DateTime } from 'luxon';
import { z } from 'zod';
import type { IssueSysteme } from './issues.ts';

/**
 * Le bilan d'un appel, produit par un LLM à partir de la transcription (ADR 0005) puis validé ici.
 * La validation ne fait confiance à rien : chaque objection doit citer mot pour mot une phrase du
 * prospect, sinon le bilan est refusé.
 */

export interface TourDeParole {
  role: 'agent' | 'prospect';
  texte: string;
  /** Position dans l'enregistrement, pour synchroniser la transcription et l'audio. */
  secondes: number;
}

export interface ContexteBilan {
  transcription: TourDeParole[];
  nombreEtapes: number;
  objectionIds: string[];
  /** Issues permises pour cette entreprise : clé (issue système ou `perso:<id>`) et issue système de rattachement. */
  issues: { cle: string; systeme: IssueSysteme }[];
  /** Un rendez-vous a-t-il été réellement réservé pendant l'appel ? Absent quand on ne peut pas le savoir. */
  rendezVousReserve?: boolean;
  /** Début de l'appel : une date de rappel antérieure est refusée. Absent quand on ne le sait pas. */
  debutAppel?: Date;
}

/** Les rappels datés se lisent et s'écrivent à l'heure de Paris, celle de l'opérateur et des prospects. */
export const FUSEAU_RAPPEL = 'Europe/Paris';

/** « Jeudi matin », « jeudi après-midi » : l'heure retenue pour trier et pour dire quand rappeler. */
export const HEURES_MOMENT = { matin: '09:00', 'apres-midi': '14:00' } as const;
export type MomentRappel = keyof typeof HEURES_MOMENT;

/** Au-delà, une date de rappel est tenue pour une erreur d'année plutôt que pour un vrai rendez-vous. */
const HORIZON_RAPPEL_JOURS = 400;

const schemaRappelDate = z
  .strictObject({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date attendue au format AAAA-MM-JJ')
      .describe('Le jour convenu, AAAA-MM-JJ, calculé depuis la date de l’appel (« jeudi » : le prochain jeudi).'),
    heure: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'heure attendue au format HH:MM')
      .nullable()
      .describe('L’heure dite par le prospect, HH:MM à l’heure de Paris ; null s’il n’a donné qu’un moment de la journée ou seulement le jour.'),
    moment: z
      .enum(['matin', 'apres-midi'])
      .nullable()
      .describe('matin ou apres-midi quand le prospect a dit « le matin », « dans l’après-midi » sans heure ; null sinon.'),
  })
  .describe('Le moment du rappel, heure de Paris.');

export type RappelDate = z.infer<typeof schemaRappelDate>;

/** L'instant d'un rappel daté : l'heure dite, sinon 9 h le matin, 14 h l'après-midi, 9 h pour un jour seul. */
export function instantDuRappel(rappel: RappelDate): Date {
  const heure = rappel.heure ?? HEURES_MOMENT[rappel.moment ?? 'matin'];
  return DateTime.fromISO(`${rappel.date}T${heure}`, { zone: FUSEAU_RAPPEL }).toJSDate();
}

/** La précision du rappel : une heure, une demi-journée ou seulement le jour. */
export function precisionDuRappel(rappel: RappelDate): 'heure' | 'demi-journee' | 'jour' {
  return rappel.heure ? 'heure' : rappel.moment ? 'demi-journee' : 'jour';
}

const TEMPS_CRAC = ['creuser', 'reformuler', 'argumenter', 'controler'] as const;

export const schemaBilan = z.strictObject({
  issue: z.string().describe('La clé de l’issue la plus précise parmi celles permises.'),
  etapeAtteinte: z.int().min(0).describe('Numéro de la dernière étape du script atteinte, 0 si aucune.'),
  objections: z
    .array(
      z.strictObject({
        objectionId: z.string().nullable().describe('Identifiant de l’objection répertoriée, ou null si elle est nouvelle.'),
        libelle: z.string().min(1).max(160).describe('L’objection en une phrase courte, comme un prospect la dirait.'),
        levee: z.boolean(),
        tempsBloquant: z.enum(TEMPS_CRAC).nullable().describe('Le temps CRAC où ça a coincé, null si levée.'),
        citation: z.string().min(3).describe('Les mots exacts du prospect qui expriment l’objection.'),
      }),
    )
    .max(8),
  resume: z.string().min(1).max(600).describe('Trois phrases au plus.'),
  pointsForts: z.array(z.string().min(1)).max(2),
  pointsFaibles: z.array(z.string().min(1)).max(2),
  rappel: z.string().nullable().describe('Le moment convenu pour rappeler, seulement si l’issue est un rappel convenu.'),
  // Optionnel : les bilans antérieurs n'ont pas ce champ et restent valides.
  rappelLe: schemaRappelDate
    .nullable()
    .optional()
    .describe('Le moment du rappel en date, seulement quand le prospect en a donné un (jour, et heure ou moment de la journée) ; null sinon.'),
});

export type Bilan = z.infer<typeof schemaBilan>;

export type ValidationBilan = { ok: true; bilan: Bilan } | { ok: false; erreurs: string[] };

function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFC')
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();
}

export function validerBilan(brut: unknown, contexte: ContexteBilan): ValidationBilan {
  const forme = schemaBilan.safeParse(brut);
  if (!forme.success) {
    return { ok: false, erreurs: forme.error.issues.map((i) => `${i.path.join('.') || 'bilan'} : ${i.message}`) };
  }
  const bilan = forme.data;
  const erreurs: string[] = [];

  const issue = contexte.issues.find((i) => i.cle === bilan.issue);
  if (!issue) erreurs.push(`issue « ${bilan.issue} » inconnue ; permises : ${contexte.issues.map((i) => i.cle).join(', ')}`);

  if (bilan.etapeAtteinte > contexte.nombreEtapes) {
    erreurs.push(`etapeAtteinte ${bilan.etapeAtteinte} dépasse les ${contexte.nombreEtapes} étapes du script`);
  }

  const parolesProspect = normaliser(
    contexte.transcription
      .filter((t) => t.role === 'prospect')
      .map((t) => t.texte)
      .join(' \n '),
  );
  for (const objection of bilan.objections) {
    if (objection.objectionId !== null && !contexte.objectionIds.includes(objection.objectionId)) {
      erreurs.push(`objection « ${objection.objectionId} » inconnue`);
    }
    if (!parolesProspect.includes(normaliser(objection.citation))) {
      erreurs.push(`citation absente des paroles du prospect : « ${objection.citation} »`);
    }
  }

  if (issue?.systeme === 'rendez-vous-pris' && contexte.rendezVousReserve === false) {
    erreurs.push('aucun rendez-vous n’a été réservé pendant cet appel : si un moment a été convenu à l’oral, c’est un rappel convenu');
  }

  const estRappel = issue?.systeme === 'rappel-convenu';
  if (estRappel && !bilan.rappel) erreurs.push('rappel manquant : l’issue est un rappel convenu');
  if (!estRappel && bilan.rappel) erreurs.push('rappel renseigné alors que l’issue n’est pas un rappel convenu');
  if (bilan.rappelLe) erreurs.push(...erreursRappelDate(bilan.rappelLe, { estRappel, contexte }));

  return erreurs.length ? { ok: false, erreurs } : { ok: true, bilan };
}

function erreursRappelDate(rappel: RappelDate, { estRappel, contexte }: { estRappel: boolean; contexte: ContexteBilan }): string[] {
  if (!estRappel) return ['rappelLe renseigné alors que l’issue n’est pas un rappel convenu'];
  if (rappel.heure && rappel.moment) return ['rappelLe : heure ou moment, pas les deux'];
  const jour = DateTime.fromISO(rappel.date, { zone: FUSEAU_RAPPEL });
  if (!jour.isValid) return [`rappelLe : la date ${rappel.date} n’existe pas`];
  if (!contexte.debutAppel) return [];
  const appel = DateTime.fromJSDate(contexte.debutAppel, { zone: FUSEAU_RAPPEL });
  if (rappel.date < appel.toISODate()!) return [`rappelLe : le ${rappel.date} est antérieur à l’appel (${appel.toISODate()})`];
  if (rappel.heure && instantDuRappel(rappel) <= contexte.debutAppel) return [`rappelLe : ${rappel.date} ${rappel.heure} est antérieur à l’appel`];
  if (jour.diff(appel.startOf('day'), 'days').days > HORIZON_RAPPEL_JOURS) return [`rappelLe : le ${rappel.date} est à plus d’un an de l’appel`];
  return [];
}

/** Schéma JSON du bilan, pour contraindre la sortie du LLM. */
export function schemaJsonBilan(): object {
  // Sans la clé $schema : le validateur de `claude --json-schema` ne résout pas la méta-référence.
  const { $schema: _, ...schema } = z.toJSONSchema(schemaBilan, { target: 'draft-2020-12' });
  // rappelLe est optionnel à la lecture (bilans antérieurs), mais le modèle le rend toujours, null s'il n'y a
  // pas de date : comme rappel, requis et nullable, pour les validateurs qui exigent toutes les propriétés.
  const requis = Array.isArray(schema.required) ? schema.required : [];
  return { ...schema, required: [...new Set([...requis, 'rappelLe'])] };
}
