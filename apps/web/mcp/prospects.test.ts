import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, consentements, imports, journalMcp, prospects } from '@/db/schema';
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

async function connecter(elicitation?: 'accepter' | 'refuser') {
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
    expect((await appeler('lister_prospects', { entreprise: 'gite-fictif', recherche: 'julie' })).json).toEqual([
      expect.objectContaining({ prospect: 'julie', numero: '06 39 98 00 05', numeroAjouteParMcp: expect.any(String) }),
    ]);

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

    expect(((await appeler('lister_prospects', { entreprise: 'gite-fictif', autorisation: 'consentement-revoque' })).json as { prospect: string }[]).map((p) => p.prospect)).toEqual(['marc']);
    expect((await appeler('lire_prospect', { entreprise: 'gite-fictif', prospect: 'marc' })).json).toMatchObject({
      autorisation: 'consentement-revoque',
      consentements: [{ texteVersion: 2, canal: 'interface', revoqueLe: expect.any(String) }],
      numeroPartagePar: { entreprise: 1, toutes: 1 },
      rappel: null,
    });
    expect((await appeler('lire_texte_consentement')).json).toMatchObject({ version: 2, texte: expect.stringContaining('assistante vocale IA') });
  });
});
