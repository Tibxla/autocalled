import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { entrepriseDeTest } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import { analyserAppel } from './appels';
import { claudeStructure } from './claude';
import { creerScript } from './entreprises';

// À la place du refus de test/garde-fous.ts : une analyse factice, sans claude -p.
vi.mock('@/lib/claude', () => ({ claudeStructure: vi.fn() }));

avecBaseDeTest();

const bilanDeBase = {
  etapeAtteinte: 1,
  objections: [],
  resume: 'Résumé fictif.',
  pointsForts: [],
  pointsFaibles: [],
};

let appelId: string;

beforeEach(async () => {
  vi.mocked(claudeStructure).mockReset();
  const e = await entrepriseDeTest();
  const { versionScriptId } = await creerScript(e.id, 'Découverte');
  const [a] = await db
    .insert(appels)
    .values({
      entrepriseId: e.id,
      prospectId: 'fictif',
      versionScriptId,
      ligne: 'bluetooth',
      numero: '+33639980001',
      statut: 'traitement',
      // Mardi 29 septembre 2026, 14 h 32 à Paris.
      debutLe: new Date('2026-09-29T12:32:00Z'),
      transcription: [{ role: 'prospect', texte: 'Rappelez-moi jeudi matin.', secondes: 1 }],
    })
    .returning({ id: appels.id });
  if (!a) throw new Error('appel non créé');
  appelId = a.id;
});

describe('analyse d’un rappel convenu', () => {
  it('donne la date de l’appel au modèle et écrit l’instant du rappel', async () => {
    vi.mocked(claudeStructure).mockResolvedValue({
      ...bilanDeBase,
      issue: 'rappel-convenu',
      rappel: 'jeudi matin',
      rappelLe: { date: '2026-10-01', heure: null, moment: 'matin' },
    });

    await analyserAppel(appelId);

    const consignes = vi.mocked(claudeStructure).mock.calls[0]?.[0].prompt ?? '';
    expect(consignes).toContain('mardi 29 septembre 2026 à 14:32 (2026-09-29)');
    const [lu] = await db.select().from(appels).where(eq(appels.id, appelId));
    expect(lu).toMatchObject({ statut: 'termine', issueSysteme: 'rappel-convenu', versionAnalyseur: 'claude-sonnet · consignes v2' });
    expect(lu?.rappelLe?.toISOString()).toBe('2026-10-01T07:00:00.000Z');
    expect(lu?.bilan).toMatchObject({ rappel: 'jeudi matin', rappelLe: { date: '2026-10-01', moment: 'matin' } });
  });

  it('refuse une date antérieure à l’appel, puis accepte la correction', async () => {
    vi.mocked(claudeStructure)
      .mockResolvedValueOnce({ ...bilanDeBase, issue: 'rappel-convenu', rappel: 'jeudi', rappelLe: { date: '2026-09-24', heure: null, moment: null } })
      .mockResolvedValueOnce({ ...bilanDeBase, issue: 'rappel-convenu', rappel: 'jeudi', rappelLe: { date: '2026-10-01', heure: null, moment: null } });

    await analyserAppel(appelId);

    const seconde = vi.mocked(claudeStructure).mock.calls[1]?.[0].prompt ?? '';
    expect(seconde).toMatch(/antérieur à l’appel/);
    const [lu] = await db.select().from(appels).where(eq(appels.id, appelId));
    expect(lu?.rappelLe?.toISOString()).toBe('2026-10-01T07:00:00.000Z');
  });

  it('une réanalyse qui n’est plus un rappel daté efface l’instant', async () => {
    vi.mocked(claudeStructure).mockResolvedValueOnce({
      ...bilanDeBase,
      issue: 'rappel-convenu',
      rappel: 'jeudi à 10 h',
      rappelLe: { date: '2026-10-01', heure: '10:00', moment: null },
    });
    await analyserAppel(appelId);
    vi.mocked(claudeStructure).mockResolvedValueOnce({ ...bilanDeBase, issue: 'refus', rappel: null, rappelLe: null });

    await analyserAppel(appelId);

    const [lu] = await db.select().from(appels).where(eq(appels.id, appelId));
    expect(lu).toMatchObject({ issueSysteme: 'refus', rappelLe: null });
  });
});
