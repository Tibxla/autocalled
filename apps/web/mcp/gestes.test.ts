import { spawnSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, campagnes, consentements, rendezVous } from '@/db/schema';
import { enregistrerCampagne } from '@/lib/campagnes';
import { creerScript } from '@/lib/entreprises';
import { importerFiches, revoquerNumero } from '@/lib/prospects';
import { clientDeTest } from '../test/client-mcp';
import { agendaFrais, entrepriseDeTest, fiche } from '../test/fixtures';
import { avecBaseDeTest } from '../test/outils';

avecBaseDeTest();

type Client = Awaited<ReturnType<typeof clientDeTest>>;
let client: Client | undefined;
let entrepriseId: string;
let versionScriptId: string;

beforeEach(async () => {
  const e = await entrepriseDeTest();
  entrepriseId = e.id;
  await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('julie-bis', 'Julie Fictive', '06 39 98 00 01')]);
  ({ versionScriptId } = await creerScript(e.id, 'Découverte'));
  await agendaFrais();
});

afterEach(async () => {
  await client?.fermer();
  client = undefined;
});

async function connecter(options: Parameters<typeof clientDeTest>[0] = {}) {
  client = await clientDeTest(options);
  return client;
}

const actifs = () => db.$count(consentements, eq(consentements.numero, '+33639980001'));
const revoques = async () => (await db.select().from(consentements)).filter((c) => c.revoqueLe !== null).length;

describe('revoquer_numero', () => {
  it('révoque après confirmation, en annonçant les prospects qui partagent le numéro', async () => {
    const { appeler, messages } = await connecter({ elicitation: 'accepter' });

    const r = await appeler('revoquer_numero', { entreprise: 'gite-fictif', prospect: 'julie' });

    expect(messages[0]).toBe(
      'Révoquer définitivement le numéro 06 39 98 00 01 de Julie Fictive (Gîte fictif) : il ne sera plus jamais appelé, pour les 2 prospects qui le partagent, et aucun import ne le réautorisera.',
    );
    expect(r.json).toEqual({ numero: '06 39 98 00 01', revoque: true, prospectsTouches: 2 });
    expect(await revoques()).toBe(1);
  });

  it.each([['refuser'], ['annuler'], [undefined]] as const)('ne révoque rien sans accord (%s)', async (elicitation) => {
    const { appeler } = await connecter({ elicitation });

    expect((await appeler('revoquer_numero', { entreprise: 'gite-fictif', prospect: 'julie' })).erreur).toBe(true);
    expect(await actifs()).toBe(1);
    expect(await revoques()).toBe(0);
  });

  it('ne demande rien pour un numéro déjà révoqué', async () => {
    await revoquerNumero('+33639980001');
    const { appeler, messages } = await connecter({ elicitation: 'accepter' });

    expect(await appeler('revoquer_numero', { entreprise: 'gite-fictif', prospect: 'julie' })).toMatchObject({
      erreur: true,
      texte: 'Ce numéro n’a aucun consentement actif : rien à révoquer.',
    });
    expect(messages).toHaveLength(0);
  });
});

describe('recreer_evenement', () => {
  async function rendezVousEnEchec(email: string | null) {
    const [a] = await db.insert(appels).values({ entrepriseId, prospectId: 'julie', versionScriptId, ligne: 'bluetooth', numero: '+33639980001' }).returning();
    const [rdv] = await db
      .insert(rendezVous)
      .values({ appelId: a!.id, debut: new Date('2026-10-06T08:00:00Z'), fin: new Date('2026-10-06T08:30:00Z'), email, statut: 'echec', erreur: 'panne' })
      .returning();
    return rdv!;
  }

  it('annonce l’invitation à l’adresse du prospect, et ne crée rien sans accord', async () => {
    const rdv = await rendezVousEnEchec('julie@exemple.fr');
    const { appeler, messages } = await connecter({ elicitation: 'refuser' });

    expect((await appeler('recreer_evenement', { rendezVousId: rdv.id })).erreur).toBe(true);
    expect(messages[0]).toBe('Créer dans Google Agenda la visio de Julie Fictive (Gîte fictif) du mardi 6 octobre 2026 à 10:00, et envoyer l’invitation à julie@exemple.fr.');
    expect(await db.select({ statut: rendezVous.statut, erreur: rendezVous.erreur }).from(rendezVous)).toEqual([{ statut: 'echec', erreur: 'panne' }]);
  });

  it('tente la création après l’accord (ici bloquée par la garde des tests sur claude -p)', async () => {
    const rdv = await rendezVousEnEchec(null);
    const { appeler, messages } = await connecter({ elicitation: 'accepter' });

    const r = await appeler('recreer_evenement', { rendezVousId: rdv.id });

    expect(messages[0]).toContain('sans invité : aucun e-mail ne part');
    expect(r).toMatchObject({ erreur: true, texte: 'La création a encore échoué : claude -p est interdit dans les tests' });
  });

  it('refuse un rendez-vous déjà dans l’agenda, sans rien demander', async () => {
    const rdv = await rendezVousEnEchec(null);
    await db.update(rendezVous).set({ statut: 'cree' }).where(eq(rendezVous.id, rdv.id));
    const { appeler, messages } = await connecter({ elicitation: 'accepter' });

    expect((await appeler('recreer_evenement', { rendezVousId: rdv.id })).texte).toBe('L’événement de ce rendez-vous est déjà dans l’agenda.');
    expect(messages).toHaveLength(0);
  });
});

describe('campagne simulée', () => {
  it('démarre la campagne et confie son déroulé à un processus détaché, sans confirmation', async () => {
    const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'simulation', prospects: ['julie'] });
    const taches: string[][] = [];
    const { appeler, messages } = await connecter({ elicitation: 'accepter', detacher: (tache, id) => taches.push([tache, id]) });

    expect((await appeler('lancer_campagne', { campagneId })).json).toMatchObject({ campagneId, statut: 'en-cours' });
    expect(taches).toEqual([['derouler-simulation', campagneId]]);
    expect(messages).toHaveLength(0);
  });

  it('le processus détaché mène la campagne à son terme (ici : numéros révoqués, tous sautés, rien n’est simulé)', { timeout: 30_000 }, async () => {
    await revoquerNumero('+33639980001');
    const campagneId = await enregistrerCampagne(entrepriseId, { versionScriptId, ligne: 'simulation', prospects: ['julie', 'julie-bis'] });
    await db.update(campagnes).set({ statut: 'en-cours' }).where(eq(campagnes.id, campagneId));

    // La commande de detacherTache, avec la base de test ; ELEVENLABS_API_KEY vide l'emporte sur .env.
    const r = spawnSync(
      process.execPath,
      ['--env-file=../../.env', '--conditions=react-server', '--import', './scripts/resolution.ts', 'mcp/tache.ts', 'derouler-simulation', campagneId],
      { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, ELEVENLABS_API_KEY: '' }, encoding: 'utf8', timeout: 25_000 },
    );

    expect(r.status, r.stderr).toBe(0);
    const [c] = await db.select().from(campagnes).where(eq(campagnes.id, campagneId));
    expect(c).toMatchObject({ statut: 'terminee', entrees: [expect.objectContaining({ etat: 'sautee' }), expect.objectContaining({ etat: 'sautee' })] });
    expect(await db.$count(appels)).toBe(0);
  });
});
