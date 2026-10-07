import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { journalMcp } from '@/db/schema';
import { lireReglagesRappels } from '@/lib/reglages-rappels';
import { avecBaseDeTest } from '../../../test/outils';

const etat = vi.hoisted(() => ({ operateur: true }));
vi.mock('@/lib/garde', () => ({ exigerOperateur: async () => { if (!etat.operateur) throw new Error('accès réservé à l’opérateur'); return 'operateur@example.com'; } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const { enregistrerRappelsAction, preparerRappelsAction } = await import('./actions-rappels');

avecBaseDeTest();
beforeEach(() => { etat.operateur = true; vi.stubEnv('RAPPELS_AUTOMATIQUES_DEPUIS', '2030-04-01T08:00:00Z'); });
afterEach(() => vi.unstubAllEnvs());

describe('réglages des rappels dans l’interface', () => {
  it('réserve la préparation et l’écriture à l’opérateur', async () => {
    etat.operateur = false;
    await expect(preparerRappelsAction({})).rejects.toThrow('accès réservé');
    await expect(enregistrerRappelsAction({})).rejects.toThrow('accès réservé');
  });
  it('montre l’effet des réglages avant de les appliquer et journalise la confirmation', async () => {
    const lu = await lireReglagesRappels();
    const saisie = { valeur: { actif: false, jours: [1, 2, 3, 4, 5], debut: '08:17', fin: '18:43' }, empreinte: lu.empreinte };
    expect(await preparerRappelsAction(saisie)).toMatchObject({ ok: true, lignes: expect.arrayContaining(['Les rappels convenus resteront à faire ; aucun rappel automatique ne sera composé.']) });
    expect(await lireReglagesRappels()).toEqual(lu);
    expect(await enregistrerRappelsAction(saisie)).toMatchObject({ ok: true });
    const apres = await lireReglagesRappels();
    expect(apres.valeur).toEqual({ ...saisie.valeur, depuis: lu.valeur.depuis });
    expect((await db.select().from(journalMcp)).map((j) => j.resultat)).toEqual(['confirmation-demandee', 'ok']);
    expect(await enregistrerRappelsAction(saisie)).toMatchObject({ ok: false, raison: expect.stringContaining('changé') });
    expect(await lireReglagesRappels()).toEqual(apres);
  });
  it('refuse une plage inversée ou l’injection d’une ancienne date d’activation', async () => {
    const lu = await lireReglagesRappels();
    expect(await preparerRappelsAction({ valeur: { actif: true, jours: [1], debut: '19:00', fin: '09:00' }, empreinte: lu.empreinte })).toMatchObject({ ok: false });
    expect(await enregistrerRappelsAction({ valeur: { actif: true, jours: [1], debut: '09:00', fin: '19:00', depuis: '2000-01-01T00:00:00Z' }, empreinte: lu.empreinte })).toMatchObject({ ok: false });
    expect(await lireReglagesRappels()).toEqual(lu);
  });
});
