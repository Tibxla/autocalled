import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { appels, campagnes, consentements, journalMcp, oppositions, prospects, rendezVous } from '@/db/schema';
import { agendaFrais, entrepriseDeTest, fiche } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import { preparerAppel } from './appels';
import { autorisationsDe } from './autorisations';
import { enregistrerCampagne } from './campagnes';
import { MENTION_NEUTRE, effacerPersonne, inventaireEffacement, marquesDeLaPersonne, phrasesEffacement } from './effacement';
import { creerScript } from './entreprises';
import { accesGoogle } from './google';
import { NUMERO_EFFACE, importerFiches, modifierProspect } from './prospects';

// L'API Google : absente par défaut ; un test la simule, sans réseau (fetch remplacé).
vi.mock('./google', async (original) => ({ ...(await original<Record<string, unknown>>()), accesGoogle: vi.fn(async () => null) }));

avecBaseDeTest();

let dossier: string;
const selDeTest = process.env.SEL_OPPOSITION;

beforeEach(async () => {
  dossier = await mkdtemp(join(tmpdir(), 'autocalled-effacement-'));
  process.env.DOSSIER_DONNEES = dossier;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.mocked(accesGoogle).mockReset();
  vi.mocked(accesGoogle).mockResolvedValue(null);
  process.env.SEL_OPPOSITION = selDeTest;
  delete process.env.DOSSIER_DONNEES;
  await rm(dossier, { recursive: true, force: true });
});

/** Julie (deux appels, dont un enregistré avec rendez-vous), Marc (un appel), et un journal des gestes qui les cite. */
async function monde() {
  const e = await entrepriseDeTest();
  await agendaFrais();
  await importerFiches(e.id, [
    { nomFichier: 'julie.md', contenu: '---\nnom: Julie Fictive\nsociete: Société fictive\ntelephone: "06 39 98 00 01"\nemail: julie@exemple.test\n---\n\nContexte fictif.\n' },
    fiche('marc', 'Marc Fictif', '06 39 98 00 02'),
  ]);
  const { versionScriptId } = await creerScript(e.id, 'Découverte');
  const tour = [{ role: 'prospect' as const, texte: 'Allô ?', secondes: 0 }];
  const [a1] = await db
    .insert(appels)
    .values({
      entrepriseId: e.id,
      prospectId: 'julie',
      versionScriptId,
      ligne: 'bluetooth',
      numero: '+33639980001',
      statut: 'termine',
      conversationId: 'conv_fictive_1',
      transcription: tour,
      audio: 'enregistrements/a1.mp3',
      issueSysteme: 'rendez-vous-pris',
    })
    .returning();
  const [a2] = await db
    .insert(appels)
    .values({ entrepriseId: e.id, prospectId: 'julie', versionScriptId, ligne: 'simulation', numero: '+33639980001', statut: 'termine', transcription: tour })
    .returning();
  const [m] = await db.insert(appels).values({ entrepriseId: e.id, prospectId: 'marc', versionScriptId, ligne: 'simulation', numero: '+33639980002', statut: 'termine' }).returning();
  // L'enregistrement de l'application porte le chemin de l'appel ; ceux du pont, l'identifiant de l'appel.
  await db.update(appels).set({ audio: `enregistrements/${a1!.id}.mp3` }).where(eq(appels.id, a1!.id));
  await mkdir(join(dossier, 'enregistrements'), { recursive: true });
  await mkdir(join(dossier, 'pont'), { recursive: true });
  for (const f of [`enregistrements/${a1!.id}.mp3`, `pont/${a1!.id}.wav`, `pont/${a1!.id}.log`, `pont/${m!.id}.wav`]) await writeFile(join(dossier, f), 'son fictif');
  const debut = new Date(Date.now() + 3 * 86_400_000);
  await db.insert(rendezVous).values({ appelId: a1!.id, debut, fin: new Date(debut.getTime() + 1_800_000), statut: 'cree', evenementId: 'evt_fictif', calendrier: 'calendrier-fictif', email: 'julie@exemple.test' });
  const seule = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'simulation', prospects: ['julie'] });
  const partagee = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'simulation', prospects: ['julie', 'marc'] });
  await db.insert(journalMcp).values([
    { outil: 'lire_prospect', arguments: { entreprise: 'gite-fictif', prospect: 'julie' }, resultat: 'ok' },
    {
      outil: 'lancer_appel',
      arguments: { entreprise: 'gite-fictif', prospect: 'julie' },
      resultat: 'confirmation-demandee',
      message: 'Appeler le 06 39 98 00 01 (Julie Fictive), Société fictive.',
    },
    { outil: 'importer_fiches', arguments: { entreprise: 'gite-fictif', fiches: [{ nomFichier: 'julie.md', octets: 120 }, { nomFichier: 'julie-martin.md', octets: 90 }] }, resultat: 'ok' },
    { outil: 'lire_prospect', arguments: { entreprise: 'gite-fictif', prospect: 'marc' }, resultat: 'ok' },
    // Un geste de la page Assistante qui la nomme (un premier message tapé à la main) : effacé comme les lignes du MCP.
    {
      origine: 'interface',
      outil: 'modifier_assistante',
      arguments: { premierMessageAvant: 'Allô ?', premierMessage: 'Bonjour Julie Fictive ?' },
      resultat: 'ok',
      confirmation: 'acceptee',
    },
  ]);
  return { e, versionScriptId, a1: a1!, a2: a2!, m: m!, seule, partagee, debut };
}

describe('inventaireEffacement', () => {
  it('compte ce qui sera effacé, et dit ce qui restera', async () => {
    const { e, debut } = await monde();

    const inv = await inventaireEffacement(e.id, 'julie');

    expect(inv).toMatchObject({
      prospect: { id: 'julie', nom: 'Julie Fictive', numeroLisible: '06 39 98 00 01', archive: false },
      appels: 2,
      transcriptions: 2,
      bilans: 0,
      enregistrements: 1,
      rendezVous: 1,
      evenements: [{ debut: debut.toISOString(), aVenir: true, supprimable: false }],
      entreesCampagne: 2,
      consentements: 1,
      mentionsJournal: 4,
      conversations: 1,
      autresPorteurs: [],
      obstacle: null,
    });
    const { efface, reste } = phrasesEffacement(inv!);
    expect(efface[1]).toBe('2 appels, avec 2 transcriptions et 0 bilan');
    expect(reste[0]).toContain('06 39 98 00 01 dans la liste d’opposition');
    expect(reste.join(' ')).toContain('1 événement d’agenda à supprimer à la main');
    expect(reste.at(-1)).toContain('Irréversible');
    expect(await inventaireEffacement(e.id, 'personne')).toBeNull();
  });
});

describe('effacerPersonne', () => {
  it('efface fiche, appels, rendez-vous, fichiers, files, consentement et mentions, et garde l’empreinte du numéro', async () => {
    const { e, a1, m, seule, partagee } = await monde();

    const r = await effacerPersonne(e.id, 'julie', 'interface');

    expect(r).toEqual({
      ok: true,
      efface: {
        appels: 2,
        transcriptions: 2,
        bilans: 0,
        rendezVous: 1,
        entreesCampagne: 2,
        campagnesSupprimees: 1,
        campagnesTerminees: 0,
        consentements: 1,
        mentionsJournal: 4,
        fichiers: 3,
        evenements: 0,
      },
      fichiersEnEchec: [],
      evenementsASupprimer: [expect.objectContaining({ calendrier: 'calendrier-fictif', raison: expect.stringContaining('non connectée') })],
      conversationsElevenLabs: ['conv_fictive_1'],
      autresPorteurs: [],
    });
    expect((await db.select({ id: prospects.id }).from(prospects)).map((p) => p.id)).toEqual(['marc']);
    expect((await db.select({ id: appels.id }).from(appels)).map((a) => a.id)).toEqual([m.id]);
    expect(await db.$count(rendezVous)).toBe(0);
    expect(await db.$count(consentements, eq(consentements.numero, '+33639980001'))).toBe(0);
    // Fichiers : ceux de Julie partis, celui de Marc intact.
    expect(existsSync(join(dossier, `enregistrements/${a1.id}.mp3`))).toBe(false);
    expect(existsSync(join(dossier, `pont/${a1.id}.wav`))).toBe(false);
    expect(existsSync(join(dossier, `pont/${a1.id}.log`))).toBe(false);
    expect(existsSync(join(dossier, `pont/${m.id}.wav`))).toBe(true);
    // Files : la campagne qui ne contenait qu'elle est supprimée, l'autre garde Marc seul.
    expect(await db.$count(campagnes, eq(campagnes.id, seule))).toBe(0);
    expect((await db.select().from(campagnes).where(eq(campagnes.id, partagee)))[0]?.entrees).toEqual([{ prospectId: 'marc', etat: 'a-appeler' }]);
    // Journal : plus aucune trace, les autres lignes intactes.
    const journal = await db.select().from(journalMcp);
    const texte = JSON.stringify(journal);
    for (const trace of ['"julie"', 'Julie Fictive', '06 39 98 00 01', 'julie.md']) expect(texte).not.toContain(trace);
    expect(texte).toContain(MENTION_NEUTRE);
    expect(texte).toContain('julie-martin.md');
    expect(journal.find((l) => l.outil === 'lancer_appel')?.message).toBe(`Appeler le ${MENTION_NEUTRE} (${MENTION_NEUTRE}), Société fictive.`);
    expect(journal.map((l) => l.arguments)).toContainEqual({ entreprise: 'gite-fictif', prospect: 'marc' });
    expect(journal.find((l) => l.origine === 'interface')?.arguments).toEqual({ premierMessageAvant: 'Allô ?', premierMessage: `Bonjour ${MENTION_NEUTRE} ?` });
    // Opposition : une empreinte et le témoin, sans le numéro en clair.
    const liste = await db.select().from(oppositions);
    expect(liste).toHaveLength(2);
    expect(JSON.stringify(liste)).not.toContain('39980001');
    expect(liste.find((o) => !o.temoin)).toMatchObject({ par: 'interface', bilan: expect.objectContaining({ appels: 2 }) });
  });

  it('un numéro effacé ne peut plus être importé, ni autorisé, ni appelé', async () => {
    const { e, versionScriptId } = await monde();
    await effacerPersonne(e.id, 'julie', 'mcp');

    const rapport = await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('lea', 'Léa Fictive', '06 39 98 00 03')], 'mcp');

    expect(rapport).toMatchObject({ etat: 'fait', crees: ['lea'], numerosAutorises: 1, refus: [{ nomFichier: 'julie.md', erreurs: [NUMERO_EFFACE] }] });
    expect(await db.$count(prospects, eq(prospects.id, 'julie'))).toBe(0);
    expect(await db.$count(consentements, eq(consentements.numero, '+33639980001'))).toBe(0);
    expect((await autorisationsDe(['+33639980001'])).get('+33639980001')).toEqual({ autorise: false, raison: 'numero-efface' });
    // Un autre prospect ne peut pas prendre ce numéro par une correction.
    expect(await modifierProspect(e.id, 'lea', { telephone: '06 39 98 00 01' }, { canal: 'mcp' })).toMatchObject({ ok: false, raison: expect.stringContaining(NUMERO_EFFACE) });
    expect(await preparerAppel(e.id, 'lea', versionScriptId)).toMatchObject({ ok: true });
  });

  it('garde les autres prospects du même numéro, les nomme, et les rend inappelables', async () => {
    const { e, versionScriptId } = await monde();
    const autre = await entrepriseDeTest('Chalet fictif', 'chalet-fictif');
    await importerFiches(autre.id, [fiche('julie-f', 'Julie Fictive', '06 39 98 00 01')]);
    const { versionScriptId: versionAutre } = await creerScript(autre.id, 'Découverte');
    const porteur = { entreprise: 'chalet-fictif', entrepriseNom: 'Chalet fictif', prospect: 'julie-f', nom: 'Julie Fictive' };

    const inv = await inventaireEffacement(e.id, 'julie');
    expect(inv?.autresPorteurs).toEqual([porteur]);
    expect(phrasesEffacement(inv!).reste[1]).toBe(
      'Ce numéro est aussi celui de Julie Fictive (Chalet fictif) : sa fiche reste, mais ce prospect ne sera plus appelable. Si c’est la même personne, efface cette fiche aussi.',
    );

    expect(await effacerPersonne(e.id, 'julie', 'interface')).toMatchObject({ ok: true, autresPorteurs: [porteur] });

    expect(await db.$count(prospects, eq(prospects.id, 'julie-f'))).toBe(1);
    expect(await preparerAppel(autre.id, 'julie-f', versionAutre)).toEqual({
      ok: false,
      raison: 'Ce numéro appartient à une personne effacée à sa demande : il ne sera plus jamais composé.',
    });
    expect(versionScriptId).not.toBe(versionAutre);
    // L'effacer à son tour : même empreinte, aucune seconde ligne.
    expect(await effacerPersonne(autre.id, 'julie-f', 'interface')).toMatchObject({ ok: true, efface: { consentements: 0 } });
    expect(await db.$count(oppositions)).toBe(2);
  });

  it('refuse pendant un appel, un rapatriement ou une inscription d’agenda, et sans sel', async () => {
    const { e, a1, a2 } = await monde();
    const maintenant = new Date();

    await db.update(appels).set({ statut: 'en-cours' }).where(eq(appels.id, a2.id));
    expect(await effacerPersonne(e.id, 'julie', 'interface')).toMatchObject({ ok: false, raison: expect.stringContaining('en cours') });
    await db.update(appels).set({ statut: 'traitement', traitementLe: maintenant }).where(eq(appels.id, a2.id));
    expect(await effacerPersonne(e.id, 'julie', 'interface')).toMatchObject({ ok: false, raison: expect.stringContaining('en cours de calcul') });
    // Une analyse bloquée depuis longtemps n'empêche pas l'effacement.
    await db.update(appels).set({ traitementLe: new Date(maintenant.getTime() - 3_600_000) }).where(eq(appels.id, a2.id));
    await db.update(rendezVous).set({ statut: 'a-creer', creeLe: maintenant }).where(eq(rendezVous.appelId, a1.id));
    expect(await effacerPersonne(e.id, 'julie', 'interface')).toMatchObject({ ok: false, raison: expect.stringContaining('inscription') });
    await db.update(rendezVous).set({ statut: 'cree' }).where(eq(rendezVous.appelId, a1.id));
    delete process.env.SEL_OPPOSITION;
    expect(await effacerPersonne(e.id, 'julie', 'interface')).toMatchObject({ ok: false, raison: expect.stringContaining('SEL_OPPOSITION manque') });
    expect((await inventaireEffacement(e.id, 'julie'))?.obstacle).toContain('SEL_OPPOSITION manque');

    expect(await db.$count(prospects, eq(prospects.id, 'julie'))).toBe(1);
    expect(await db.$count(appels)).toBe(3);
    expect(await db.$count(oppositions)).toBe(0);
  });

  it('ne compose ni n’importe plus rien si le sel change ou disparaît après un effacement', async () => {
    const { e, versionScriptId } = await monde();
    await effacerPersonne(e.id, 'julie', 'interface');

    for (const sel of [undefined, 'un-autre-sel-de-test-de-trente-deux-caracteres']) {
      if (sel) process.env.SEL_OPPOSITION = sel;
      else delete process.env.SEL_OPPOSITION;
      expect((await autorisationsDe(['+33639980001', '+33639980002'])).get('+33639980002')).toEqual({ autorise: false, raison: 'opposition-illisible' });
      expect(await preparerAppel(e.id, 'marc', versionScriptId)).toMatchObject({ ok: false, raison: expect.stringContaining('liste d’opposition') });
      expect(await importerFiches(e.id, [fiche('lea', 'Léa Fictive', '06 39 98 00 03')])).toMatchObject({ etat: 'erreur', message: expect.stringContaining('SEL_OPPOSITION') });
      expect(await effacerPersonne(e.id, 'marc', 'interface')).toMatchObject({ ok: false });
    }
    // Rien n'a été écrit avec le mauvais sel : remis, tout revient.
    process.env.SEL_OPPOSITION = selDeTest;
    expect(await db.$count(oppositions)).toBe(2);
    expect((await autorisationsDe(['+33639980002'])).get('+33639980002')?.autorise).toBe(true);
  });

  it('supprime l’événement du calendrier d’Autocalled par l’API, en prévenant l’invité d’un rendez-vous à venir', async () => {
    const { e } = await monde();
    vi.mocked(accesGoogle).mockResolvedValue({ acces: 'jeton-fictif', calendrierId: 'calendrier-fictif' });
    const appelsGoogle: { url: string; methode: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        appelsGoogle.push({ url, methode: String(init.method) });
        return new Response(null, { status: 204 });
      }),
    );

    const r = await effacerPersonne(e.id, 'julie', 'interface');

    expect(r).toMatchObject({ ok: true, efface: { evenements: 1 }, evenementsASupprimer: [] });
    expect(appelsGoogle).toEqual([
      { url: 'https://www.googleapis.com/calendar/v3/calendars/calendrier-fictif/events/evt_fictif?sendUpdates=all', methode: 'DELETE' },
    ]);
  });

  it('refuse un prospect inconnu', async () => {
    const { e } = await monde();
    expect(await effacerPersonne(e.id, 'personne', 'interface')).toMatchObject({ ok: false, raison: expect.stringContaining('n’existe pas') });
  });
});

describe('marquesDeLaPersonne', () => {
  it('cherche des mots entiers : un autre identifiant qui commence pareil n’est pas touché', () => {
    const { expressions } = marquesDeLaPersonne({ id: 'julie', nom: 'Julie Fictive', email: null, telephone: '+33639980001' });
    const neutre = (t: string) => expressions.reduce((x, e) => x.replace(e, MENTION_NEUTRE), t);

    expect(neutre('julie julie-martin julie.md Julie')).toBe(`${MENTION_NEUTRE} julie-martin ${MENTION_NEUTRE}.md Julie`);
    expect(neutre('JULIE FICTIVE au 0639980001 ou +33639980001')).toBe(`${MENTION_NEUTRE} au ${MENTION_NEUTRE} ou ${MENTION_NEUTRE}`);
  });
});
