import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { empreinte, type Json, separerPrompt } from './configuration.ts';

/**
 * Les trois fichiers de `agent/` : `mina.config.json` (les champs gérés, sans le prompt), `prompt.md` et
 * `remote.lock.json`, le verrou qui garde la dernière configuration distante connue (poussée ou rapatriée).
 */

export const FICHIER_CONFIGURATION = 'mina.config.json';
export const FICHIER_PROMPT = 'prompt.md';
export const FICHIER_VERROU = 'remote.lock.json';

export interface Verrou {
  versionId: string | null;
  empreinte: string;
}

export interface ConfigurationLocale {
  prompt: string;
  /** Les champs gérés, sans le prompt. */
  configuration: Json;
  verrou: Verrou | null;
}

async function lireVerrou(dossier: string): Promise<Verrou | null> {
  let brut: string;
  try {
    brut = await readFile(join(dossier, FICHIER_VERROU), 'utf8');
  } catch {
    return null;
  }
  const v = JSON.parse(brut) as Partial<Verrou>;
  if (typeof v.empreinte !== 'string') return null;
  return { versionId: typeof v.versionId === 'string' ? v.versionId : null, empreinte: v.empreinte };
}

export async function lireLocal(dossier: string): Promise<ConfigurationLocale> {
  const [configuration, prompt, verrou] = await Promise.all([
    readFile(join(dossier, FICHIER_CONFIGURATION), 'utf8').then((t) => JSON.parse(t) as Json),
    readFile(join(dossier, FICHIER_PROMPT), 'utf8'),
    lireVerrou(dossier),
  ]);
  return { prompt, configuration, verrou };
}

/** Écrit le prompt et la configuration tels quels : le prompt n'est pas normalisé (une fin de ligne ajoutée changerait l'empreinte). */
export async function ecrireLocal(dossier: string, o: { prompt?: string; configuration?: Json }): Promise<void> {
  if (o.configuration !== undefined) {
    await writeFile(join(dossier, FICHIER_CONFIGURATION), `${JSON.stringify(o.configuration, null, 2)}\n`);
  }
  if (o.prompt !== undefined) await writeFile(join(dossier, FICHIER_PROMPT), o.prompt);
}

/** Recopie la configuration distante dans les fichiers, et le verrou qui la reconnaîtra. */
export async function enregistrerDistante(dossier: string, distante: Json): Promise<Verrou> {
  const { prompt, configuration } = separerPrompt(distante);
  await ecrireLocal(dossier, { prompt, configuration });
  const verrou: Verrou = {
    versionId: typeof distante.version_id === 'string' ? distante.version_id : null,
    empreinte: empreinte(distante),
  };
  await writeFile(join(dossier, FICHIER_VERROU), `${JSON.stringify(verrou, null, 2)}\n`);
  return verrou;
}
