import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, campagnes, consentements, imports, journalMcp, prospects, rendezVous } from '@/db/schema';
import { enregistrerCampagne } from '@/lib/campagnes';
import { creerScript } from '@/lib/entreprises';
import { importerFiches } from '@/lib/prospects';
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
    expect(ligne?.arguments).toEqual({ entreprise: 'gite-fictif', prospect: 'julie', champs: ['telephone', 'contexte'], connu: majLe });
    expect((await appeler('lister_prospects', { entreprise: 'gite-fictif', recherche: 'julie' })).json).toMatchObject({
      prospects: [expect.objectContaining({ prospect: 'julie', numero: '06 39 98 00 05', numeroAjouteParMcp: expect.any(String) })],
    });

    expect(await appeler('modifier_prospect', { entreprise: 'gite-fictif', prospect: 'julie', champs: { role: 'Gérante' }, connu: majLe })).toMatchObject({
      erreur: true,
      texte: expect.stringContaining('a changé depuis ta lecture'),
    });
  });
});

describe('supprimer_prospect', () => {
  it('annonce les appels gardés et le numéro qui reste autorisé, supprime après l’accord', async () => {
    const { versionScriptId } = await creerScript(entrepriseId, 'Découverte');
    await db.insert(appels).values({ entrepriseId, prospectId: 'julie', versionScriptId, ligne: 'simulation', numero: '+33639980001', statut: 'termine' });
    const { appeler, messages } = await connecter('accepter');

    const r = await appeler('supprimer_prospect', { entreprise: 'gite-fictif', prospect: 'julie' });

    expect(messages[0]).toBe(
      'Supprimer définitivement la fiche de Julie Fictive (Société fictive) dans l’entreprise Gîte fictif. Son appel garde son bilan, sans fiche. Le numéro 06 39 98 00 01 reste autorisé : revoquer_numero pour ne plus jamais l’appeler.',
    );
    expect(r.json).toEqual({ prospect: 'julie', supprime: true, appelsGardes: 1 });
    expect(await db.$count(prospects, eq(prospects.id, 'julie'))).toBe(0);
    expect(await db.$count(consentements, eq(consentements.numero, '+33639980001'))).toBe(1);
    const lu = (await appeler('lire_appel', { appelId: (await db.select().from(appels))[0]!.id })).json;
    expect(lu).toMatchObject({ prospect: 'julie', nom: null, ficheSupprimee: true });
  });

  it('refuse sans rien demander un prospect en file, et ne supprime rien sans accord', async () => {
    const { versionScriptId } = await creerScript(entrepriseId, 'Découverte');
    await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'simulation', prospects: ['marc'] });
    const { appeler, messages } = await connecter('refuser');

    expect(await appeler('supprimer_prospect', { entreprise: 'gite-fictif', prospect: 'marc' })).toMatchObject({ erreur: true, texte: expect.stringContaining('retirer_de_la_file') });
    expect(messages).toHaveLength(0);
    expect((await appeler('supprimer_prospect', { entreprise: 'gite-fictif', prospect: 'julie' })).erreur).toBe(true);
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
    expect(messages[0]).toContain('de 06 39 98 00 01 à 06 39 98 00 07');
    expect(messages[0]).toContain(campagneId);
    expect(await telephoneDeJulie()).toBe('+33639980001');
    expect(await db.$count(consentements, eq(consentements.numero, '+33639980007'))).toBe(0);
    // Un autre champ ne demande rien.
    expect((await appeler('modifier_prospect', { entreprise: 'gite-fictif', prospect: 'julie', champs: { role: 'Gérante' } })).erreur).toBe(false);
    expect(messages).toHaveLength(1);
  });

  it('modifier_prospect et importer_fiches changent le numéro après l’accord', async () => {
    await campagneTelephone('en-cours');
    const { appeler, messages } = await connecter('accepter');

    expect((await appeler('modifier_prospect', { entreprise: 'gite-fictif', prospect: 'julie', champs: { telephone: '06 39 98 00 07' } })).erreur).toBe(false);
    expect(await telephoneDeJulie()).toBe('+33639980007');
    const r = await appeler('importer_fiches', { entreprise: 'gite-fictif', fiches: [fiche('julie', 'Julie Fictive', '06 39 98 00 08'), fiche('marc', 'Marc Fictif', '06 39 98 00 09')] });
    expect(r.erreur).toBe(false);
    expect(messages[1]).toContain('Julie Fictive, 06 39 98 00 07 → 06 39 98 00 08');
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
  it('retrouve le numéro d’une fiche supprimée par lire_consentements, puis le révoque par numero après l’accord', async () => {
    const { appeler, messages } = await connecter('accepter');
    await appeler('supprimer_prospect', { entreprise: 'gite-fictif', prospect: 'julie' });

    const lus = (await appeler('lire_consentements', { numero: '+33 6 39 98 00 01', etat: 'actif' })).json as { consentements: { numero: string; prospects: unknown[] }[] };
    expect(lus.consentements).toEqual([expect.objectContaining({ numero: '06 39 98 00 01', canal: 'interface', texteVersion: 2, revoqueLe: null, prospects: [] })]);

    const r = await appeler('revoquer_numero', { numero: '06 39 98 00 01' });

    expect(messages[1]).toBe('Révoquer définitivement le numéro 06 39 98 00 01 : il ne sera plus jamais appelé (aucune fiche ne le porte plus), et aucun import ne le réautorisera.');
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

describe('supprimer_prospect et rendez-vous', () => {
  it('refuse sans rien demander un prospect dont le rendez-vous est en échec', async () => {
    const { versionScriptId } = await creerScript(entrepriseId, 'Découverte');
    const [a] = await db.insert(appels).values({ entrepriseId, prospectId: 'julie', versionScriptId, ligne: 'bluetooth', numero: '+33639980001', statut: 'termine' }).returning();
    const debut = new Date(Date.UTC(2026, 9, 1, 9));
    await db.insert(rendezVous).values({ appelId: a!.id, debut, fin: new Date(debut.getTime() + 1_800_000), statut: 'echec' });
    const { appeler, messages } = await connecter('accepter');

    expect(await appeler('supprimer_prospect', { entreprise: 'gite-fictif', prospect: 'julie' })).toMatchObject({ erreur: true, texte: expect.stringContaining('recreer_evenement') });
    expect(messages).toHaveLength(0);
    expect(await db.$count(prospects, eq(prospects.id, 'julie'))).toBe(1);
  });
});
