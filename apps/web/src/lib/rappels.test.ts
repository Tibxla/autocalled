import { instantDuRappel, type RappelDate } from '@autocalled/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleJour } from '@/components/format-appel';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { entrepriseDeTest, fiche } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import { creerScript } from './entreprises';
import { listerAppels } from './lecture';
import { importerFiches } from './prospects';
import { rappelEnAttente, rappelsDuJour } from './rappels';

avecBaseDeTest();

let entrepriseId: string;
let versionScriptId: string;
/** Le jour de Paris, `decalage` jours après aujourd'hui (AAAA-MM-JJ) : juste quelle que soit l'heure du test. */
function jourParis(decalage: number): string {
  const [a, m, j] = cleJour(new Date()).split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, j + decalage)).toISOString().slice(0, 10);
}

beforeEach(async () => {
  const e = await entrepriseDeTest();
  entrepriseId = e.id;
  await importerFiches(e.id, [
    fiche('julie', 'Julie Fictive', '06 39 98 00 01'),
    fiche('marc', 'Marc Fictif', '06 39 98 00 02'),
    fiche('lea', 'Léa Fictive', '06 39 98 00 03'),
    fiche('paul', 'Paul Fictif', '06 39 98 00 04'),
  ]);
  ({ versionScriptId } = await creerScript(e.id, 'Découverte'));
});

/** Un appel terminé en rappel convenu, daté ou non, `debut` avant maintenant. */
async function rappel(prospectId: string, quand: RappelDate | null, { debut = 3 * 86_400_000, ligne = 'bluetooth' as const } = {}) {
  const [a] = await db
    .insert(appels)
    .values({
      entrepriseId,
      prospectId,
      versionScriptId,
      ligne,
      numero: '+33639980001',
      statut: 'termine',
      debutLe: new Date(Date.now() - debut),
      issue: 'rappel-convenu',
      issueSysteme: 'rappel-convenu',
      rappelLe: quand ? instantDuRappel(quand) : null,
      bilan: {
        issue: 'rappel-convenu',
        etapeAtteinte: 1,
        objections: [],
        resume: 'Résumé fictif.',
        pointsForts: [],
        pointsFaibles: [],
        rappel: 'texte fictif',
        rappelLe: quand,
      },
    })
    .returning();
  if (!a) throw new Error('appel non créé');
  return a;
}

/** Un appel plus récent vers le même prospect. */
async function appelPlusRecent(prospectId: string, { ligne = 'bluetooth' as 'bluetooth' | 'simulation', statut = 'echec' as const } = {}) {
  await db.insert(appels).values({ entrepriseId, prospectId, versionScriptId, ligne, numero: '+33639980001', statut, debutLe: new Date(Date.now() - 60_000) });
}

const jour = (decalage: number, heure: string | null, moment: RappelDate['moment'] = null): RappelDate => ({
  date: jourParis(decalage),
  heure,
  moment,
});

describe('rappelsDuJour', () => {
  it('garde les rappels d’aujourd’hui et en retard, triés par heure ; demain attend', async () => {
    await rappel('julie', jour(0, '16:30'));
    await rappel('marc', jour(0, null, 'matin'));
    await rappel('lea', jour(-2, null, 'apres-midi'));
    await rappel('paul', jour(1, '10:00'));

    const { rappels, sansDate } = await rappelsDuJour();

    expect(rappels.map((r) => [r.prospectId, r.enRetard])).toEqual([
      ['lea', true],
      ['marc', false],
      ['julie', false],
    ]);
    expect(rappels[1]).toMatchObject({ prospect: 'Marc Fictif', entrepriseSlug: 'gite-fictif', quand: { moment: 'matin' }, texte: 'texte fictif' });
    expect(sansDate).toBe(0);
  });

  it('un appel plus récent vers le prospect fait le rappel, même non abouti', async () => {
    await rappel('julie', jour(0, '16:30'));
    await rappel('marc', jour(0, '17:00'));
    await appelPlusRecent('julie');

    expect((await rappelsDuJour()).rappels.map((r) => r.prospectId)).toEqual(['marc']);
  });

  it('les simulations ne comptent pas : ni leurs rappels, ni comme rappel fait', async () => {
    await rappel('julie', jour(0, '16:30'));
    await appelPlusRecent('julie', { ligne: 'simulation', statut: 'termine' as never });
    await rappel('marc', jour(0, '17:00'), { ligne: 'simulation' as never });

    expect((await rappelsDuJour()).rappels.map((r) => r.prospectId)).toEqual(['julie']);
  });

  it('compte à part les rappels sans date, et un rappel plus récent remplace l’ancien', async () => {
    await rappel('julie', null);
    await rappel('marc', jour(-1, null), { debut: 5 * 86_400_000 });
    await rappel('marc', null, { debut: 86_400_000 });

    const { rappels, sansDate } = await rappelsDuJour();

    expect(rappels).toEqual([]);
    expect(sansDate).toBe(2);
  });
});

describe('filtre « rappels à faire » de la liste des appels', () => {
  it('ne garde que les rappels convenus encore à faire, datés ou non', async () => {
    const julie = await rappel('julie', jour(3, null));
    await rappel('marc', null);
    await appelPlusRecent('marc');

    const lignes = await listerAppels({ rappels: true }, 10);

    expect(lignes.map((l) => l.appel.id)).toEqual([julie.id]);
  });
});

describe('rappelEnAttente (fiche prospect)', () => {
  const quand = jour(2, '11:00');
  const base = { ligne: 'bluetooth', rappelLe: instantDuRappel(quand), bilan: { rappel: 'jeudi', rappelLe: quand } };

  it('le dernier appel hors simulation est un rappel convenu : il est à faire', () => {
    const r = rappelEnAttente([
      { ...base, id: 'a', debutLe: new Date('2026-09-28T10:00:00Z'), issueSysteme: 'rappel-convenu' },
      { ...base, id: 's', ligne: 'simulation', debutLe: new Date('2026-09-29T10:00:00Z'), issueSysteme: 'refus' },
    ]);

    expect(r).toEqual({ appelId: 'a', rappelLe: base.rappelLe, quand, texte: 'jeudi' });
  });

  it('un appel plus récent, même en échec, le fait', () => {
    expect(
      rappelEnAttente([
        { ...base, id: 'a', debutLe: new Date('2026-09-28T10:00:00Z'), issueSysteme: 'rappel-convenu' },
        { ...base, id: 'b', debutLe: new Date('2026-09-29T10:00:00Z'), issueSysteme: null, rappelLe: null, bilan: null },
      ]),
    ).toBeNull();
  });

  it('un ancien bilan sans date reste un rappel à faire, sans instant', () => {
    const r = rappelEnAttente([{ ...base, id: 'a', debutLe: new Date(), issueSysteme: 'rappel-convenu', rappelLe: null, bilan: { rappel: 'la semaine prochaine' } }]);

    expect(r).toEqual({ appelId: 'a', rappelLe: null, quand: null, texte: 'la semaine prochaine' });
  });
});
