import { afterEach, describe, expect, it } from 'vitest';
import { OUTILS_MCP } from '@/lib/outils-mcp';
import { clientDeTest } from '../test/client-mcp';

/**
 * Le journal de Réglages nomme chaque outil et range les lectures à part (src/lib/outils-mcp.ts). Ce test échoue dès
 * qu'un outil est ajouté au serveur sans son libellé, ou que sa nature (lecture ou geste) diffère de `readOnlyHint`.
 */

let fermer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await fermer?.();
  fermer = undefined;
});

describe('libellés des outils MCP', () => {
  it('chaque outil enregistré a un libellé, et une lecture est un outil readOnlyHint', async () => {
    const connexion = await clientDeTest();
    fermer = connexion.fermer;
    const { tools } = await connexion.client.listTools();

    const sansLibelle = tools.map((t) => t.name).filter((nom) => !OUTILS_MCP[nom]);
    expect(sansLibelle, 'outils sans libellé dans src/lib/outils-mcp.ts').toEqual([]);
    const natureFausse = tools.filter((t) => OUTILS_MCP[t.name]?.lecture !== Boolean(t.annotations?.readOnlyHint)).map((t) => t.name);
    expect(natureFausse, 'lecture différente de readOnlyHint').toEqual([]);
    const retires = Object.keys(OUTILS_MCP).filter((nom) => !tools.some((t) => t.name === nom));
    expect(retires, 'libellés d’outils qui n’existent plus').toEqual([]);
  });
});
