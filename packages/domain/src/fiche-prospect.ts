import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { type NumeroE164, normaliserNumero } from './numero.ts';

/**
 * Fiche d'un prospect, lue depuis un fichier Markdown : un en-tête YAML et un contexte libre.
 * L'identité est le nom du fichier : plusieurs prospects peuvent partager un numéro (en démo, tous
 * sonnent sur les mêmes téléphones), donc le numéro ne peut pas servir d'identité.
 */
export interface FicheProspect {
  id: string;
  nom: string;
  societe: string | null;
  role: string | null;
  telephone: NumeroE164;
  /** Adresse où envoyer l'invitation à la visio, si on la connaît. */
  email: string | null;
  /** Injecté tel quel dans le prompt de l'assistante. */
  contexte: string;
}

export type LectureFiche = { ok: true; fiche: FicheProspect } | { ok: false; erreurs: string[] };

/** Au-delà, le prompt s'allonge et chaque réplique de l'assistante arrive plus tard au téléphone. */
export const MOTS_MAX_CONTEXTE = 500;

const NOM_FICHIER = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const EN_TETE = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/;

const enTeteSchema = z.strictObject({
  nom: z.string().trim().min(1),
  telephone: z.string(),
  societe: z.string().trim().min(1).optional(),
  role: z.string().trim().min(1).optional(),
  email: z.email().optional(),
});

function messageErreur(issue: z.core.$ZodIssue): string {
  if (issue.code === 'unrecognized_keys') {
    return `champ inconnu : ${issue.keys.join(', ')} (champs permis : nom, telephone, societe, role, email)`;
  }
  const champ = issue.path.join('.');
  return issue.code === 'invalid_type' && issue.input === undefined
    ? `champ obligatoire manquant : ${champ}`
    : `champ ${champ} invalide`;
}

export function lireFiche(nomFichier: string, contenu: string): LectureFiche {
  const identite = NOM_FICHIER.exec(nomFichier)?.[1];
  if (!identite) {
    return {
      ok: false,
      erreurs: [`nom de fichier invalide : « ${nomFichier} » (minuscules, chiffres et tirets, extension .md)`],
    };
  }

  const texte = contenu.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const decoupe = EN_TETE.exec(texte);
  if (!decoupe) return { ok: false, erreurs: ['en-tête YAML absent : le fichier doit commencer par ---'] };

  let brut: unknown;
  try {
    // Schéma failsafe : toutes les valeurs restent des chaînes, donc 0639980001 garde son zéro.
    brut = parseYaml(decoupe[1] ?? '', { schema: 'failsafe' });
  } catch (erreur) {
    return { ok: false, erreurs: [`en-tête YAML illisible : ${(erreur as Error).message.split('\n')[0]}`] };
  }

  const erreurs: string[] = [];
  const enTete = enTeteSchema.safeParse(brut ?? {});
  if (!enTete.success) erreurs.push(...enTete.error.issues.map(messageErreur));

  // Vérifié à part, pour qu'un nom manquant ne masque pas un numéro invalide.
  const telephoneBrut = (brut as Record<string, unknown> | null)?.telephone;
  const telephone = typeof telephoneBrut === 'string' ? normaliserNumero(telephoneBrut) : null;
  if (typeof telephoneBrut === 'string' && !telephone) erreurs.push(`champ telephone invalide : « ${telephoneBrut} »`);

  const contexte = (decoupe[2] ?? '').trim();
  const mots = contexte.split(/\s+/).filter(Boolean).length;
  if (mots > MOTS_MAX_CONTEXTE) erreurs.push(`contexte trop long : ${mots} mots pour ${MOTS_MAX_CONTEXTE} mots au plus`);

  if (erreurs.length > 0 || !enTete.success || !telephone) return { ok: false, erreurs };

  return {
    ok: true,
    fiche: {
      id: identite,
      nom: enTete.data.nom,
      societe: enTete.data.societe ?? null,
      role: enTete.data.role ?? null,
      telephone,
      email: enTete.data.email ?? null,
      contexte,
    },
  };
}

export interface FichierImporte {
  nomFichier: string;
  contenu: string;
}

export interface LectureFiches {
  fiches: FicheProspect[];
  refus: { nomFichier: string; erreurs: string[] }[];
}

/** Chaque fichier est jugé seul : un fichier refusé n'empêche pas les autres d'entrer. */
export function lireFiches(fichiers: readonly FichierImporte[]): LectureFiches {
  const occurrences = new Map<string, number>();
  for (const { nomFichier } of fichiers) occurrences.set(nomFichier, (occurrences.get(nomFichier) ?? 0) + 1);

  const resultat: LectureFiches = { fiches: [], refus: [] };
  for (const { nomFichier, contenu } of fichiers) {
    if ((occurrences.get(nomFichier) ?? 0) > 1) {
      resultat.refus.push({ nomFichier, erreurs: [`le fichier « ${nomFichier} » apparaît plusieurs fois dans l'import`] });
      continue;
    }
    const lecture = lireFiche(nomFichier, contenu);
    if (lecture.ok) resultat.fiches.push(lecture.fiche);
    else resultat.refus.push({ nomFichier, erreurs: lecture.erreurs });
  }
  return resultat;
}

export interface FusionFiches {
  crees: FicheProspect[];
  misAJour: FicheProspect[];
  inchanges: string[];
}

function identiques(a: FicheProspect, b: FicheProspect): boolean {
  return (
    a.nom === b.nom &&
    a.societe === b.societe &&
    a.role === b.role &&
    a.telephone === b.telephone &&
    a.email === b.email &&
    a.contexte === b.contexte
  );
}

/** Rapproche les fiches importées des prospects existants d'une entreprise, par identité. */
export function fusionnerFiches(
  existantes: readonly FicheProspect[],
  importees: readonly FicheProspect[],
): FusionFiches {
  const parId = new Map(existantes.map((f) => [f.id, f]));
  const resultat: FusionFiches = { crees: [], misAJour: [], inchanges: [] };
  for (const fiche of importees) {
    const existante = parId.get(fiche.id);
    if (!existante) resultat.crees.push(fiche);
    else if (identiques(existante, fiche)) resultat.inchanges.push(fiche.id);
    else resultat.misAJour.push(fiche);
  }
  return resultat;
}
