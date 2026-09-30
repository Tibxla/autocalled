/**
 * Règles d'un prompt valide, pour que toute écriture laisse `agent/` dans un état qu'ElevenLabs et l'application
 * savent servir : ses variables sont exactement celles que l'application envoie, et la section des règles existe.
 */

export const LONGUEUR_MIN_PROMPT = 500;
export const LONGUEUR_MAX_PROMPT = 20_000;

/** Les `{{variables}}` du texte, dans l'ordre de première apparition, sans doublon. */
export function variablesDuTexte(texte: string): string[] {
  return [...new Set([...texte.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] as string))];
}

/** Le contenu de la section `# Règles` (jusqu'au titre de niveau 1 suivant), ou null si elle manque. */
function sectionRegles(prompt: string): string | null {
  const lignes = prompt.split('\n');
  const debut = lignes.findIndex((l) => /^#\s+Règles\s*$/.test(l));
  if (debut < 0) return null;
  const fin = lignes.findIndex((l, i) => i > debut && /^#\s/.test(l));
  return lignes.slice(debut + 1, fin < 0 ? undefined : fin).join('\n');
}

export function validerPrompt(
  prompt: string,
  variablesAttendues: readonly string[],
): { ok: true } | { ok: false; erreurs: string[] } {
  const erreurs: string[] = [];
  if (prompt.length < LONGUEUR_MIN_PROMPT) erreurs.push(`Le prompt fait ${prompt.length} caractères : ${LONGUEUR_MIN_PROMPT} au moins.`);
  if (prompt.length > LONGUEUR_MAX_PROMPT) erreurs.push(`Le prompt fait ${prompt.length} caractères : ${LONGUEUR_MAX_PROMPT} au plus.`);

  const presentes = new Set(variablesDuTexte(prompt));
  const attendues = new Set(variablesAttendues);
  const manquantes = [...attendues].filter((v) => !presentes.has(v));
  const inconnues = [...presentes].filter((v) => !attendues.has(v));
  if (manquantes.length) {
    erreurs.push(`Variables absentes du prompt : ${manquantes.map((v) => `{{${v}}}`).join(', ')}. Chaque variable que l'application envoie doit y figurer.`);
  }
  if (inconnues.length) {
    erreurs.push(
      `Variables inconnues : ${inconnues.map((v) => `{{${v}}}`).join(', ')}. L'application ne les envoie pas : ElevenLabs refuserait d'ouvrir la conversation. En ajouter une est un changement de code.`,
    );
  }

  const regles = sectionRegles(prompt);
  if (regles === null) erreurs.push('La section « # Règles » manque (refus ferme, question « êtes-vous une IA », messagerie, rien d’inventé).');
  else if (!regles.trim()) erreurs.push('La section « # Règles » est vide.');

  return erreurs.length ? { ok: false, erreurs } : { ok: true };
}

function occurrences(texte: string, motif: string): number {
  let n = 0;
  for (let i = texte.indexOf(motif); i >= 0; i = texte.indexOf(motif, i + motif.length)) n++;
  return n;
}

function extrait(texte: string): string {
  const ligne = texte.replace(/\s+/g, ' ').trim();
  return ligne.length > 80 ? `${ligne.slice(0, 80)}…` : ligne;
}

/**
 * Applique des remplacements exacts, dans l'ordre, tout ou rien. Chaque `avant` doit apparaître exactement une
 * fois dans le texte tel que l'ont laissé les remplacements précédents ; `apres` peut être vide.
 */
export function appliquerRemplacements(
  texte: string,
  remplacements: readonly { avant: string; apres: string }[],
): { ok: true; texte: string } | { ok: false; raison: string } {
  let courant = texte;
  for (const [i, { avant, apres }] of remplacements.entries()) {
    const rang = `Remplacement ${i + 1}`;
    if (!avant) return { ok: false, raison: `${rang} : le passage à remplacer est vide.` };
    const n = occurrences(courant, avant);
    if (n === 0) return { ok: false, raison: `${rang} : « ${extrait(avant)} » est introuvable dans le prompt actuel. Relis-le avec lire_assistante.` };
    if (n > 1) return { ok: false, raison: `${rang} : « ${extrait(avant)} » apparaît ${n} fois. Allonge le passage pour qu'il n'apparaisse qu'une fois.` };
    const position = courant.indexOf(avant);
    courant = courant.slice(0, position) + apres + courant.slice(position + avant.length);
  }
  return { ok: true, texte: courant };
}
