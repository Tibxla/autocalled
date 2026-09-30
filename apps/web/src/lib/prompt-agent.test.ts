import { readFile } from 'node:fs/promises';
import { validerPrompt } from '@autocalled/agent';
import { VARIABLES_DE_L_APPEL } from '@autocalled/domain';
import { describe, expect, it } from 'vitest';

/**
 * Le prompt versionné dans `agent/` doit passer la validation de `pnpm agent push` avec les variables que
 * l'application envoie : sinon la poussée est refusée, ou ElevenLabs refuse d'ouvrir la conversation.
 */

const lire = (chemin: string) => readFile(new URL(`../../../../agent/${chemin}`, import.meta.url), 'utf8');

describe('agent/prompt.md', () => {
  it('passe la validation de la poussée avec les variables de l’appel', async () => {
    expect(validerPrompt(await lire('prompt.md'), VARIABLES_DE_L_APPEL)).toEqual({ ok: true });
  });

  it('dit qu’une information vide n’existe pas, et donne les informations complémentaires sous leur libellé', async () => {
    const prompt = await lire('prompt.md');

    expect(prompt).toContain('Quand rien ne suit les deux-points, l\'information n\'est pas donnée : tu n\'en parles pas et tu ne l\'inventes pas.');
    expect(prompt).toContain('Informations complémentaires, à dire seulement si la conversation y mène :\n{{entreprise_complements}}');
  });

  it('a une valeur d’exemple pour chaque variable dans mina.config.json', async () => {
    const config = JSON.parse(await lire('mina.config.json'));
    const exemples = Object.keys(config.conversation_config.agent.dynamic_variables.dynamic_variable_placeholders);

    expect(exemples.sort()).toEqual([...VARIABLES_DE_L_APPEL].sort());
  });
});
