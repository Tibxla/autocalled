import { and, eq, isNotNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, campagnes, consentements, imports, journalMcp, oppositions, prospects } from '@/db/schema';
import { enregistrerCampagne } from '@/lib/campagnes';
import { MENTION_NEUTRE } from '@/lib/effacement';
import { creerScript } from '@/lib/entreprises';
import { NUMERO_EFFACE, importerFiches } from '@/lib/prospects';
import { clientDeTest } from '../test/client-mcp';
import { entrepriseDeTest, fiche } from '../test/fixtures';
import { avecBaseDeTest } from '../test/outils';

avecBaseDeTest();

type Client = Awaited<ReturnType<typeof clientDeTest>>;
let client: Client | undefined;
let entrepriseId: string;

beforeEach(async () => {
  const e = await entrepriseDeTest();
  entrepriseId = e.id;
  await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01', 'Contexte fictif et confidentiel.'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
});
afterEach(async () => {
  await client?.fermer();
  client = undefined;
});

async function connecter(elicitation?: 'accepter' | 'refuser' | 'annuler') {
  client = await clientDeTest({ elicitation });
  return client;
}

describe('modifier_prospect', () => {
  it('corrige la fiche par le canal mcp, autorise le nouveau numéro, et ne garde au journal que les noms des champs', async () => {
    const { appeler } = await connecter();
    const { majLe } = (await appeler('lire_prospect', { entreprise: 'gite-fictif', prospect: 'julie' })).json as { majLe: string };

    const r = await appeler('modifier_prospect', { entreprise: 'gite-fictif', prospect: 'julie', champs: { telephone: '06 39 98 00 05', contexte: 'Nouveau contexte privé.' }, connu: majLe });

    expect(r.json).toMatchObject({ prospect: 'julie', rapport: { misAJour: ['julie'], numerosAutorises: 1 } });
    expect((await db.select({ telephone: prospects.telephone }).from(prospects).where(eq(prospects.id, 'julie')))[0]?.telephone).toBe('+33639980005');
    expect((await db.select({ canal: imports.canal }).from(imports)).map((i) => i.canal)).toEqual(['interface', 'mcp']);
    const [ligne] = await db.select().from(journalMcp).where(eq(journalMcp.outil, 'modifier_prospect'));
    // Le contexte n'y est pas ; le numéro saisi, si (l'ancien et le nouveau sont dans le message du succès).
    expect(ligne?.arguments).toEqual({ entreprise: 'gite-fictif', prospect: 'julie', champs: ['telephone', 'contexte'], telephone: '06 39 98 00 05', connu: majLe });
    expect(ligne?.message).toBe('numéro 06 39 98 00 01 → 06 39 98 00 05');
    expect((await appeler('lister_prospects', { entreprise: 'gite-fictif', recherche: 'julie' })).json).toMatchObject({
      prospects: [expect.objectContaining({ prospect: 'julie', numero: '06 39 98 00 05', numeroAjouteParMcp: expect.any(String) })],
    });

    expect(await appeler('modifier_prospect', { entreprise: 'gite-fictif', prospect: 'julie', champs: { role: 'Gérante' }, connu: majLe })).toMatchObject({
      erreur: true,
      texte: expect.stringContaining('a changé depuis ta lecture'),
    });
  });
});

describe('archiver_prospect et reactiver_prospect', () => {
  it('archive sans rien demander hors de toute file, le cache de la liste, et le réactive', async () => {
    const { versionScriptId } = await creerScript(entrepriseId, 'Découverte');
    const { appeler, messages } = await connecter('accepter');

    expect((await appeler('archiver_prospect', { entreprise: 'gite-fictif', prospect: 'julie' })).json).toEqual({
      prospect: 'julie',
      archive: true,
      dejaArchive: false,
      retireDesFiles: [],
    });
    expect(messages).toHaveLength(0);
    const liste = async (args: Record<string, unknown> = {}) =>
      ((await appeler('lister_prospects', { entreprise: 'gite-fictif', ...args })).json as { prospects: { prospect: string }[] }).prospects.map((p) => p.prospect);
    expect(await liste()).toEqual(['marc']);
    expect(await liste({ archives: true })).toEqual(['julie']);
    expect((await appeler('lire_prospect', { entreprise: 'gite-fictif', prospect: 'julie' })).json).toMatchObject({ archiveLe: expect.any(String) });
    expect(await appeler('nouvelle_campagne', { entreprise: 'gite-fictif', versionScriptId, ligne: 'simulation', prospects: ['julie'] })).toMatchObject({
      erreur: true,
      texte: expect.stringContaining('archivé'),
    });
    expect(await appeler('lancer_appel', { entreprise: 'gite-fictif', prospect: 'julie', versionScriptId, ligne: 'simulation' })).toMatchObject({
      erreur: true,
      texte: expect.stringContaining('archivé'),
    });

    expect((await appeler('reactiver_prospect', { entreprise: 'gite-fictif', prospect: 'julie' })).json).toEqual({ prospect: 'julie', archive: false, dejaActif: false });
    expect(await liste()).toEqual(['julie', 'marc']);
  });

  it('demande l’accord, rédigé depuis la base, quand il attend dans une file, et n’archive rien sans lui', async () => {
    const { versionScriptId } = await creerScript(entrepriseId, 'Découverte');
    const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'simulation', prospects: ['julie', 'marc'] });
    const { appeler, messages } = await connecter('refuser');

    expect(await appeler('archiver_prospect', { entreprise: 'gite-fictif', prospect: 'julie' })).toMatchObject({ erreur: true, texte: expect.stringContaining('n’a pas confirmé') });

    expect(messages[0]).toMatch(
      /^Retirer Julie Fictive \(Société fictive\), de l’entreprise Gîte fictif, de la file d’une campagne où ce prospect attend d’être appelé, et l’archiver : Campagne du \d\d\/\d\d · Découverte v1, prête\. Il n’y sera pas appelé, et le retrait ne se défait pas : réactivé, il ne revient dans aucune file\.$/,
    );
    expect(await db.$count(prospects, isNotNull(prospects.archiveLe))).toBe(0);
    expect((await db.select().from(campagnes).where(eq(campagnes.id, campagneId)))[0]?.entrees[0]).toEqual({ prospectId: 'julie', etat: 'a-appeler' });
  });

  it('archive et retire de la file après l’accord, en disant la campagne qui se termine', async () => {
    const { versionScriptId } = await creerScript(entrepriseId, 'Découverte');
    const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'simulation', prospects: ['julie'] });
    const { appeler, messages } = await connecter('accepter');

    expect((await appeler('archiver_prospect', { entreprise: 'gite-fictif', prospect: 'julie' })).json).toEqual({
      prospect: 'julie',
      archive: true,
      dejaArchive: false,
      retireDesFiles: [campagneId],
      campagnesTerminees: [campagneId],
    });
    expect(messages[0]).toContain('(plus personne d’autre à y appeler : elle se terminera)');
    const [ligne] = await db.select().from(journalMcp).where(and(eq(journalMcp.outil, 'archiver_prospect'), eq(journalMcp.resultat, 'ok')));
    expect(ligne?.confirmation).toBe('acceptee');
  });
});

describe('effacer_personne', () => {
  it('pose la question rédigée depuis la base, n’efface rien sans accord', async () => {
    const { versionScriptId } = await creerScript(entrepriseId, 'Découverte');
    await db.insert(appels).values({ entrepriseId, prospectId: 'julie', versionScriptId, ligne: 'simulation', numero: '+33639980001', statut: 'termine' });
    const { appeler, messages } = await connecter('refuser');

    expect(await appeler('effacer_personne', { entreprise: 'gite-fictif', prospect: 'julie' })).toMatchObject({ erreur: true, texte: expect.stringContaining('n’a pas confirmé') });

    expect(messages[0]).toBe(
      'Effacer définitivement Julie Fictive (Société fictive), 06 39 98 00 01, de l’entreprise Gîte fictif. Seront effacés : sa fiche (julie.md : nom, société, rôle, e-mail, contexte) ; 1 appel, avec 0 transcription et 0 bilan ; le consentement de son numéro (1 accord enregistré). Seule reste l’empreinte irréversible du numéro 06 39 98 00 01 dans la liste d’opposition : il ne sera plus jamais appelé ni importé. Irréversible : rien de tout cela ne pourra être retrouvé.',
    );
    expect(await db.$count(prospects, eq(prospects.id, 'julie'))).toBe(1);
    expect(await db.$count(appels)).toBe(1);
    expect(await db.$count(oppositions)).toBe(0);
  });

  it('efface après l’accord, ne laisse la personne nulle part dans le journal, et le numéro ne revient plus', async () => {
    const { versionScriptId } = await creerScript(entrepriseId, 'Découverte');
    await db.insert(appels).values({ entrepriseId, prospectId: 'julie', versionScriptId, ligne: 'simulation', numero: '+33639980001', statut: 'termine', conversationId: 'conv_fictive' });
    const { appeler } = await connecter('accepter');
    await appeler('lire_prospect', { entreprise: 'gite-fictif', prospect: 'julie' });

    const r = await appeler('effacer_personne', { entreprise: 'gite-fictif', prospect: 'julie' });

    expect(r.json).toMatchObject({
      efface: { appels: 1, consentements: 1, mentionsJournal: 2 },
      evenementsASupprimerALaMain: [],
      conversationsElevenLabsASupprimer: ['conv_fictive'],
      autresPorteursDuNumero: [],
    });
    const journal = JSON.stringify(await db.select().from(journalMcp));
    for (const trace of ['"julie"', 'Julie Fictive', '06 39 98 00 01']) expect(journal).not.toContain(trace);
    const [derniere] = await db.select().from(journalMcp).where(and(eq(journalMcp.outil, 'effacer_personne'), eq(journalMcp.resultat, 'ok')));
    expect(derniere).toMatchObject({ arguments: { entreprise: 'gite-fictif', prospect: MENTION_NEUTRE }, confirmation: 'acceptee' });
    expect(await appeler('importer_fiches', { entreprise: 'gite-fictif', fiches: [fiche('julie', 'Julie Fictive', '06 39 98 00 01')] })).toMatchObject({
      json: { refus: [{ nomFichier: 'julie.md', erreurs: [NUMERO_EFFACE] }] },
    });
    expect((await appeler('lire_consentements', { numero: '06 39 98 00 01' })).json).toMatchObject({ consentements: [] });
  });

  it('refuse sans rien demander pendant un appel avec la personne', async () => {
    const { versionScriptId } = await creerScript(entrepriseId, 'Découverte');
    await db.insert(appels).values({ entrepriseId, prospectId: 'marc', versionScriptId, ligne: 'bluetooth', numero: '+33639980002' });
    const { appeler, messages } = await connecter('accepter');

    expect(await appeler('effacer_personne', { entreprise: 'gite-fictif', prospect: 'marc' })).toMatchObject({ erreur: true, texte: expect.stringContaining('en cours') });
    expect(messages).toHaveLength(0);
    expect(await db.$count(prospects)).toBe(2);
  });
});

describe('lectures des prospects et des consentements', () => {
  it('filtre par autorisation, rend l’historique des consentements et le texte en vigueur', async () => {
    const { appeler } = await connecter('accepter');
    await appeler('revoquer_numero', { entreprise: 'gite-fictif', prospect: 'marc' });

    expect(((await appeler('lister_prospects', { entreprise: 'gite-fictif', autorisation: 'consentement-revoque' })).json as { prospects: { prospect: string }[] }).prospects.map((p) => p.prospect)).toEqual(['marc']);
    expect((await appeler('lire_prospect', { entreprise: 'gite-fictif', prospect: 'marc' })).json).toMatchObject({
      autorisation: 'consentement-revoque',
      consentements: [{ texteVersion: 2, canal: 'interface', revoqueLe: expect.any(String) }],
      numeroPartagePar: { entreprise: 1, toutes: 1 },
      rappel: null,
    });
    expect((await appeler('lire_texte_consentement')).json).toMatchObject({ version: 2, texte: expect.stringContaining('assistante vocale IA') });
  });
});

describe('numéro changé pendant une campagne téléphone en cours', () => {
  async function campagneTelephone(statut: 'prete' | 'en-cours') {
    const { versionScriptId } = await creerScript(entrepriseId, 'Découverte');
    const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['julie'] });
    await db.update(campagnes).set({ statut }).where(eq(campagnes.id, campagneId));
    return campagneId;
  }
  const telephoneDeJulie = async () => (await db.select({ telephone: prospects.telephone }).from(prospects).where(eq(prospects.id, 'julie')))[0]?.telephone;

  it('modifier_prospect demande l’accord avec l’ancien et le nouveau numéro, et ne change rien sans lui', async () => {
    const campagneId = await campagneTelephone('en-cours');
    const { appeler, messages } = await connecter('refuser');

    const r = await appeler('modifier_prospect', { entreprise: 'gite-fictif', prospect: 'julie', champs: { telephone: '06 39 98 00 07' } });

    expect(r).toMatchObject({ erreur: true, texte: expect.stringContaining('n’a pas confirmé') });
    expect(messages[0]).toContain('numéro 06 39 98 00 01 → 06 39 98 00 07');
    expect(messages[0]).toContain(campagneId);
    expect(await telephoneDeJulie()).toBe('+33639980001');
    expect(await db.$count(consentements, eq(consentements.numero, '+33639980007'))).toBe(0);
    // Ce que l'assistante reçoit de la fiche (ici le rôle) demande aussi l'accord ; l'adresse e-mail, relue au prospect, non.
    expect((await appeler('modifier_prospect', { entreprise: 'gite-fictif', prospect: 'julie', champs: { role: 'Gérante' } })).erreur).toBe(true);
    expect(messages[1]).toContain('role (vide) → « Gérante »');
    expect((await appeler('modifier_prospect', { entreprise: 'gite-fictif', prospect: 'julie', champs: { email: 'julie@exemple.test' } })).erreur).toBe(false);
    expect(messages).toHaveLength(2);
  });

  it('modifier_prospect et importer_fiches changent le numéro après l’accord', async () => {
    await campagneTelephone('en-cours');
    const { appeler, messages } = await connecter('accepter');

    expect((await appeler('modifier_prospect', { entreprise: 'gite-fictif', prospect: 'julie', champs: { telephone: '06 39 98 00 07' } })).erreur).toBe(false);
    expect(await telephoneDeJulie()).toBe('+33639980007');
    const r = await appeler('importer_fiches', { entreprise: 'gite-fictif', fiches: [fiche('julie', 'Julie Fictive', '06 39 98 00 08'), fiche('marc', 'Marc Fictif', '06 39 98 00 09')] });
    expect(r.erreur).toBe(false);
    expect(messages[1]).toContain('numéro 06 39 98 00 07 → 06 39 98 00 08, Julie Fictive');
    expect(messages[1]).not.toContain('Marc');
    expect(await telephoneDeJulie()).toBe('+33639980008');
    const journal = await db.select().from(journalMcp).where(eq(journalMcp.resultat, 'ok'));
    expect(journal.filter((j) => j.outil !== 'lire_prospect').map((j) => [j.outil, j.confirmation])).toEqual([
      ['modifier_prospect', 'acceptee'],
      ['importer_fiches', 'acceptee'],
    ]);
  });

  it('importer_fiches refuse sans accord, et une campagne prête ne demande rien (son lancement redemandera)', async () => {
    const campagneId = await campagneTelephone('en-cours');
    const { appeler, messages } = await connecter('annuler');

    expect((await appeler('importer_fiches', { entreprise: 'gite-fictif', fiches: [fiche('julie', 'Julie Fictive', '06 39 98 00 08')] })).erreur).toBe(true);
    expect(await telephoneDeJulie()).toBe('+33639980001');
    await db.update(campagnes).set({ statut: 'prete' }).where(eq(campagnes.id, campagneId));
    expect((await appeler('importer_fiches', { entreprise: 'gite-fictif', fiches: [fiche('julie', 'Julie Fictive', '06 39 98 00 08')] })).erreur).toBe(false);
    expect(messages).toHaveLength(1);
    expect(await telephoneDeJulie()).toBe('+33639980008');
  });
});

describe('révoquer un numéro sans fiche', () => {
  it('retrouve le numéro d’une fiche disparue par lire_consentements, puis le révoque par numero après l’accord', async () => {
    const { appeler, messages } = await connecter('accepter');
    // Une fiche supprimée avant l'ADR 0013 (supprimer_prospect) : le consentement de son numéro est resté.
    await db.delete(prospects).where(eq(prospects.id, 'julie'));

    const lus = (await appeler('lire_consentements', { numero: '+33 6 39 98 00 01', etat: 'actif' })).json as { consentements: { numero: string; prospects: unknown[] }[] };
    expect(lus.consentements).toEqual([expect.objectContaining({ numero: '06 39 98 00 01', canal: 'interface', texteVersion: 2, revoqueLe: null, prospects: [] })]);

    const r = await appeler('revoquer_numero', { numero: '06 39 98 00 01' });

    expect(messages[0]).toBe('Révoquer définitivement le numéro 06 39 98 00 01 : il ne sera plus jamais appelé (aucune fiche ne le porte plus), et aucun import ne le réautorisera.');
    expect(r.json).toEqual({ numero: '06 39 98 00 01', revoque: true, consentementsClos: 1, prospectsTouches: { toutes: 0 } });
    expect((await appeler('lire_consentements', { etat: 'revoque' })).json).toMatchObject({ consentements: [{ numero: '06 39 98 00 01' }], suivant: null });
    expect(await importerFiches(entrepriseId, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')])).toMatchObject({ numerosAutorises: 0, numerosRevoques: ['06 39 98 00 01'] });
  });

  it('refuse sans rien demander un numéro illisible, sans consentement actif, ou une entrée mêlée', async () => {
    const { appeler, messages } = await connecter('accepter');

    expect(await appeler('revoquer_numero', { numero: 'pas un numéro' })).toMatchObject({ erreur: true, texte: expect.stringContaining('Numéro illisible') });
    expect(await appeler('revoquer_numero', { numero: '06 39 98 00 42' })).toMatchObject({ erreur: true, texte: expect.stringContaining('aucun consentement actif') });
    expect((await appeler('revoquer_numero', { numero: '06 39 98 00 01', entreprise: 'gite-fictif', prospect: 'julie' })).erreur).toBe(true);
    expect((await appeler('revoquer_numero', { entreprise: 'gite-fictif' })).erreur).toBe(true);
    expect(messages).toHaveLength(0);
    expect((await db.select().from(consentements)).every((c) => c.revoqueLe === null)).toBe(true);
  });

  it('refuse la révocation par numéro sans élicitation', async () => {
    const { appeler } = await connecter();

    expect(await appeler('revoquer_numero', { numero: '06 39 98 00 01' })).toMatchObject({ erreur: true, texte: expect.stringContaining('à faire depuis l’interface') });
    expect((await db.select().from(consentements)).every((c) => c.revoqueLe === null)).toBe(true);
  });
});
