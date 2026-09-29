import type { ClientAgent } from './client.ts';
import { avecPrompt, empreinte, type Json } from './configuration.ts';
import { enregistrerDistante, lireLocal, type Verrou } from './fichiers.ts';

/**
 * Synchronisation entre `agent/` et ElevenLabs. ElevenLabs change de `version_id` à chaque modification : c'est
 * le signal le plus sûr que la configuration distante a bougé. L'empreinte ne sert qu'aux verrous sans version.
 */

export interface EtatSynchro {
  empreinteLocale: string;
  verrou: Verrou | null;
  distante: { versionId: string | null; empreinte: string } | null;
  erreurDistante?: string;
  /** L'empreinte locale diffère du verrou : des modifications de `agent/` ne sont pas poussées. */
  localeModifiee: boolean;
  /** La version distante diffère du verrou : quelqu'un a modifié l'agent ailleurs (tableau de bord). */
  distanteModifiee: boolean;
}

export function versionDe(distante: Json): string | null {
  return typeof distante.version_id === 'string' ? distante.version_id : null;
}

/** La configuration distante a-t-elle changé depuis le verrou ? Sans verrou, rien ne permet de le dire : non. */
export function distanteModifieeDepuis(verrou: Verrou | null, distante: { versionId: string | null; empreinte: string }): boolean {
  if (!verrou) return false;
  return verrou.versionId ? verrou.versionId !== distante.versionId : verrou.empreinte !== distante.empreinte;
}

export async function configurationLocaleComplete(dossier: string): Promise<{ config: Json; verrou: Verrou | null }> {
  const locale = await lireLocal(dossier);
  return { config: avecPrompt(locale.configuration, locale.prompt), verrou: locale.verrou };
}

export async function etatSynchro(dossier: string, client: ClientAgent | null): Promise<EtatSynchro> {
  const { config, verrou } = await configurationLocaleComplete(dossier);
  const empreinteLocale = empreinte(config);
  let distante: EtatSynchro['distante'] = null;
  let erreurDistante: string | undefined;
  if (client) {
    try {
      const brute = await client.lire();
      distante = { versionId: versionDe(brute), empreinte: empreinte(brute) };
    } catch (erreur) {
      erreurDistante = (erreur as Error).message;
    }
  } else {
    erreurDistante = 'ElevenLabs n’est pas configuré (ELEVENLABS_API_KEY ou ELEVENLABS_AGENT_ID absente).';
  }
  return {
    empreinteLocale,
    verrou,
    distante,
    ...(erreurDistante ? { erreurDistante } : {}),
    localeModifiee: verrou ? verrou.empreinte !== empreinteLocale : true,
    distanteModifiee: distante ? distanteModifieeDepuis(verrou, distante) : false,
  };
}

/**
 * Envoie `agent/` vers ElevenLabs, puis réécrit les fichiers et le verrou d'après la configuration relue.
 * Refuse d'écraser une configuration distante modifiée depuis le verrou. `attendu` : ce que l'opérateur a
 * relu (empreinte locale, version distante) ; si l'une ou l'autre a bougé depuis, rien ne part.
 */
export async function pousser(
  dossier: string,
  client: ClientAgent,
  attendu?: { empreinteLocale: string; versionIdDistante: string | null },
): Promise<{ ok: true; avant: Json; apres: Json; versionId: string | null } | { ok: false; raison: string }> {
  const { config, verrou } = await configurationLocaleComplete(dossier);
  const avant = await client.lire();
  const distante = { versionId: versionDe(avant), empreinte: empreinte(avant) };
  if (attendu && (attendu.empreinteLocale !== empreinte(config) || attendu.versionIdDistante !== distante.versionId)) {
    return { ok: false, raison: 'La configuration a changé depuis sa relecture : relis la différence avant de pousser.' };
  }
  if (distanteModifieeDepuis(verrou, distante)) {
    return { ok: false, raison: 'La configuration distante a changé depuis le dernier rapatriement : rapatrie-la et relis la différence avant de pousser.' };
  }
  await client.modifier(config);
  const apres = await client.lire();
  await enregistrerDistante(dossier, apres);
  return { ok: true, avant, apres, versionId: versionDe(apres) };
}

/** Rapatrie la configuration distante dans `agent/`, sans jamais écraser en silence des modifications non poussées. */
export async function rapatrier(
  dossier: string,
  client: ClientAgent,
  o: { force?: boolean } = {},
): Promise<{ ok: true; distante: Json } | { ok: false; raison: string }> {
  const { config, verrou } = await configurationLocaleComplete(dossier);
  if (verrou && !o.force && empreinte(config) !== verrou.empreinte) {
    return { ok: false, raison: 'agent/ contient des modifications non poussées : pousse-les avant de rapatrier, ou mets-les de côté.' };
  }
  const distante = await client.lire();
  await enregistrerDistante(dossier, distante);
  return { ok: true, distante };
}
