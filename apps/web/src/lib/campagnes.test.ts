import { debuterAppel } from '@autocalled/domain';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, campagnes } from '@/db/schema';
import { fauxPont } from '../../test/faux-pont';
import { agendaFrais, entrepriseDeTest, fiche } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import {
  ajouterALaCampagne,
  appelerSuivantNavigateur,
  appelerSuivantTelephone,
  avecCampagne,
  clore,
  demarrerCampagne,
  derouleSimulation,
  enregistrerCampagne,
  retirerProspect,
  sauterProspect,
  supprimerCampagnePrete,
  terminerCampagne,
} from './campagnes';
import { basculerArchiveScript, creerScript } from './entreprises';
import { importerFiches, revoquerNumero } from './prospects';

avecBaseDeTest();

let pont: Awaited<ReturnType<typeof fauxPont>>;
let entrepriseId: string;
let scriptId: string;
let versionScriptId: string;

beforeEach(async () => {
  const e = await entrepriseDeTest();
  entrepriseId = e.id;
  await importerFiches(e.id, [
    fiche('julie', 'Julie Fictive', '06 39 98 00 01'),
    fiche('marc', 'Marc Fictif', '06 39 98 00 02'),
    fiche('lea', 'Léa Fictive', '06 39 98 00 03'),
    fiche('paul', 'Paul Fictif', '06 39 98 00 04'),
    fiche('anne', 'Anne Fictive', '06 39 98 00 05'),
  ]);
  ({ scriptId, versionScriptId } = await creerScript(e.id, 'Découverte'));
  await agendaFrais();
  pont = await fauxPont();
});

afterEach(async () => {
  await pont.fermer();
});

async function lire(id: string) {
  const [c] = await db.select().from(campagnes).where(eq(campagnes.id, id));
  if (!c) throw new Error('campagne introuvable');
  return c;
}

const ordre = async (id: string) => (await lire(id)).entrees.map((e) => [e.prospectId, e.etat]);

/** Campagne téléphone lancée : le premier appel est composé par le faux pont. */
async function campagneTelephone(prospects = ['julie', 'marc', 'lea']) {
  const id = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects });
  await demarrerCampagne(id);
  await appelerSuivantTelephone(id);
  return id;
}

/** Ce que fait la route de fin du pont : clôt l'entrée, puis enchaîne. */
async function finDAppel(campagneId: string) {
  const entree = (await lire(campagneId)).entrees.find((e) => e.etat === 'en-appel');
  if (entree?.etat !== 'en-appel') throw new Error('aucun appel en cours');
  await db.update(appels).set({ statut: 'termine', issue: 'non-abouti', issueSysteme: 'non-abouti', finLe: new Date() }).where(eq(appels.id, entree.appelId));
  await clore(campagneId, entree.appelId);
  await appelerSuivantTelephone(campagneId);
}

const numerosComposes = () => pont.compositions().map((r) => (r.corps as { numero: string }).numero);

describe('Sauter', () => {
  it('campagne téléphone : le prospect sauté repasse en fin de file, l’enchaînement prend le suivant', async () => {
    const id = await campagneTelephone();

    expect(await sauterProspect(id, 'marc')).toEqual({ ok: true });
    expect(await ordre(id)).toEqual([
      ['julie', 'en-appel'],
      ['lea', 'a-appeler'],
      ['marc', 'a-appeler'],
    ]);
    // Rien n'est composé par le geste lui-même.
    expect(pont.compositions()).toHaveLength(1);

    await finDAppel(id);
    expect(numerosComposes()).toEqual(['+33639980001', '+33639980003']);
    expect((await lire(id)).entrees.find((e) => e.prospectId === 'marc')).toEqual({ prospectId: 'marc', etat: 'a-appeler', sauts: 1 });
    // Chaque composition porte le premier message de l'assistante, et chaque appel le nom sous lequel elle parle.
    expect(pont.compositions().map((r) => (r.corps as { premierMessage: string }).premierMessage)).toEqual(['Allô ?', 'Allô ?']);
    expect((await db.select({ nom: appels.assistanteNom }).from(appels)).map((a) => a.nom)).toEqual(['Mina', 'Mina']);
  });

  it('refuse l’appel en cours, le dernier à appeler et une campagne terminée, en le disant', async () => {
    const id = await campagneTelephone();

    expect(await sauterProspect(id, 'julie')).toEqual({ ok: false, raison: expect.stringContaining('en appel') });
    expect(await sauterProspect(id, 'lea')).toEqual({ ok: false, raison: expect.stringContaining('dernier') });
    expect(await sauterProspect(id, 'inconnu')).toEqual({ ok: false, raison: expect.stringContaining('pas dans la file') });
    expect(await sauterProspect('pas-un-identifiant', 'lea')).toEqual({ ok: false, raison: 'Campagne introuvable.' });
  });
});

describe('Retirer', () => {
  it('campagne téléphone : le prospect retiré n’est pas appelé, la trace reste', async () => {
    const id = await campagneTelephone();

    expect(await retirerProspect(id, 'marc')).toEqual({ ok: true, terminee: false });
    const marc = (await lire(id)).entrees.find((e) => e.prospectId === 'marc');
    expect(marc).toMatchObject({ etat: 'retiree', motif: 'retrait', par: 'interface' });
    expect(marc?.etat === 'retiree' && Date.parse(marc.le)).toBeGreaterThan(Date.now() - 60_000);

    await finDAppel(id);
    await finDAppel(id);
    expect(numerosComposes()).toEqual(['+33639980001', '+33639980003']);
    expect((await lire(id)).statut).toBe('terminee');
  });

  it('garde l’origine du geste (serveur MCP)', async () => {
    const id = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['julie', 'marc'] });

    await retirerProspect(id, 'marc', 'mcp');

    expect((await lire(id)).entrees[1]).toMatchObject({ etat: 'retiree', par: 'mcp' });
  });

  it('retirer le dernier prospect restant d’une campagne prête la termine', async () => {
    const id = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['julie'] });

    expect(await retirerProspect(id, 'julie')).toEqual({ ok: true, terminee: true });
    expect((await lire(id)).statut).toBe('terminee');
    expect(await retirerProspect(id, 'julie')).toEqual({ ok: false, raison: expect.stringContaining('terminée') });
  });
});

describe('Ajouter', () => {
  it('ajoute en fin de file d’une campagne téléphone en cours, qui les appelle à leur tour', async () => {
    const id = await campagneTelephone(['julie']);

    expect(await ajouterALaCampagne(id, ['paul', 'anne'])).toEqual({ ok: true, ajoutes: 2 });
    expect(await ordre(id)).toEqual([
      ['julie', 'en-appel'],
      ['paul', 'a-appeler'],
      ['anne', 'a-appeler'],
    ]);
    expect(pont.compositions()).toHaveLength(1);

    await finDAppel(id);
    expect(numerosComposes()).toEqual(['+33639980001', '+33639980004']);
  });

  it('tout ou rien : refuse un numéro non autorisé, un doublon, un prospect inconnu', async () => {
    const id = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['julie', 'marc'] });
    await revoquerNumero('+33639980005');

    const nonAutorise = await ajouterALaCampagne(id, ['paul', 'anne']);
    expect(nonAutorise).toEqual({ ok: false, raison: expect.stringContaining('Anne Fictive') });
    const doublon = await ajouterALaCampagne(id, ['paul', 'marc']);
    expect(doublon).toEqual({ ok: false, raison: expect.stringContaining('Déjà dans la file : Marc Fictif') });
    expect(await ajouterALaCampagne(id, ['personne'])).toEqual({ ok: false, raison: expect.stringContaining('introuvable') });
    expect(await ajouterALaCampagne(id, [])).toEqual({ ok: false, raison: 'Choisis au moins un prospect.' });

    expect(await ordre(id)).toEqual([
      ['julie', 'a-appeler'],
      ['marc', 'a-appeler'],
    ]);
  });

  it('refuse un script archivé et une campagne terminée', async () => {
    const id = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'simulation', prospects: ['julie'] });

    await basculerArchiveScript(entrepriseId, scriptId, true);
    expect(await ajouterALaCampagne(id, ['paul'])).toEqual({ ok: false, raison: expect.stringContaining('archivé') });

    await basculerArchiveScript(entrepriseId, scriptId, false);
    await terminerCampagne(id);
    expect(await ajouterALaCampagne(id, ['paul'])).toEqual({ ok: false, raison: expect.stringContaining('terminée') });
  });
});

describe('Terminer', () => {
  it('campagne téléphone pendant un appel : l’appel va à son terme, rien d’autre ne part, puis elle est terminée', async () => {
    const id = await campagneTelephone();

    expect(await terminerCampagne(id)).toEqual({ ok: true, fin: 'apres-appel' });
    const pendant = await lire(id);
    expect(pendant.statut).toBe('en-cours');
    expect(pendant.entrees.map((e) => e.etat)).toEqual(['en-appel', 'retiree', 'retiree']);
    expect(await ajouterALaCampagne(id, ['paul'])).toEqual({ ok: false, raison: expect.stringContaining('se termine') });
    expect(await terminerCampagne(id)).toEqual({ ok: false, raison: expect.stringContaining('déjà') });

    await finDAppel(id);
    expect(pont.compositions()).toHaveLength(1);
    expect((await lire(id)).statut).toBe('terminee');
  });

  it('sans appel en cours : terminée tout de suite, l’enchaînement suivant ne compose rien', async () => {
    const id = await campagneTelephone();
    const entree = (await lire(id)).entrees[0];
    if (entree?.etat !== 'en-appel') throw new Error('appel attendu');
    await clore(id, entree.appelId);

    expect(await terminerCampagne(id)).toEqual({ ok: true, fin: 'immediate' });
    await appelerSuivantTelephone(id);

    expect(pont.compositions()).toHaveLength(1);
    expect((await lire(id)).statut).toBe('terminee');
  });

  it('refuse une campagne déjà terminée, et une campagne dont l’appel en cours est le dernier', async () => {
    const id = await campagneTelephone(['julie']);

    expect(await terminerCampagne(id)).toEqual({ ok: false, raison: expect.stringContaining('Plus aucun prospect') });
    await finDAppel(id);
    expect(await terminerCampagne(id)).toEqual({ ok: false, raison: 'La campagne est déjà terminée.' });
  });
});

describe('campagne simulée (lancée aussi par le MCP en tâche détachée)', () => {
  it('un prospect retiré n’est pas simulé ; le déroulé va au bout', async () => {
    const id = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'simulation', prospects: ['julie', 'marc', 'lea'] });
    await demarrerCampagne(id);
    await retirerProspect(id, 'marc');
    await sauterProspect(id, 'julie');

    // claude -p est interdit en test : chaque appel simulé échoue, mais la file avance comme en vrai.
    await derouleSimulation(id);

    const c = await lire(id);
    expect(c.statut).toBe('terminee');
    expect(c.entrees.map((e) => [e.prospectId, e.etat])).toEqual([
      ['marc', 'retiree'],
      ['lea', 'appelee'],
      ['julie', 'appelee'],
    ]);
    const simules = await db.select({ prospectId: appels.prospectId }).from(appels).where(eq(appels.campagneId, id)).orderBy(appels.debutLe);
    expect(simules.map((a) => a.prospectId)).toEqual(['lea', 'julie']);
  });

  it('terminée pendant un appel simulé : le déroulé s’arrête après lui', async () => {
    const id = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'simulation', prospects: ['julie', 'marc'] });
    await demarrerCampagne(id);
    // Un appel simulé en cours, posé comme le fait derouleSimulation.
    const [appel] = await db
      .insert(appels)
      .values({ entrepriseId, prospectId: 'julie', versionScriptId, campagneId: id, ligne: 'simulation', numero: '+33639980001' })
      .returning({ id: appels.id });
    if (!appel) throw new Error('appel non créé');
    await avecCampagne(id, async (c) => ({ campagne: debuterAppel(c, 'julie', appel.id), resultat: null }));

    expect(await terminerCampagne(id)).toEqual({ ok: true, fin: 'apres-appel' });
    await clore(id, appel.id);
    await derouleSimulation(id);

    expect((await lire(id)).statut).toBe('terminee');
    expect(await db.$count(appels, eq(appels.campagneId, id))).toBe(1);
  });
});

describe('ligne navigateur', () => {
  it('ne part pas vers un autre prospect que celui affiché quand la file a changé', async () => {
    const id = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'navigateur', prospects: ['julie', 'marc'] });
    await demarrerCampagne(id);
    await sauterProspect(id, 'julie');

    const r = await appelerSuivantNavigateur(id, 'julie');

    expect(r).toEqual({ type: 'attente', raison: expect.stringContaining('La file a changé') });
    expect(await db.$count(appels)).toBe(0);
  });
});

describe('supprimerCampagnePrete', () => {
  it('supprime une campagne jamais lancée, refuse une campagne lancée', async () => {
    const prete = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'simulation', prospects: ['julie'] });
    const lancee = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'simulation', prospects: ['marc'] });
    await db.update(campagnes).set({ statut: 'terminee' }).where(eq(campagnes.id, lancee));

    expect(await supprimerCampagnePrete(prete)).toEqual({ ok: true });
    expect(await supprimerCampagnePrete(lancee)).toMatchObject({ ok: false, raison: expect.stringContaining('Seule une campagne prête') });
    expect(await supprimerCampagnePrete('pas-un-uuid')).toEqual({ ok: false, raison: 'Campagne introuvable.' });
    expect((await db.select({ id: campagnes.id }).from(campagnes)).map((c) => c.id)).toEqual([lancee]);
  });
});
