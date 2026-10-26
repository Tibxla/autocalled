import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { appels, disponibilites, entreprises, prospects, rendezVous } from '@/db/schema';
import { agendaFrais, entrepriseDeTest, fiche } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import { etatAgenda, lienMeet, proposerPourAppel, reserverPourAppel, synchroniserAgenda } from './agenda';
import { claudeStructure } from './claude';
import type * as ModuleClaude from './claude';
import { creerScript } from './entreprises';
import { importerFiches } from './prospects';

vi.mock('./claude', () => ({ claudeStructure: vi.fn() }));
vi.mock('./google', () => ({ accesGoogle: async () => null }));

avecBaseDeTest();

const ADRESSE = 'prospect.fictif@exemple.test';

async function appelAvecCreneau(ligne: 'bluetooth' | 'navigateur', email: string | null = null) {
  const e = await entrepriseDeTest();
  const plages = ([1, 2, 3, 4, 5, 6, 7] as const).map((jour) => ({ jour, debut: '00:00', fin: '23:45' }));
  await db.update(entreprises).set({ plagesRendezVous: plages, delaiMinimumHeures: 0 }).where(eq(entreprises.id, e.id));
  await agendaFrais();
  await importerFiches(e.id, [fiche('p-fictif', 'Prospect Fictif', '+33639980001')]);
  if (email) await db.update(prospects).set({ email }).where(eq(prospects.id, 'p-fictif'));
  const { versionScriptId } = await creerScript(e.id, 'Découverte');
  const [a] = await db.insert(appels).values({ entrepriseId: e.id, prospectId: 'p-fictif', versionScriptId, ligne, numero: '+33639980001' }).returning();
  const propose = (await proposerPourAppel(a!.id)) as { creneaux: { debut: string }[] };
  return { appelId: a!.id, debut: propose.creneaux[0]!.debut };
}

const rendezVousDe = async (appelId: string) => (await db.select().from(rendezVous).where(eq(rendezVous.appelId, appelId)))[0];

describe('synchroniserAgenda : lecture du connecteur', () => {
  it.each([
    { libres: [] },
    { libres: [{ debut: 'invalide', fin: 'invalide' }] },
    { libres: [{ debut: '2000-01-01T10:00:00Z', fin: '2000-01-01T11:00:00Z' }] },
  ])('sans plage libre dans la fenêtre ($libres) : garde la copie et note l’erreur', async ({ libres }) => {
    await agendaFrais();
    const avant = await etatAgenda();
    vi.mocked(claudeStructure).mockResolvedValueOnce({ libres });
    await synchroniserAgenda();
    expect(await etatAgenda()).toEqual({ ...avant, erreur: expect.stringMatching(/aucune plage libre/i) });
  });

  it('une lecture valide remplace la copie et efface l’erreur', async () => {
    await agendaFrais();
    await db.update(disponibilites).set({ erreur: 'Lecture précédente échouée' });
    const debut = new Date(Date.now() + 3600_000).toISOString();
    const fin = new Date(Date.now() + 7200_000).toISOString();
    vi.mocked(claudeStructure).mockResolvedValueOnce({ libres: [{ debut, fin }] });
    await synchroniserAgenda();
    expect(await etatAgenda()).toMatchObject({ erreur: null, source: 'mcp', occupations: [
      { debut: expect.any(String), fin: debut },
      { debut: fin, fin: expect.any(String) },
    ] });
  });
});

describe('proposerPourAppel : copie douteuse', () => {
  it('une occupation unique couvrant toute la fenêtre rend l’agenda indisponible, même frais', async () => {
    const { appelId } = await appelAvecCreneau('bluetooth');
    const etat = (await etatAgenda())!;
    await db.update(disponibilites).set({ occupations: [{ debut: etat.fenetreDebut.toISOString(), fin: etat.fenetreFin.toISOString() }] });
    expect(await proposerPourAppel(appelId)).toMatch(/agenda n'est pas disponible/);
  });

  it.each([
    { heures: 3, erreur: 'Connecteur absent', indisponible: true },
    { heures: 1, erreur: 'Connecteur absent', indisponible: false },
    { heures: 3, erreur: null, indisponible: false },
  ])('copie de $heures h, erreur=$erreur : indisponible=$indisponible', async ({ heures, erreur, indisponible }) => {
    const { appelId } = await appelAvecCreneau('bluetooth');
    await db.update(disponibilites).set({ synchroniseLe: new Date(Date.now() - heures * 3600_000), erreur });
    const resultat = await proposerPourAppel(appelId);
    if (indisponible) expect(resultat).toMatch(/agenda n'est pas disponible/);
    else expect(resultat).toHaveProperty('creneaux');
  });
});

describe('reserverPourAppel : adresse relue', () => {
  it('une adresse « confirmée » d’emblée, sans relecture, est renvoyée à l’épellation', async () => {
    const { appelId, debut } = await appelAvecCreneau('bluetooth');
    const r = (await reserverPourAppel(appelId, debut, ADRESSE, true)) as { reserve: boolean; a_faire?: string };
    expect(r.reserve).toBe(false);
    expect(r.a_faire).toMatch(/lettre par lettre/);
    expect(await rendezVousDe(appelId)).toBeUndefined();
  });

  it('une autre adresse que celle relue est renvoyée à l’épellation', async () => {
    const { appelId, debut } = await appelAvecCreneau('bluetooth');
    await reserverPourAppel(appelId, debut, ADRESSE, false);
    const r = (await reserverPourAppel(appelId, debut, 'autre.adresse@exemple.test', true)) as { reserve: boolean };
    expect(r.reserve).toBe(false);
    expect(await rendezVousDe(appelId)).toBeUndefined();
  });

  it('l’adresse relue puis confirmée réserve, invite et complète la fiche', async () => {
    const { appelId, debut } = await appelAvecCreneau('bluetooth');
    await reserverPourAppel(appelId, debut, ADRESSE, false);
    const r = (await reserverPourAppel(appelId, debut, ADRESSE, true)) as { reserve: boolean };
    expect(r.reserve).toBe(true);
    expect((await rendezVousDe(appelId))?.email).toBe(ADRESSE);
    expect((await db.select().from(prospects).where(eq(prospects.id, 'p-fictif')))[0]?.email).toBe(ADRESSE);
  });
});

describe('reserverPourAppel : ligne navigateur', () => {
  it('l’adresse de la fiche (le vrai prospect) ne reçoit pas d’invitation', async () => {
    const { appelId, debut } = await appelAvecCreneau('navigateur', ADRESSE);
    await reserverPourAppel(appelId, debut, ADRESSE, false);
    const r = (await reserverPourAppel(appelId, debut, ADRESSE, true)) as { reserve: boolean; invitation: string };
    expect(r.reserve).toBe(true);
    expect(r.invitation).toMatch(/ligne de test/);
    expect((await rendezVousDe(appelId))?.email).toBeNull();
  });

  it('une adresse dictée est invitée mais jamais recopiée dans la fiche', async () => {
    const { appelId, debut } = await appelAvecCreneau('navigateur');
    const dictee = 'operateur.essai@exemple.test';
    await reserverPourAppel(appelId, debut, dictee, false);
    await reserverPourAppel(appelId, debut, dictee, true);
    expect((await rendezVousDe(appelId))?.email).toBe(dictee);
    expect((await db.select().from(prospects).where(eq(prospects.id, 'p-fictif')))[0]?.email).toBeNull();
  });
});

describe('lienMeet', () => {
  it('ne garde qu’un lien https vers Google Meet', () => {
    expect(lienMeet('https://meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij');
    for (const faux of ['https://meet.google.com.piege.exemple/x', 'http://meet.google.com/abc', 'javascript:alert(1)', 'https://piege.exemple/meet', '', null]) {
      expect(lienMeet(faux)).toBeNull();
    }
  });
});

describe('argumentsClaude', () => {
  it('coupe réglages, crochets et outils non nommés dans les deux régimes', async () => {
    const { argumentsClaude } = await vi.importActual<typeof ModuleClaude>('./claude');
    const sans = argumentsClaude({ modele: 'sonnet', schema: {} });
    const avec = argumentsClaude({ modele: 'haiku', schema: {}, outilsMcp: ['mcp__claude_ai_Google_Calendar__create_event'] });
    for (const args of [sans, avec]) {
      expect(args).toContain('--restricted');
      expect(args.slice(args.indexOf('--permission-mode'))[1]).toBe('dontAsk');
      expect(args.slice(args.indexOf('--tools'))[1]).toBe('');
    }
    expect(sans).toContain('--strict-mcp-config');
    expect(avec.slice(avec.indexOf('--allowedTools'))[1]).toBe('mcp__claude_ai_Google_Calendar__create_event');
    expect(avec).toContain('--disallowedTools');
  });
});
