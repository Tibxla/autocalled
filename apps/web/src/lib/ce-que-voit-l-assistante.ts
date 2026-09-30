import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { entreprises, prospects } from '@/db/schema';
import { type ApercuVariables, apercuVariablesAppel } from './apercu';
import { lireAssistante } from './assistante';
import { lireFichiersAssistante } from './fichiers-assistante';
import { versionsLancables } from './versions';
import { connaissancesDe, etatsDesVariables, type EtatVariable, outilsDe, type VueResolue } from './vue-assistante';

/**
 * « Ce que voit l'assistante » pour une entreprise, une version de script et un prospect (ou aucun), choisis par
 * l'URL : le même cœur que l'appel réel (`apercuVariablesAppel`, puis `variablesPour`), appliqué au prompt de
 * `agent/`. Lecture seule : ni appel, ni journal. Partagé par la page Assistante et son téléchargement.
 */

export interface Choix {
  entreprise?: string | undefined;
  version?: string | undefined;
  prospect?: string | undefined;
}

export interface CeQueVoitLAssistante {
  entreprises: { slug: string; nom: string }[];
  /** L'entreprise retenue : celle de l'URL, sinon la première par nom. */
  entreprise: { id: string; slug: string; nom: string } | null;
  versions: { id: string; libelle: string }[];
  prospects: { id: string; nom: string }[];
  /** Pourquoi rien n'est calculé (entreprise inconnue, version ou prospect d'une autre entreprise). */
  erreur: string | null;
  apercu: ApercuVariables | null;
  etats: Record<string, EtatVariable>;
  vue: VueResolue | null;
}

const UUID = /^[0-9a-f-]{36}$/i;

export async function ceQueVoitLAssistante(choix: Choix, maintenant = new Date()): Promise<CeQueVoitLAssistante> {
  const liste = await db.select({ id: entreprises.id, slug: entreprises.slug, nom: entreprises.nom }).from(entreprises).orderBy(asc(entreprises.nom));
  const vide = { entreprises: liste.map(({ slug, nom }) => ({ slug, nom })), versions: [], prospects: [], apercu: null, etats: {}, vue: null };
  const entreprise = choix.entreprise ? liste.find((e) => e.slug === choix.entreprise) : liste[0];
  if (!entreprise) return { ...vide, entreprise: null, erreur: choix.entreprise ? 'Cette entreprise n’existe pas.' : null };

  const [versions, listeProspects] = await Promise.all([
    versionsLancables(entreprise.id),
    db
      .select({ id: prospects.id, nom: prospects.nom })
      .from(prospects)
      .where(and(eq(prospects.entrepriseId, entreprise.id), isNull(prospects.archiveLe)))
      .orderBy(asc(prospects.nom), asc(prospects.id)),
  ]);
  const base = { ...vide, entreprise, versions: versions.map((v) => ({ id: v.id, libelle: v.libelle })), prospects: listeProspects };

  // Un identifiant de version mal formé n'atteint pas Postgres, qui refuserait de le comparer à un uuid.
  if (choix.version && !UUID.test(choix.version)) return { ...base, erreur: 'Cette version de script n’appartient pas à cette entreprise.' };
  const [resultat, assistante, fichiers] = await Promise.all([
    apercuVariablesAppel(entreprise.id, { prospectId: choix.prospect || null, versionScriptId: choix.version || null, maintenant }),
    lireAssistante(),
    lireFichiersAssistante(),
  ]);
  if (!resultat.ok) return { ...base, erreur: resultat.raison };

  const variables: Record<string, string> = { ...resultat.variables };
  const etats = etatsDesVariables({
    variables,
    parDefaut: resultat.parDefaut,
    dependDuProspect: resultat.dependDuProspect,
    sansProspect: !resultat.prospect,
  });
  return {
    ...base,
    erreur: null,
    apercu: resultat,
    etats,
    vue: {
      assistante: assistante.nom,
      entreprise: entreprise.nom,
      version: resultat.version ? { script: resultat.version.script, numero: resultat.version.numero } : null,
      prospect: resultat.prospect?.nom ?? null,
      calculeLe: maintenant,
      modelePremierMessage: assistante.premierMessage,
      premierMessage: resultat.premierMessage,
      prompt: fichiers.prompt,
      variables,
      etats,
      motsCles: resultat.motsCles,
      outils: outilsDe(fichiers.configuration),
      connaissances: connaissancesDe(fichiers.configuration).map(({ chemin }) => ({ chemin })),
    },
  };
}
