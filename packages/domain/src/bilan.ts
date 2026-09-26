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
}

const TEMPS_CRAC = ['creuser', 'reformuler', 'argumenter', 'controler'] as const;

export const schemaBilan = z.strictObject({
  issue: z.string().describe('La clé de l’issue la plus précise parmi celles permises.'),
  etapeAtteinte: z.int().min(0).describe('Numéro de la dernière étape du script atteinte, 0 si aucune.'),
  objections: z
    .array(
      z.strictObject({
        objectionId: z.string().nullable().describe('Identifiant de l’objection répertoriée, ou null si elle est nouvelle.'),
        libelle: z.string().min(1),
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

  return erreurs.length ? { ok: false, erreurs } : { ok: true, bilan };
}

/** Schéma JSON du bilan, pour contraindre la sortie du LLM. */
export function schemaJsonBilan(): object {
  // Sans la clé $schema : le validateur de `claude --json-schema` ne résout pas la méta-référence.
  const { $schema: _, ...schema } = z.toJSONSchema(schemaBilan, { target: 'draft-2020-12' });
  return schema;
}
