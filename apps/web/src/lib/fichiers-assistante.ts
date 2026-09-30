import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { avecPrompt, empreinte, FICHIER_CONFIGURATION, type Json, lireLocal, type Verrou } from '@autocalled/agent';

/**
 * Lecture seule des fichiers de `agent/` pour la page Assistante et ses téléchargements : le prompt,
 * `mina.config.json` tel quel, et le verrou de la dernière poussée ou du dernier rapatriement. Rien ici n'écrit ni
 * ne joint ElevenLabs : l'état de synchronisation se déduit du verrou local (la version distante se relit par
 * `pnpm agent status`). Les écritures restent au serveur MCP (lib/configuration-assistante.ts).
 */

/** Le même dossier que le serveur MCP (`dossierAgent` de lib/configuration-assistante.ts) : `agent/` de la copie qui tourne. */
function dossierAgent(): string {
  return process.env.DOSSIER_AGENT ?? join(process.cwd(), '..', '..', 'agent');
}

export interface FichiersAssistante {
  /** `agent/prompt.md` tel quel. */
  prompt: string;
  /** `agent/mina.config.json` tel quel (texte), pour le téléchargement. */
  configurationBrute: string;
  configuration: Json;
  synchro: {
    /** Empreinte des champs gérés (prompt compris) des fichiers actuels, calculée comme `pnpm agent`. */
    empreinteLocale: string;
    verrou: Verrou | null;
    /** Les fichiers diffèrent de la dernière configuration poussée ou rapatriée. */
    modificationsLocalesNonPoussees: boolean;
  };
}

export async function lireFichiersAssistante(dossier = dossierAgent()): Promise<FichiersAssistante> {
  const [locale, configurationBrute] = await Promise.all([lireLocal(dossier), readFile(join(dossier, FICHIER_CONFIGURATION), 'utf8')]);
  const empreinteLocale = empreinte(avecPrompt(locale.configuration, locale.prompt));
  return {
    prompt: locale.prompt,
    configurationBrute,
    configuration: locale.configuration,
    synchro: {
      empreinteLocale,
      verrou: locale.verrou,
      modificationsLocalesNonPoussees: locale.verrou ? locale.verrou.empreinte !== empreinteLocale : true,
    },
  };
}
