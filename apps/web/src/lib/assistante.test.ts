import { VARIABLES_DE_L_APPEL, type VariablesDeLAppel } from '@autocalled/domain';
import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { assistante, versionsAssistante } from '@/db/schema';
import { avecBaseDeTest } from '../../test/outils';
import { composerPremierMessage, derniereVersionAssistante, lireAssistante, modifierAssistante } from './assistante';

avecBaseDeTest();

const variables = Object.fromEntries(VARIABLES_DE_L_APPEL.map((v) => [v, `<${v}>`])) as VariablesDeLAppel;

describe('lireAssistante', () => {
  it('rend les valeurs par défaut sans ligne en base', async () => {
    expect(await lireAssistante()).toEqual({ nom: 'Mina', premierMessage: 'Allô ?', modifieLe: null, modifiePar: null });
  });
});

describe('modifierAssistante', () => {
  it('crée la ligne puis la met à jour, en gardant ce qui n’est pas modifié', async () => {
    const premier = await modifierAssistante({ nom: 'Anne-Sophie' }, { origine: 'mcp' });
    expect(premier.ok).toBe(true);
    expect(await lireAssistante()).toMatchObject({ nom: 'Anne-Sophie', premierMessage: 'Allô ?', modifiePar: 'mcp' });

    await modifierAssistante({ premierMessage: '  Oui, bonjour ?  ' }, { origine: 'interface' });
    expect(await lireAssistante()).toMatchObject({ nom: 'Anne-Sophie', premierMessage: 'Oui, bonjour ?', modifiePar: 'interface' });
    expect(await db.$count(assistante)).toBe(1);
  });

  it('refuse un nom qui n’est pas un prénom', async () => {
    for (const nom of ['M', 'le service des impôts', 'Mina2', 'x'.repeat(25), '']) {
      expect(await modifierAssistante({ nom }, { origine: 'mcp' })).toMatchObject({ ok: false });
    }
    expect(await modifierAssistante({ nom: 'Jean Paul' }, { origine: 'mcp' })).toMatchObject({ ok: true });
    expect(await modifierAssistante({ nom: 'Maëlle' }, { origine: 'mcp' })).toMatchObject({ ok: true });
  });

  it('refuse un premier message vide, sur deux lignes, trop long ou avec une variable inconnue', async () => {
    for (const premierMessage of ['   ', 'Allô ?\nOui ?', 'a'.repeat(161), 'Bonjour {{prenom_invente}}']) {
      expect(await modifierAssistante({ premierMessage }, { origine: 'mcp' })).toMatchObject({ ok: false });
    }
    expect(await modifierAssistante({ premierMessage: 'Allô, {{prospect_nom}} ?' }, { origine: 'mcp' })).toMatchObject({ ok: true });
  });

  it('refuse une saisie vide', async () => {
    expect(await modifierAssistante({}, { origine: 'mcp' })).toMatchObject({ ok: false });
  });

  it('refuse d’écraser une modification faite depuis la lecture', async () => {
    const { modifieLe } = (await modifierAssistante({ nom: 'Lina' }, { origine: 'interface' })) as { modifieLe: Date };
    const perime = new Date(modifieLe.getTime() - 60_000).toISOString();

    const conflit = await modifierAssistante({ nom: 'Nora' }, { origine: 'mcp', connu: perime });

    expect(conflit).toMatchObject({ ok: false, conflit: { origine: 'interface', jeton: modifieLe.toISOString() } });
    expect((await lireAssistante()).nom).toBe('Lina');
    expect(await modifierAssistante({ nom: 'Nora' }, { origine: 'mcp', connu: modifieLe.toISOString() })).toMatchObject({ ok: true });
  });
});

describe('composerPremierMessage', () => {
  it('remplace les variables et met la phrase sur une ligne', () => {
    expect(composerPremierMessage('Allô, {{prospect_nom}} ?', variables)).toBe('Allô, <prospect_nom> ?');
  });

  it('revient à « Allô ? » quand la phrase composée est vide ou trop longue', () => {
    expect(composerPremierMessage('{{prospect_contexte}}', { ...variables, prospect_contexte: '  ' })).toBe('Allô ?');
    expect(composerPremierMessage('{{prospect_contexte}}', { ...variables, prospect_contexte: 'mot '.repeat(100) })).toBe('Allô ?');
  });
});

describe('derniereVersionAssistante', () => {
  it('rend la dernière configuration consignée', async () => {
    expect(await derniereVersionAssistante()).toBeNull();
    await db.insert(versionsAssistante).values([
      { versionId: 'agtvrsn_ancienne', empreinte: 'a', prompt: 'p', configuration: {}, origine: 'cli', consigneLe: new Date('2026-09-01T08:00:00Z') },
      { versionId: 'agtvrsn_recente', empreinte: 'b', prompt: 'p', configuration: {}, origine: 'mcp', consigneLe: new Date('2026-09-02T08:00:00Z') },
    ]);
    expect(await derniereVersionAssistante()).toMatchObject({ versionId: 'agtvrsn_recente', origine: 'mcp' });
  });
});
