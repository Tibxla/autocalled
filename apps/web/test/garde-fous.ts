import { vi } from 'vitest';

/**
 * Chargé avant chaque fichier de test : aucun test ne peut lancer `claude -p` (abonnement de l'opérateur)
 * ni appeler ElevenLabs (crédits, vrai agent). Un chemin qui les atteindrait échoue au lieu de partir.
 */
vi.mock('@/lib/claude', () => ({
  claudeStructure: async () => {
    throw new Error('claude -p est interdit dans les tests');
  },
}));

vi.mock('@/lib/elevenlabs', async (original) => {
  const reel = await original<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(reel).map(([nom, valeur]) => [
      nom,
      typeof valeur === 'function'
        ? () => {
            throw new Error(`ElevenLabs est interdit dans les tests (${nom})`);
          }
        : valeur,
    ]),
  );
});
