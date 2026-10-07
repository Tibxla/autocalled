import { describe, expect, it, vi } from 'vitest';
import { avecBaseDeTest } from '../../test/outils';
import { dansLesHorairesRappels, enregistrerReglagesRappels, lireReglagesRappels } from './reglages-rappels';

avecBaseDeTest();

describe('horaires des rappels convenus', () => {
  it('active les futurs rappels sans rattraper ceux antérieurs à la première activation', async () => {
    vi.stubEnv('RAPPELS_AUTOMATIQUES_DEPUIS', '');
    const lu = await lireReglagesRappels();
    expect(lu.valeur.actif).toBe(false);
    const maintenant = new Date('2030-04-02T10:00:00Z');
    expect(await enregistrerReglagesRappels({ actif: true, jours: [2], debut: '12:00', fin: '12:30' }, lu.empreinte, maintenant)).toMatchObject({ ok: true });
    const actif = await lireReglagesRappels();
    expect(actif.valeur.depuis).toBe(maintenant.toISOString());
    expect(dansLesHorairesRappels(maintenant, actif.valeur)).toBe(true);
    expect(dansLesHorairesRappels(new Date('2030-04-02T10:30:00Z'), actif.valeur)).toBe(false);
    expect(dansLesHorairesRappels(new Date('2030-04-03T10:00:00Z'), actif.valeur)).toBe(false);
    await enregistrerReglagesRappels({ actif: false, jours: [2], debut: '12:00', fin: '12:30' }, actif.empreinte);
    const pause = await lireReglagesRappels();
    expect(pause.valeur.depuis).toBe(maintenant.toISOString());
    expect(dansLesHorairesRappels(maintenant, pause.valeur)).toBe(false);
    vi.unstubAllEnvs();
  });
});
