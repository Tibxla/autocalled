import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, assistante, campagnes, consentements, entreprises, journalMcp, prospects } from '@/db/schema';
import { enregistrerCampagne } from '@/lib/campagnes';
import { creerScript } from '@/lib/entreprises';
import { importerFiches } from '@/lib/prospects';
import { clientDeTest } from '../test/client-mcp';
import { dossierAgentDeTest, fauxClientAgent } from '../test/faux-agent';
import { fauxPont } from '../test/faux-pont';
import { agendaFrais, entrepriseDeTest, fiche } from '../test/fixtures';
import { avecBaseDeTest } from '../test/outils';
import { creerGardien, empreinteDe } from './confirmation';
import { ERREUR_INTERNE } from './outil';

avecBaseDeTest();

/** Les 61 outils (ADR 0010, puis lire_consentements et lister_rendez_vous, puis l'archivage et l'effacement de l'ADR 0013), par domaine. */
const OUTILS = {
  assistante: [
    'lire_assistante',
    'modifier_assistante',
    'modifier_prompt_assistante',
    'modifier_reglages_assistante',
    'pousser_assistante',
    'rapatrier_assistante',
    'historique_assistante',
    'restaurer_assistante',
  ],
  entreprises: ['lister_entreprises', 'lire_entreprise', 'creer_entreprise', 'modifier_fiche_entreprise', 'supprimer_entreprise'],
  objections: ['enregistrer_objection', 'archiver_objection', 'ordonner_objections'],
  issues: ['ajouter_issue', 'renommer_issue', 'archiver_issue'],
  scripts: ['creer_script', 'lire_version_script', 'creer_version_script', 'renommer_script', 'archiver_script'],
  prospects: [
    'lister_prospects',
    'lire_prospect',
    'importer_fiches',
    'modifier_prospect',
    'archiver_prospect',
    'reactiver_prospect',
    'effacer_personne',
    'revoquer_numero',
    'lire_texte_consentement',
    'lire_consentements',
  ],
  campagnes: [
    'lister_campagnes',
    'lire_campagne',
    'nouvelle_campagne',
    'supprimer_campagne',
    'lancer_campagne',
    'suspendre_campagne',
    'sauter_dans_la_file',
    'retirer_de_la_file',
    'ajouter_a_la_campagne',
    'terminer_campagne',
  ],
  appels: ['lister_appels', 'lire_appel', 'lancer_appel', 'raccrocher_appel', 'relancer_analyse', 'analyser_versions', 'rappels_du_jour', 'lire_journee', 'apercu_variables_appel'],
  agenda: ['etat_agenda', 'lister_rendez_vous', 'relire_agenda', 'recreer_evenement'],
  ligne: ['etat_ligne', 'regler_ligne', 'reconnecter_telephone'],
  journal: ['lire_journal_mcp'],
};

type Client = Awaited<ReturnType<typeof clientDeTest>>;
let client: Client | undefined;
let pont: Awaited<ReturnType<typeof fauxPont>> | undefined;
afterEach(async () => {
  await client?.fermer();
  await pont?.fermer();
  client = undefined;
  pont = undefined;
});
async function connecter(options: Parameters<typeof clientDeTest>[0] = {}) {
  client = await clientDeTest(options);
  return client;
}

describe('liste des outils', () => {
  it('expose exactement les 61 outils, et annonce les lectures, les destructions et le monde extérieur', async () => {
    const { client: c } = await connecter();
    const { tools } = await c.listTools();
    const attendus = Object.values(OUTILS).flat();

    expect(attendus).toHaveLength(61);
    expect(tools.map((t) => t.name).sort()).toEqual([...attendus].sort());
    const avec = (indice: 'readOnlyHint' | 'destructiveHint' | 'openWorldHint') => tools.filter((t) => t.annotations?.[indice]).map((t) => t.name).sort();
    expect(avec('destructiveHint')).toEqual(['effacer_personne', 'revoquer_numero', 'supprimer_entreprise']);
    expect(avec('readOnlyHint')).toEqual(
      expect.arrayContaining(['lire_assistante', 'historique_assistante', 'lister_appels', 'lire_journee', 'rappels_du_jour', 'lire_journal_mcp', 'lire_texte_consentement', 'lire_consentements', 'lister_rendez_vous', 'etat_ligne']),
    );
    expect(avec('readOnlyHint')).not.toEqual(expect.arrayContaining(['modifier_assistante']));
    expect(avec('openWorldHint')).toEqual(expect.arrayContaining(['lire_assistante', 'pousser_assistante', 'rapatrier_assistante', 'reconnecter_telephone', 'lancer_appel']));
    expect(tools.every((t) => !/\bMina\b/.test(t.description ?? ''))).toBe(true);
  });

  it('ne cite pas le nom de l’assistante dans ses instructions, figées au démarrage', async () => {
    const { client: c } = await connecter();

    expect(c.getInstructions()).not.toMatch(/\bMina\b/);
    expect(c.getInstructions()).toContain('lire_assistante');
  });
});

describe('confirmation forgée', () => {
  let versionScriptId: string;
  let entrepriseId: string;
  beforeEach(async () => {
    const e = await entrepriseDeTest();
    entrepriseId = e.id;
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    ({ versionScriptId } = await creerScript(e.id, 'Découverte'));
    await agendaFrais();
    pont = await fauxPont();
  });

  const accord = { confirmation: { action: 'accept', content: { confirme: true } } };

  it('rejette dès le premier appel un accord avec un état forgé (signé par une autre clé, ou brut), sans rien composer ni révoquer', async () => {
    const { client: c } = await connecter({ elicitation: 'accepter' });
    // Un état bien formé qui porte la bonne empreinte, mais signé par une autre clé que celle du serveur.
    const cle = ['lancer_appel', entrepriseId, 'julie', versionScriptId, '+33639980001', null];
    const forge = await creerGardien().codec.mint({ e: empreinteDe(cle), n: 'nonce-forge' });
    const appelJulie = { entreprise: 'gite-fictif', prospect: 'julie', versionScriptId, ligne: 'bluetooth' };

    for (const requestState of [forge, 'forge', empreinteDe(cle)]) {
      await expect(c.request({ method: 'tools/call', params: { name: 'lancer_appel', arguments: appelJulie, inputResponses: accord, requestState } })).rejects.toThrow(
        'Invalid or expired requestState',
      );
      await expect(
        c.request({ method: 'tools/call', params: { name: 'revoquer_numero', arguments: { entreprise: 'gite-fictif', prospect: 'julie' }, inputResponses: accord, requestState } }),
      ).rejects.toThrow('Invalid or expired requestState');
    }

    expect(pont?.compositions()).toHaveLength(0);
    expect(await db.$count(appels)).toBe(0);
    expect((await db.select().from(consentements)).every((x) => x.revoqueLe === null)).toBe(true);
  });

  it('sans état, une réponse glissée dans le premier appel ne vaut pas accord : la question est posée', async () => {
    const { client: c, messages } = await connecter({ elicitation: 'refuser' });

    const r = await c.request({
      method: 'tools/call',
      params: { name: 'revoquer_numero', arguments: { entreprise: 'gite-fictif', prospect: 'julie' }, inputResponses: accord },
    });

    expect(messages).toHaveLength(1);
    expect(r).toMatchObject({ isError: true });
    expect((await db.select().from(consentements)).every((x) => x.revoqueLe === null)).toBe(true);
  });
});

describe('gestes confirmés sans élicitation', () => {
  it('refuse chaque nouveau geste confirmé quand le client ne sait pas demander, sans effet', async () => {
    const e = await entrepriseDeTest();
    await entrepriseDeTest('Vide fictive', 'vide-fictive');
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    const campagneId = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'bluetooth', prospects: ['julie'] });
    await db.update(campagnes).set({ statut: 'en-cours' }).where(eq(campagnes.id, campagneId));
    const faux = fauxClientAgent();
    const agent = await dossierAgentDeTest(faux);
    try {
      const { appeler } = await connecter({ clientAgent: faux, dossierAgent: agent.dossier });

      for (const [outil, args] of [
        ['modifier_assistante', { nom: 'Léa' }],
        ['effacer_personne', { entreprise: 'gite-fictif', prospect: 'marc' }],
        ['supprimer_entreprise', { entreprise: 'vide-fictive' }],
        ['ajouter_a_la_campagne', { campagneId, prospects: ['marc'] }],
        ['modifier_prospect', { entreprise: 'gite-fictif', prospect: 'julie', champs: { telephone: '06 39 98 00 09' } }],
        ['importer_fiches', { entreprise: 'gite-fictif', fiches: [fiche('julie', 'Julie Fictive', '06 39 98 00 09')] }],
      ] as const) {
        expect(await appeler(outil, args), outil).toMatchObject({ erreur: true, texte: expect.stringContaining('à faire depuis l’interface') });
      }
      const lu = (await appeler('lire_assistante')).json as { synchro: { empreinteLocale: string } };
      await appeler('modifier_reglages_assistante', { reglages: { temperature: 0.4 }, empreinteConnue: lu.synchro.empreinteLocale });
      expect(await appeler('pousser_assistante')).toMatchObject({ erreur: true, texte: expect.stringContaining('à faire depuis l’interface') });

      expect(await db.$count(assistante)).toBe(0);
      expect(await db.$count(prospects)).toBe(2);
      expect(await db.$count(entreprises)).toBe(2);
      expect((await db.select().from(campagnes))[0]?.entrees).toHaveLength(1);
      expect(faux.modifications).toBe(0);
      const journal = await db.select().from(journalMcp).where(eq(journalMcp.resultat, 'refus'));
      expect(journal.filter((j) => j.confirmation === 'indisponible')).toHaveLength(7);
      expect((await db.select({ telephone: prospects.telephone }).from(prospects).where(eq(prospects.id, 'julie')))[0]?.telephone).toBe('+33639980001');
    } finally {
      await agent.effacer();
    }
  });
});

describe('erreur interne', () => {
  it('ne renvoie au modèle ni le détail ni le chemin, et garde le détail au journal', async () => {
    const { appeler } = await connecter({ dossierAgent: '/chemin/inexistant/agent' });

    const r = await appeler('lire_assistante', { distante: false });

    expect(r).toMatchObject({ erreur: true, texte: ERREUR_INTERNE });
    const [ligne] = await db.select().from(journalMcp);
    expect(ligne).toMatchObject({ outil: 'lire_assistante', resultat: 'erreur', message: expect.stringContaining('/chemin/inexistant/agent') });

    // Le journal relu par le modèle ne rend pas non plus ce détail.
    const relu = await appeler('lire_journal_mcp', { resultat: 'erreur' });
    expect(relu.texte).not.toContain('/chemin/inexistant');
    expect(relu.json).toEqual([expect.objectContaining({ outil: 'lire_assistante', resultat: 'erreur', message: expect.stringContaining('Réglages') })]);
    expect((await appeler('lire_journal_mcp', { resultat: 'refus' })).json).toEqual([]);
    expect((await appeler('lire_journal_mcp', { depuis: new Date(Date.now() + 60_000).toISOString() })).json).toEqual([]);
  });
});
