import { desc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, campagnes, journalMcp } from '@/db/schema';
import { enregistrerCampagne } from '@/lib/campagnes';
import { creerScript } from '@/lib/entreprises';
import { importerFiches, revoquerNumero } from '@/lib/prospects';
import { clientDeTest } from '../test/client-mcp';
import { fauxPont } from '../test/faux-pont';
import { agendaFrais, entrepriseDeTest, fiche } from '../test/fixtures';
import { avecBaseDeTest } from '../test/outils';

avecBaseDeTest();

type Client = Awaited<ReturnType<typeof clientDeTest>>;
let pont: Awaited<ReturnType<typeof fauxPont>>;
let client: Client | undefined;
let versionScriptId: string;
let entrepriseId: string;

beforeEach(async () => {
  const e = await entrepriseDeTest();
  entrepriseId = e.id;
  await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
  ({ versionScriptId } = await creerScript(e.id, 'Découverte'));
  await agendaFrais();
  pont = await fauxPont();
});

afterEach(async () => {
  await client?.fermer();
  client = undefined;
  await pont.fermer();
});

async function connecter(options: Parameters<typeof clientDeTest>[0] = {}) {
  client = await clientDeTest(options);
  return client;
}

const appelJulie = () => ({ entreprise: 'gite-fictif', prospect: 'julie', versionScriptId, ligne: 'bluetooth' });

describe('lancer_appel sur le téléphone', () => {
  it('refuse sans élicitation : rien ne part vers le pont, le refus est journalisé', async () => {
    const { appeler } = await connecter();

    const r = await appeler('lancer_appel', appelJulie());

    expect(r.erreur).toBe(true);
    expect(r.texte).toContain('à faire depuis l’interface');
    expect(pont.compositions()).toHaveLength(0);
    expect(await db.$count(appels)).toBe(0);
    const [ligne] = await db.select().from(journalMcp);
    expect(ligne).toMatchObject({ outil: 'lancer_appel', resultat: 'refus', confirmation: 'indisponible' });
  });

  it('compose après l’accord de l’opérateur', async () => {
    const { appeler, messages } = await connecter({ elicitation: 'accepter' });

    const r = await appeler('lancer_appel', appelJulie());

    expect(r.erreur).toBe(false);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^Appeler maintenant Julie Fictive \(Société fictive\) au 06 39 98 00 01, pour Gîte fictif, avec le script « Découverte · v1 »/);
    expect(pont.compositions()).toHaveLength(1);
    expect(pont.compositions()[0]?.corps).toMatchObject({ numero: '+33639980001', appelId: (r.json as { appelId: string }).appelId });
    expect(pont.compositions()[0]?.secret).toBe('Bearer secret-de-test');
    const journal = await db.select().from(journalMcp).orderBy(journalMcp.le);
    expect(journal.map((j) => [j.resultat, j.confirmation])).toEqual([
      ['confirmation-demandee', null],
      ['ok', 'acceptee'],
    ]);
  });

  it.each([['refuser'], ['annuler']] as const)('ne compose pas si l’opérateur choisit « %s »', async (reponse) => {
    const { appeler, messages } = await connecter({ elicitation: reponse });

    const r = await appeler('lancer_appel', appelJulie());

    expect(messages).toHaveLength(1);
    expect(r).toMatchObject({ erreur: true, texte: 'L’opérateur n’a pas confirmé : rien n’a été fait.' });
    expect(pont.compositions()).toHaveLength(0);
    expect(await db.$count(appels)).toBe(0);
  });

  it('refuse un numéro révoqué avant de rien demander à l’opérateur ni au pont', async () => {
    await revoquerNumero('+33639980001');
    const { appeler, messages } = await connecter({ elicitation: 'accepter' });

    const r = await appeler('lancer_appel', appelJulie());

    expect(r).toMatchObject({ erreur: true, texte: 'Ce numéro n’est pas autorisé : aucun consentement actif.' });
    expect(messages).toHaveLength(0);
    expect(pont.requetes).toHaveLength(0);
  });

  it('refuse quand le plafond de la ligne est atteint, sans rien demander', async () => {
    await pont.fermer();
    pont = await fauxPont({ plafond: 'Plafond de 15 appels par heure atteint.' });
    const { appeler, messages } = await connecter({ elicitation: 'accepter' });

    expect(await appeler('lancer_appel', appelJulie())).toMatchObject({ erreur: true, texte: 'Plafond de 15 appels par heure atteint.' });
    expect(messages).toHaveLength(0);
    expect(pont.compositions()).toHaveLength(0);
  });

  it('refuse une version de script d’une autre entreprise', async () => {
    const autre = await entrepriseDeTest('Autre fictive', 'autre-fictive');
    const { versionScriptId: etrangere } = await creerScript(autre.id, 'Découverte');
    const { appeler } = await connecter({ elicitation: 'accepter' });

    expect((await appeler('lancer_appel', { ...appelJulie(), versionScriptId: etrangere })).erreur).toBe(true);
    expect(pont.requetes).toHaveLength(0);
  });
});

describe('lancer_campagne', () => {
  it('annonce la campagne, puis compose le premier appel autorisé après l’accord', async () => {
    await revoquerNumero('+33639980001');
    const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['julie', 'marc'] });
    const { appeler, messages } = await connecter({ elicitation: 'accepter' });

    const r = await appeler('lancer_campagne', { campagneId });

    expect(messages[0]).toMatch(/^Lancer la campagne de Gîte fictif sur le téléphone passerelle : 2 prospects à appeler l’un après l’autre, dont 1 au numéro autorisé/);
    expect(r.json).toMatchObject({ statut: 'en-cours', appelEnCours: { prospect: 'marc' } });
    expect(pont.compositions().map((c) => (c.corps as { numero: string }).numero)).toEqual(['+33639980002']);
    const [c] = await db.select().from(campagnes);
    expect(c?.entrees.map((x) => [x.prospectId, x.etat])).toEqual([
      ['julie', 'sautee'],
      ['marc', 'en-appel'],
    ]);
  });

  it('ne lance rien si l’opérateur refuse, et renvoie une campagne navigateur vers l’interface', async () => {
    const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'bluetooth', prospects: ['julie'] });
    const navigateur = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'navigateur', prospects: ['julie'] });
    const { appeler } = await connecter({ elicitation: 'refuser' });

    expect((await appeler('lancer_campagne', { campagneId })).erreur).toBe(true);
    expect((await appeler('lancer_campagne', { campagneId: navigateur })).texte).toContain('lance-la depuis l’interface');
    expect(await db.select({ statut: campagnes.statut }).from(campagnes).where(eq(campagnes.id, campagneId))).toEqual([{ statut: 'prete' }]);
    expect(pont.compositions()).toHaveLength(0);
  });
});

describe('regler_ligne et raccrocher_appel', () => {
  it('resserre sans confirmation, desserre seulement avec', async () => {
    const sans = await connecter();

    expect((await sans.appeler('regler_ligne', { appelsParHeure: 10 })).json).toMatchObject({ appelsParHeure: 10, appelsParJour: 50 });
    const hausse = await sans.appeler('regler_ligne', { appelsParJour: 80 });
    expect(hausse.erreur).toBe(true);
    const pause = await sans.appeler('regler_ligne', { pauseEntreAppelsS: 5 });
    expect(pause.erreur).toBe(false);
    await sans.fermer();

    const avec = await connecter({ elicitation: 'accepter' });
    expect((await avec.appeler('regler_ligne', { appelsParJour: 80 })).json).toMatchObject({ appelsParJour: 80 });
    expect(avec.messages[0]).toBe(
      'Desserrer les garde-fous du téléphone passerelle : appels par jour 50 → 80. Ils évitent les rafales d’appels qui font signaler un numéro comme démarchage.',
    );
    expect(pont.requetes.filter((r) => r.chemin === '/reglages').map((r) => r.corps)).toEqual([
      { appelsParHeure: 10, appelsParJour: 50, pauseEntreAppelsS: 5 },
      { appelsParHeure: 10, appelsParJour: 50, pauseEntreAppelsS: 5 },
      { appelsParHeure: 10, appelsParJour: 80, pauseEntreAppelsS: 5 },
    ]);
  });

  it('raccroche un appel téléphone sans confirmation', async () => {
    const [a] = await db
      .insert(appels)
      .values({ entrepriseId, prospectId: 'julie', versionScriptId, ligne: 'bluetooth', numero: '+33639980001' })
      .returning();
    const { appeler } = await connecter();

    expect((await appeler('raccrocher_appel', { appelId: a!.id })).json).toEqual({ appelId: a!.id, raccroche: true });
    expect(pont.requetes.at(-1)?.chemin).toBe(`/appels/${a!.id}/raccrocher`);
  });
});

describe('journal', () => {
  it('garde une ligne par passage, confirmation comprise', async () => {
    const { appeler } = await connecter({ elicitation: 'refuser' });

    await appeler('lancer_appel', appelJulie());

    const journal = await db.select().from(journalMcp).orderBy(desc(journalMcp.le));
    expect(journal.map((j) => [j.outil, j.resultat, j.confirmation])).toEqual([
      ['lancer_appel', 'refus', 'refusee'],
      ['lancer_appel', 'confirmation-demandee', null],
    ]);
  });
});
