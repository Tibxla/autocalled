import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { campagnes } from '@/db/schema';
import { enregistrerCampagne } from '@/lib/campagnes';
import { creerScript } from '@/lib/entreprises';
import { importerFiches, revoquerNumero } from '@/lib/prospects';
import { clientDeTest } from '../test/client-mcp';
import { fauxPont } from '../test/faux-pont';
import { agendaFrais, entrepriseDeTest, fiche } from '../test/fixtures';
import { avecBaseDeTest } from '../test/outils';

avecBaseDeTest();

type Client = Awaited<ReturnType<typeof clientDeTest>>;
let client: Client | undefined;
let pont: Awaited<ReturnType<typeof fauxPont>>;
let entrepriseId: string;
let versionScriptId: string;

beforeEach(async () => {
  const e = await entrepriseDeTest();
  entrepriseId = e.id;
  await importerFiches(e.id, [
    fiche('julie', 'Julie Fictive', '06 39 98 00 01'),
    fiche('marc', 'Marc Fictif', '06 39 98 00 02'),
    fiche('lea', 'Léa Fictive', '06 39 98 00 03'),
  ]);
  ({ versionScriptId } = await creerScript(e.id, 'Découverte'));
  await agendaFrais();
  pont = await fauxPont();
});
afterEach(async () => {
  await client?.fermer();
  client = undefined;
  await pont.fermer();
});

async function connecter(elicitation?: 'accepter' | 'refuser') {
  client = await clientDeTest({ elicitation });
  return client;
}
const lire = async (id: string) => (await db.select().from(campagnes).where(eq(campagnes.id, id)))[0]!;

describe('gestes sur la file', () => {
  it('saute, retire (trace mcp) et termine, sans confirmation', async () => {
    const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'simulation', prospects: ['julie', 'marc', 'lea'] });
    const { appeler, messages } = await connecter('accepter');

    expect((await appeler('sauter_dans_la_file', { campagneId, prospect: 'julie' })).json).toEqual({ campagneId, prospect: 'julie', reporte: true });
    expect((await appeler('retirer_de_la_file', { campagneId, prospect: 'marc' })).json).toMatchObject({ retire: true, campagneTerminee: false });
    expect((await lire(campagneId)).entrees.map((x) => x.prospectId)).toEqual(['marc', 'lea', 'julie']);
    expect((await lire(campagneId)).entrees[0]).toMatchObject({ etat: 'retiree', motif: 'retrait', par: 'mcp' });

    const lue = (await appeler('lire_campagne', { campagneId })).json as { file: object[] };
    expect(lue.file).toEqual([
      expect.objectContaining({ prospect: 'marc', etat: 'retiree', motif: 'retrait', par: 'mcp' }),
      expect.objectContaining({ prospect: 'lea', etat: 'a-appeler', sauts: 0, numeroAutorise: true }),
      expect.objectContaining({ prospect: 'julie', etat: 'a-appeler', sauts: 1, numeroAutorise: true }),
    ]);

    expect((await appeler('terminer_campagne', { campagneId })).json).toEqual({ campagneId, fin: 'immediate' });
    expect((await lire(campagneId)).statut).toBe('terminee');
    expect((await appeler('lister_campagnes', { entreprise: 'gite-fictif' })).json).toEqual([
      expect.objectContaining({ campagneId, traites: 3, retirees: 3, total: 3, finDemandee: false }),
    ]);
    expect(messages).toHaveLength(0);
  });

  it('supprime une campagne prête, jamais une campagne lancée', async () => {
    const prete = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'simulation', prospects: ['julie'] });
    const lancee = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'simulation', prospects: ['marc'] });
    await db.update(campagnes).set({ statut: 'en-pause' }).where(eq(campagnes.id, lancee));
    const { appeler } = await connecter();

    expect((await appeler('supprimer_campagne', { campagneId: prete })).json).toEqual({ campagneId: prete, supprimee: true });
    expect(await appeler('supprimer_campagne', { campagneId: lancee })).toMatchObject({ erreur: true, texte: expect.stringContaining('Seule une campagne prête') });
    expect(await db.$count(campagnes)).toBe(1);
  });
});

describe('ajouter_a_la_campagne', () => {
  it('ajoute sans confirmation à une campagne qui ne sonne pas (prête, simulation)', async () => {
    const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['julie'] });
    const { appeler, messages } = await connecter('accepter');

    expect((await appeler('ajouter_a_la_campagne', { campagneId, prospects: ['marc'] })).json).toEqual({ campagneId, ajoutes: 1 });
    expect(messages).toHaveLength(0);
  });

  it('demande l’accord sur une campagne téléphone en cours, avec les noms, numéros et l’heure', async () => {
    const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['julie'] });
    await db.update(campagnes).set({ statut: 'en-cours' }).where(eq(campagnes.id, campagneId));
    await importerFiches(entrepriseId, [fiche('paul', 'Paul Fictif', '06 39 98 00 04')], 'mcp');

    const refus = await connecter('refuser');
    expect((await refus.appeler('ajouter_a_la_campagne', { campagneId, prospects: ['marc', 'paul'] })).erreur).toBe(true);
    expect((await lire(campagneId)).entrees).toHaveLength(1);
    expect(refus.messages[0]).toMatch(
      /^Ajouter à la campagne de Gîte fictif, en cours sur le téléphone passerelle, 2 prospects qui seront appelés à la suite sans autre geste : Marc Fictif \(06 39 98 00 02\), Paul Fictif \(06 39 98 00 04\)\. Un de ces numéros a été ajouté par le MCP \(le dernier le .+\)\. Nous sommes /,
    );
    await refus.fermer();

    const accord = await connecter('accepter');
    expect((await accord.appeler('ajouter_a_la_campagne', { campagneId, prospects: ['marc', 'paul'] })).json).toEqual({ campagneId, ajoutes: 2 });
    expect(pont.compositions()).toHaveLength(0);
  });

  it('refuse sans rien demander un numéro non autorisé ou un prospect inconnu', async () => {
    const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['julie'] });
    await db.update(campagnes).set({ statut: 'en-cours' }).where(eq(campagnes.id, campagneId));
    await revoquerNumero('+33639980002');
    const { appeler, messages } = await connecter('accepter');

    expect(await appeler('ajouter_a_la_campagne', { campagneId, prospects: ['marc'] })).toMatchObject({ erreur: true, texte: 'Numéro non autorisé : Marc Fictif. Rien n’a été ajouté.' });
    expect(await appeler('ajouter_a_la_campagne', { campagneId, prospects: ['personne'] })).toMatchObject({ erreur: true, texte: expect.stringContaining('introuvable') });
    expect(messages).toHaveLength(0);
  });
});
