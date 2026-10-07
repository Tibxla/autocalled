import { describe, expect, it } from 'vitest';
import { avecBaseDeTest } from '../../test/outils';
import { enregistrerReglagesEntrants, lireReglagesEntrants } from './reglages-entrants';

avecBaseDeTest();

describe('réglages des appels entrants', () => {
  it('refuse de remplacer une modification faite depuis la lecture, y compris la première écriture', async () => {
    const ancien = await lireReglagesEntrants();
    expect(ancien.valeur).toMatchObject({ actif: true });
    expect(await enregistrerReglagesEntrants({ actif: false, accueil: 'Bonjour.' }, ancien.empreinte)).toMatchObject({ ok: true });
    expect(await enregistrerReglagesEntrants({ actif: true, accueil: 'Allô ?' }, ancien.empreinte)).toMatchObject({ ok: false });
    expect((await lireReglagesEntrants()).valeur).toEqual({ actif: false, accueil: 'Bonjour.' });
  });

  it.each(['', 'Bonjour\nsalut', '{{prospect_nom}}', '{{inconnue}}', '{{ assistante_nom }}', 'x'.repeat(161)])('refuse un accueil invalide : %s', async (accueil) => {
    const initial = await lireReglagesEntrants();
    expect(await enregistrerReglagesEntrants({ actif: true, accueil }, initial.empreinte)).toMatchObject({ ok: false });
    expect(await lireReglagesEntrants()).toEqual(initial);
  });
});
