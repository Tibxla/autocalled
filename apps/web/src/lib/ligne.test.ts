import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { campagnes } from '@/db/schema';
import { creerScript } from '@/lib/entreprises';
import { etatPourLaBarre } from '@/lib/ligne';
import { entrepriseDeTest } from '../../test/fixtures';
import { fauxPont } from '../../test/faux-pont';
import { avecBaseDeTest } from '../../test/outils';

avecBaseDeTest();

const APPEL = '00000000-0000-4000-8000-000000000001';

async function campagne(statut: 'prete' | 'en-cours' | 'en-pause' | 'terminee', traites: number, total: number, creeLe = new Date()) {
  const e = await entrepriseDeTest(`Gîte fictif ${statut}`, `gite-fictif-${statut}`);
  const { versionScriptId } = await creerScript(e.id, 'Découverte');
  const entrees = Array.from({ length: total }, (_, i) =>
    i < traites ? { prospectId: `p${i}`, etat: 'appelee' as const, appelId: APPEL } : { prospectId: `p${i}`, etat: 'a-appeler' as const },
  );
  const [c] = await db.insert(campagnes).values({ entrepriseId: e.id, versionScriptId, ligne: 'bluetooth', statut, entrees, creeLe }).returning();
  return c!;
}

describe('état de la ligne pour la barre du haut', () => {
  it('pont muet : injoignable, la campagne reste dite', async () => {
    const c = await campagne('en-pause', 3, 10);
    expect(await etatPourLaBarre()).toEqual({
      pont: false,
      connecte: false,
      appelEnCours: false,
      appelId: null,
      decrocheLe: null,
      plafond: null,
      campagne: { id: c.id, entreprise: 'Gîte fictif en-pause', statut: 'en-pause', traites: 3, total: 10 },
    });
  });

  it('plafond atteint : l’heure du prochain appel vient du pont', async () => {
    const jusqua = Date.now() + 20 * 60_000;
    const pont = await fauxPont({ plafond: 'Plafond de 15 appels par heure atteint.', etat: { plafondJusqua: jusqua } });
    try {
      const etat = await etatPourLaBarre();
      expect(etat).toMatchObject({ pont: true, connecte: true, appelEnCours: false, plafond: { jusqua }, campagne: null });
    } finally {
      await pont.fermer();
    }
  });

  it('pont ancien sans heure : plafond dit sans heure ; appel en cours avec son décroché', async () => {
    const pont = await fauxPont({ plafond: 'Plafond atteint.', etat: { appelEnCours: true, appelId: APPEL, decrocheLe: 1_800_000_000_000 } });
    try {
      expect(await etatPourLaBarre()).toMatchObject({ plafond: { jusqua: null }, appelEnCours: true, appelId: APPEL, decrocheLe: 1_800_000_000_000 });
    } finally {
      await pont.fermer();
    }
  });

  it('la campagne en cours passe avant une suspendue plus récente ; prête et terminée ne comptent pas', async () => {
    await campagne('prete', 0, 5, new Date(Date.now() + 3000));
    await campagne('terminee', 5, 5, new Date(Date.now() + 2000));
    await campagne('en-pause', 1, 5, new Date(Date.now() + 1000));
    const enCours = await campagne('en-cours', 34, 100, new Date());
    expect((await etatPourLaBarre()).campagne).toEqual({ id: enCours.id, entreprise: 'Gîte fictif en-cours', statut: 'en-cours', traites: 34, total: 100 });
  });
});
