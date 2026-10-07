import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { journalMcp } from '@/db/schema';
import { enregistrerReglagesEntrants, lireReglagesEntrants } from '@/lib/reglages-entrants';
import { avecBaseDeTest } from '../../../test/outils';

const etat = vi.hoisted(() => ({ operateur: true, revalide: [] as string[] }));
vi.mock('@/lib/garde', () => ({ exigerOperateur: async () => { if (!etat.operateur) throw new Error('accès réservé à l’opérateur'); return 'operateur@example.com'; } }));
vi.mock('next/cache', () => ({ revalidatePath: (chemin: string) => etat.revalide.push(chemin) }));
const { enregistrerEntrantsAction, preparerEntrantsAction } = await import('./actions-entrants');

avecBaseDeTest();
beforeEach(() => { etat.operateur = true; etat.revalide = []; });

describe('actions des appels entrants', () => {
  it('exige l’opérateur avant de lire ou écrire', async () => {
    etat.operateur = false;
    await expect(preparerEntrantsAction({})).rejects.toThrow('accès réservé');
    await expect(enregistrerEntrantsAction({})).rejects.toThrow('accès réservé');
  });

  it('prépare une confirmation sans appliquer, puis enregistre et consigne le geste', async () => {
    const initial = await lireReglagesEntrants();
    const saisie = { valeur: { actif: false, accueil: 'Bonjour, {{assistante_nom}} à l’écoute.' }, empreinte: initial.empreinte };
    expect(await preparerEntrantsAction(saisie)).toMatchObject({ ok: true, lignes: expect.arrayContaining(['L’assistante laissera sonner les appels entrants.']) });
    expect(await lireReglagesEntrants()).toEqual(initial);
    expect(await enregistrerEntrantsAction(saisie)).toMatchObject({ ok: true });
    expect((await lireReglagesEntrants()).valeur).toEqual(saisie.valeur);
    expect(etat.revalide).toEqual(['/reglages']);
    expect((await db.select().from(journalMcp)).map((l) => ({ resultat: l.resultat, origine: l.origine, confirmation: l.confirmation }))).toEqual([
      { resultat: 'confirmation-demandee', origine: 'interface', confirmation: null },
      { resultat: 'ok', origine: 'interface', confirmation: 'acceptee' },
    ]);
  });

  it('une modification entre la confirmation et l’enregistrement reste intacte', async () => {
    const initial = await lireReglagesEntrants();
    const saisie = { valeur: { actif: false, accueil: 'Bonjour.' }, empreinte: initial.empreinte };
    expect(await preparerEntrantsAction(saisie)).toMatchObject({ ok: true });
    await enregistrerReglagesEntrants({ actif: true, accueil: 'Autre accueil fictif.' }, initial.empreinte);
    expect(await enregistrerEntrantsAction(saisie)).toMatchObject({ ok: false, raison: expect.stringContaining('changé') });
    expect((await lireReglagesEntrants()).valeur.accueil).toBe('Autre accueil fictif.');
  });

  it('refuse une saisie invalide avant toute confirmation', async () => {
    const initial = await lireReglagesEntrants();
    expect(await preparerEntrantsAction({ valeur: { actif: true, accueil: '{{prospect_nom}}' }, empreinte: initial.empreinte })).toMatchObject({ ok: false });
    expect(await enregistrerEntrantsAction({ valeur: { actif: 'oui', accueil: 'Bonjour.' }, empreinte: initial.empreinte })).toMatchObject({ ok: false });
    expect(await lireReglagesEntrants()).toEqual(initial);
    expect(await db.$count(journalMcp)).toBe(0);
  });
});
