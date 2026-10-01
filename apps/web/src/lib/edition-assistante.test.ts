import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, assistante, versionsAssistante } from '@/db/schema';
import { dossierAgentDeTest, type FauxClient, fauxClientAgent, PROMPT_DE_TEST } from '../../test/faux-agent';
import { entrepriseDeTest, fiche } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import { lireAssistante } from './assistante';
import {
  appelEnCours,
  detailVersion,
  enregistrerIdentite,
  enregistrerReglagesAssistante,
  lireEditionAssistante,
  pourLaPage,
  pousser,
  preparerIdentite,
  preparerPoussee,
  rapatrier,
  restaurer,
} from './edition-assistante';
import { creerScript } from './entreprises';
import { importerFiches } from './prospects';

/** L'édition de l'assistante par la page : mêmes fonctions que le MCP, ElevenLabs simulé, `agent/` jetable. */

avecBaseDeTest();

let faux: FauxClient;
let agent: Awaited<ReturnType<typeof dossierAgentDeTest>>;
let o: { client: FauxClient; dossier: string };

beforeEach(async () => {
  faux = fauxClientAgent();
  agent = await dossierAgentDeTest(faux);
  o = { client: faux, dossier: agent.dossier };
});
afterEach(() => agent.effacer());

const config = async () => JSON.parse(await readFile(join(agent.dossier, 'mina.config.json'), 'utf8'));

describe('nom et premier message', () => {
  it('rédige la question du MCP (ancien et nouveau nom), puis écrit d’origine interface', async () => {
    const q = await preparerIdentite({ nom: 'Léa' }, null);

    expect(q).toEqual({
      ok: true,
      lignes: [
        'Changer le nom de l’assistante : « Mina » → « Léa ».',
        'Les prospects l’entendront dès le prochain appel, sans autre relecture.',
      ],
    });
    expect(await db.$count(assistante)).toBe(0);

    const r = await enregistrerIdentite({ nom: 'Léa', premierMessage: 'Bonjour, {{prospect_nom}} ?' }, null, o);

    expect(r).toMatchObject({ ok: true, rappel: expect.stringContaining('libellé du tableau de bord ElevenLabs reste « Assistante de test »') });
    expect(await db.select({ nom: assistante.nom, premierMessage: assistante.premierMessage, par: assistante.modifiePar }).from(assistante)).toEqual([
      { nom: 'Léa', premierMessage: 'Bonjour, {{prospect_nom}} ?', par: 'interface' },
    ]);
  });

  it('refuse comme le MCP : nom invalide, variable inconnue, rien qui change, lecture périmée', async () => {
    expect(await preparerIdentite({ nom: 'le service des impôts' }, null)).toMatchObject({ ok: false, raison: expect.stringContaining('Nom refusé') });
    expect(await preparerIdentite({ premierMessage: 'Bonjour {{inconnue}}' }, null)).toMatchObject({ ok: false, raison: expect.stringContaining('Variables inconnues') });
    expect(await preparerIdentite({ nom: 'Mina' }, null)).toMatchObject({ ok: false, raison: expect.stringContaining('Rien ne change') });

    await enregistrerIdentite({ nom: 'Léa' }, null, o);
    const lu = (await lireAssistante()).modifieLe?.toISOString() ?? null;
    await enregistrerIdentite({ nom: 'Zoé' }, lu, o);

    expect(await enregistrerIdentite({ nom: 'Inès' }, lu, o)).toEqual({
      ok: false,
      raison: 'La configuration de l’assistante a changé depuis ta lecture : recharge la page.',
    });
    expect((await lireAssistante()).nom).toBe('Zoé');
  });
});

describe('réglages de la liste fermée', () => {
  it('écrit agent/ avec la garde d’empreinte, sans rien pousser, et rend la nouvelle empreinte', async () => {
    const { empreinteLocale, reglages } = await lireEditionAssistante(o);
    expect(reglages).toMatchObject({ temperature: 0.7, voix: { voiceId: 'voixfictive0001' } });

    const r = await enregistrerReglagesAssistante({ temperature: 0.5, voix: { vitesse: 1.1 }, tour: { motsIgnores: ['oui', 'hmm'] } }, empreinteLocale, o);

    expect(r).toMatchObject({ ok: true, champs: ['temperature', 'voix.vitesse', 'tour.motsIgnores'], rappel: expect.stringContaining('avant la poussée') });
    expect((await config()).conversation_config.tts.speed).toBe(1.1);
    expect(faux.modifications).toBe(0);
    const apres = await lireEditionAssistante(o);
    expect(r.ok && r.empreinteLocale).toBe(apres.empreinteLocale);
    expect(apres.modificationsLocalesNonPoussees).toBe(true);

    expect(await enregistrerReglagesAssistante({ temperature: 0.4 }, empreinteLocale, o)).toEqual({
      ok: false,
      raison: 'agent/ a changé depuis ta lecture (autre session ou modification à la main) : recharge la page.',
    });
    expect(await enregistrerReglagesAssistante({ dureeMaxS: 600 }, apres.empreinteLocale, o)).toMatchObject({ ok: false, raison: expect.stringContaining('Entre 60 et 330 s') });
  });
});

describe('poussée', () => {
  async function modifierTemperature() {
    const { empreinteLocale } = await lireEditionAssistante(o);
    await enregistrerReglagesAssistante({ temperature: 0.5 }, empreinteLocale, o);
  }

  it('montre la différence rédigée par le serveur, pousse sur elle et consigne la version d’origine interface', async () => {
    await modifierTemperature();

    const prep = await preparerPoussee(o);

    expect(prep).toMatchObject({
      ok: true,
      question: 'Pousser vers ElevenLabs la configuration de l’assistante. Elle servira dès le prochain appel.',
      difference: 'Réglages :\n  température : 0,7 → 0,5',
    });
    expect(faux.modifications).toBe(0);
    if (!prep.ok) throw new Error(prep.raison);

    expect(await pousser(prep.attendu, o)).toMatchObject({ ok: true, versionAvant: 'agtvrsn_test1', versionApres: 'agtvrsn_test2' });
    expect(faux.modifications).toBe(1);
    expect(await db.select({ v: versionsAssistante.versionId, origine: versionsAssistante.origine }).from(versionsAssistante).orderBy(versionsAssistante.versionId)).toEqual([
      { v: 'agtvrsn_test1', origine: 'cli' },
      { v: 'agtvrsn_test2', origine: 'interface' },
    ]);
    expect(await preparerPoussee(o)).toEqual({ ok: false, raison: 'Rien à pousser : agent/ est identique à la configuration ElevenLabs.' });
  });

  it('ne pousse rien si agent/ a bougé depuis la différence montrée', async () => {
    await modifierTemperature();
    const prep = await preparerPoussee(o);
    if (!prep.ok) throw new Error(prep.raison);
    const { empreinteLocale } = await lireEditionAssistante(o);
    await enregistrerReglagesAssistante({ temperature: 0.3 }, empreinteLocale, o);

    expect(await pousser(prep.attendu, o)).toMatchObject({ ok: false, raison: expect.stringContaining('a changé depuis la question') });
    expect(faux.modifications).toBe(0);
  });

  it('refuse pendant un appel en cours, et un champ hors de la liste ou une configuration modifiée ailleurs comme le MCP', async () => {
    await modifierTemperature();
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    const script = await creerScript(e.id, 'Découverte');
    const [appel] = await db
      .insert(appels)
      .values({ entrepriseId: e.id, prospectId: 'julie', versionScriptId: script.versionScriptId, ligne: 'bluetooth', numero: '+33639980001', statut: 'en-cours' })
      .returning();
    const prep = await preparerPoussee({ ...o, client: fauxClientAgent() });

    expect(await appelEnCours()).toBe(true);
    expect(prep).toEqual({ ok: false, raison: 'Un appel est en cours : rien ne part vers ElevenLabs pendant qu’il dure. Pousse quand il sera fini.' });
    expect(await pousser({ empreinteLocale: 'x', versionIdDistante: 'agtvrsn_test1' }, o)).toMatchObject({ ok: false, raison: expect.stringContaining('Un appel est en cours') });
    // Un « en cours » de plus d'un quart d'heure est une ligne périmée : le pont raccroche à 360 s.
    await db.update(appels).set({ debutLe: new Date(Date.now() - 20 * 60_000) }).where(eq(appels.id, appel?.id ?? ''));
    expect(await appelEnCours()).toBe(false);

    const chemin = join(agent.dossier, 'mina.config.json');
    const c = await config();
    c.conversation_config.agent.first_message = 'Bonjour !';
    await writeFile(chemin, JSON.stringify(c, null, 2));
    expect(await preparerPoussee(o)).toMatchObject({ ok: false, raison: expect.stringContaining('pnpm agent push') });
    faux.etat = { ...faux.etat, version_id: 'agtvrsn_tableau' };
    expect(await preparerPoussee(o)).toMatchObject({ ok: false, raison: expect.stringContaining('rapatrie-la d’abord') });
    expect(faux.modifications).toBe(0);
  });

  it('dit l’échec d’ElevenLabs en une phrase, sans lever', async () => {
    await modifierTemperature();
    const prep = await preparerPoussee(o);
    if (!prep.ok) throw new Error(prep.raison);
    faux.modifier = async () => {
      throw new Error('ElevenLabs 500');
    };

    expect(await pousser(prep.attendu, o)).toEqual({ ok: false, raison: 'Échec : ElevenLabs 500' });
    faux.panne = true;
    expect(await preparerPoussee(o)).toMatchObject({ ok: false, raison: expect.stringContaining('réseau coupé') });
  });
});

describe('rapatriement, historique et restauration', () => {
  it('rapatrie, liste les versions, montre la différence d’une version et la restaure, à pousser ensuite', async () => {
    faux.etat = { ...faux.etat, version_id: 'agtvrsn_tableau', name: 'Libellé changé' };

    expect(await rapatrier(o)).toMatchObject({ ok: true, versionId: 'agtvrsn_tableau' });
    expect((await lireEditionAssistante(o)).reglages).toMatchObject({ libelleTableauDeBord: 'Libellé changé' });
    await db.insert(versionsAssistante).values({ versionId: 'agtvrsn_test1', empreinte: 'x', prompt: PROMPT_DE_TEST, configuration: { name: 'Assistante de test' }, origine: 'mcp' });

    const { historique } = await lireEditionAssistante(o);
    expect(historique.map((h) => [h.versionId, h.origine, h.estLeVerrou]).sort()).toEqual([
      ['agtvrsn_tableau', 'distante', true],
      ['agtvrsn_test1', 'mcp', false],
    ]);
    expect(await detailVersion('agtvrsn_test1', o)).toMatchObject({ ok: true, identique: false, difference: expect.stringContaining('Libellé changé') });
    expect(await detailVersion('agtvrsn_tableau', o)).toMatchObject({ ok: true, identique: true });

    expect(await restaurer('agtvrsn_test1', o)).toMatchObject({ ok: true, rappel: expect.stringContaining('pousse-la pour que les appels l’utilisent') });
    expect((await lireEditionAssistante(o)).reglages).toMatchObject({ libelleTableauDeBord: 'Assistante de test' });
    expect(faux.modifications).toBe(0);

    expect(await rapatrier(o)).toMatchObject({ ok: false, raison: expect.stringContaining('La page ne tranche pas') });
    expect(await restaurer('agtvrsn_inconnue', o)).toEqual({ ok: false, raison: 'Cette version n’est pas consignée : l’historique liste celles qui le sont.' });
  });
});

describe('pourLaPage', () => {
  it('remplace les noms d’outils du MCP par les gestes de la page', () => {
    expect(pourLaPage('agent/ modifié : à relire (git diff agent/) et à commiter. Rien ne change pour les appels avant pousser_assistante.')).toBe(
      'agent/ modifié : à relire (git diff agent/) et à commiter. Rien ne change pour les appels avant la poussée.',
    );
  });
});
