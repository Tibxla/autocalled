import { ISSUES_SYSTEME } from '@autocalled/domain';
import { z } from 'zod';

/**
 * Règles de saisie partagées par les formulaires de l'interface et le serveur MCP (ADR 0009) : une seule
 * définition, pour qu'aucune des deux portes n'accepte ce que l'autre refuse.
 */

const texte = (max: number) => z.string().trim().max(max, `${max} caractères au plus.`);

export const nomEntrepriseSchema = z
  .string()
  .trim()
  .min(2, 'Donne un nom d’au moins deux lettres.')
  .max(80, 'Quatre-vingts caractères au plus.');

export const ficheSchema = z.object({
  nom: z.string().trim().min(2, 'Deux lettres au moins.').max(80),
  offre: texte(400),
  cible: texte(400),
  arguments: texte(1200),
  prixConsigne: texte(400),
  interdits: texte(600),
  dureeRendezVousMinutes: z.coerce.number().int().min(15).max(120),
  interlocuteur: z.string().trim().max(60, 'Soixante caractères au plus.'),
  delaiMinimumHeures: z.coerce.number().int().min(0, 'Zéro au moins.').max(168, 'Une semaine au plus.'),
  horizonJours: z.coerce.number().int().min(1, 'Un jour au moins.').max(60, 'Soixante jours au plus.'),
});
export type Fiche = z.infer<typeof ficheSchema>;

export const JOURS = [1, 2, 3, 4, 5, 6, 7] as const;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const plagesSchema = z
  .array(
    z
      .object({ jour: z.literal([...JOURS]), debut: z.string(), fin: z.string() })
      .refine((p) => HEURE.test(p.debut) && HEURE.test(p.fin) && p.debut < p.fin, {
        message: 'Chaque jour coché a besoin d’une heure de début avant l’heure de fin.',
      }),
  )
  .refine((plages) => new Set(plages.map((p) => p.jour)).size === plages.length, { message: 'Une seule plage par jour.' });
export type Plages = z.infer<typeof plagesSchema>;

export const objectionSchema = z.object({
  libelle: z.string().trim().min(2, 'Écris l’objection telle qu’un prospect la dirait.').max(160),
  creuser: texte(600),
  reformuler: texte(600),
  argumenter: texte(600),
  controler: texte(600),
});
export type SaisieObjection = z.infer<typeof objectionSchema>;

export const issueSchema = z.object({
  libelle: z.string().trim().min(2, 'Deux lettres au moins.').max(80),
  issueSysteme: z.enum(ISSUES_SYSTEME, 'Choisis l’issue système à laquelle la rattacher.'),
});
export type SaisieIssue = z.infer<typeof issueSchema>;

export const nomScriptSchema = z.string().trim().min(2, 'Deux lettres au moins.').max(80);

export const etapesSchema = z
  .array(
    z.object({
      intention: z.string().trim().min(3, 'Chaque étape a besoin d’une intention.').max(300),
      exemples: z.array(z.string().trim().min(1).max(300)).max(4),
    }),
  )
  .min(1, 'Un script a au moins une étape.')
  .max(10, 'Dix étapes au plus.');

export const campagneSchema = z.object({
  versionScriptId: z.uuid('Choisis une version de script.'),
  ligne: z.enum(['navigateur', 'bluetooth', 'simulation']),
  prospects: z.array(z.string().min(1)).min(1, 'Choisis au moins un prospect.'),
});
export type SaisieCampagne = z.infer<typeof campagneSchema>;
