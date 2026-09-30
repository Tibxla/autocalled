import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, campagnes, entreprises, issuesPersonnalisees, objections, scripts, versionsScript } from '@/db/schema';
import { avecBaseDeTest } from '../../test/outils';
import { entrepriseDeTest, fiche } from '../../test/fixtures';
import { apercuVariablesAppel } from './apercu';
import {
  basculerArchiveObjection,
  basculerArchiveScript,
  creerEntreprise,
  creerScript,
  creerVersion,
  ajouterIssue,
  deplacerObjection,
  enregistrerFiche,
  enregistrerObjection,
  ordonnerObjections,
  renommerIssue,
  renommerScript,
  supprimerEntrepriseVide,
} from './entreprises';
import { importerFiches } from './prospects';
import { usageDuScript, versionsDeLEntreprise, versionsLancables } from './versions';
import type { Fiche } from './schemas';

avecBaseDeTest();

const crac = { creuser: 'Qu’est-ce qui vous fait dire ça ?', reformuler: '', argumenter: '', controler: '' };

describe('creerEntreprise', () => {
  it('dérive le slug du nom et refuse un doublon', async () => {
    expect(await creerEntreprise('Gîte des Essais')).toMatchObject({ ok: true, slug: 'gite-des-essais' });
    expect(await creerEntreprise('Gîte des essais')).toEqual({ ok: false, raison: 'Une entreprise porte déjà ce nom.' });
    expect(await db.$count(entreprises)).toBe(1);
  });
});

describe('enregistrerObjection', () => {
  it('ajoute en dernière position, puis modifie la même objection', async () => {
    const e = await entrepriseDeTest();
    const premiere = await enregistrerObjection(e.id, null, { libelle: 'On a déjà un site', ...crac });
    const seconde = await enregistrerObjection(e.id, null, { libelle: 'C’est combien ?', ...crac });
    if (!premiere.ok || !seconde.ok) throw new Error('objections non créées');

    await enregistrerObjection(e.id, premiere.id, { libelle: 'On a déjà un site web', ...crac });

    const lignes = await db.select().from(objections).orderBy(objections.ordre);
    expect(lignes.map((o) => [o.libelle, o.ordre])).toEqual([
      ['On a déjà un site web', 1],
      ['C’est combien ?', 2],
    ]);
  });

  it('ne touche pas l’objection d’une autre entreprise', async () => {
    const e = await entrepriseDeTest();
    const autre = await entrepriseDeTest('Autre fictive', 'autre-fictive');
    const objection = await enregistrerObjection(autre.id, null, { libelle: 'Pas le temps', ...crac });
    if (!objection.ok) throw new Error('objection non créée');

    expect((await enregistrerObjection(e.id, objection.id, { libelle: 'Détournée', ...crac })).ok).toBe(false);
    expect(await basculerArchiveObjection(e.id, objection.id, true)).toBe(false);
    const [intacte] = await db.select().from(objections).where(eq(objections.id, objection.id));
    expect(intacte).toMatchObject({ libelle: 'Pas le temps', archivee: false });
  });
});

describe('scripts', () => {
  it('crée la v1 aux étapes initiales, puis les versions suivantes sans rien écraser', async () => {
    const e = await entrepriseDeTest();
    const { scriptId, versionScriptId } = await creerScript(e.id, 'Découverte');

    const v2 = await creerVersion(e.id, scriptId, [{ intention: 'Accroche courte', exemples: ['Bonjour !'] }]);

    expect(v2).toMatchObject({ ok: true, numero: 2 });
    const versions = await db.select().from(versionsScript).orderBy(versionsScript.numero);
    expect(versions.map((v) => v.numero)).toEqual([1, 2]);
    expect(versions[0]?.id).toBe(versionScriptId);
    expect(versions[0]?.etapes).toHaveLength(4);
  });

  it('refuse une version pour le script d’une autre entreprise', async () => {
    const e = await entrepriseDeTest();
    const autre = await entrepriseDeTest('Autre fictive', 'autre-fictive');
    const { scriptId } = await creerScript(autre.id, 'Découverte');

    expect(await creerVersion(e.id, scriptId, [{ intention: 'Accroche', exemples: [] }])).toEqual({ ok: false, raison: 'Ce script n’existe plus.' });
  });
});

describe('garde contre les modifications concurrentes', () => {
  const ficheFictive = (offre: string): Fiche => ({
    nom: 'Gîte fictif',
    offre,
    cible: '',
    arguments: '',
    prixConsigne: '',
    interdits: '',
    complements: '',
    dureeRendezVousMinutes: 30,
    interlocuteur: '',
    delaiMinimumHeures: 24,
    horizonJours: 14,
  });
  const lireEntreprise = async (id: string) => (await db.select().from(entreprises).where(eq(entreprises.id, id)))[0]!;

  it('fiche : sans jeton (le MCP) écrit et tient la colonne à jour, avec l’origine Claude Code', async () => {
    const e = await entrepriseDeTest();
    const avant = e.modifieLe;

    expect(await enregistrerFiche(e.id, ficheFictive('Offre du MCP'), [])).toMatchObject({ ok: true });

    const lue = await lireEntreprise(e.id);
    expect(lue).toMatchObject({ offre: 'Offre du MCP', modifiePar: 'mcp' });
    expect(lue.modifieLe.getTime()).toBeGreaterThanOrEqual(avant.getTime());
  });

  it('fiche : un jeton périmé est refusé avec l’origine et l’heure, sans rien écrire ; le jeton du conflit écrase', async () => {
    const e = await entrepriseDeTest();
    const ouverte = (await lireEntreprise(e.id)).modifieLe.toISOString();
    await enregistrerFiche(e.id, ficheFictive('Offre du MCP'), []);

    const refus = await enregistrerFiche(e.id, ficheFictive('Offre de l’opérateur'), [], { origine: 'interface', connu: ouverte });

    expect(refus.ok).toBe(false);
    if (refus.ok || !('conflit' in refus)) throw new Error('conflit attendu');
    expect(refus.raison).toMatch(/^Fiche modifiée par Claude Code à \d\d:\d\d, depuis que tu l’as ouverte\.$/);
    expect(refus.conflit.origine).toBe('mcp');
    expect((await lireEntreprise(e.id)).offre).toBe('Offre du MCP');

    const ecrase = await enregistrerFiche(e.id, ficheFictive('Offre de l’opérateur'), [], { origine: 'interface', connu: refus.conflit.jeton });
    expect(ecrase).toMatchObject({ ok: true });
    expect(await lireEntreprise(e.id)).toMatchObject({ offre: 'Offre de l’opérateur', modifiePar: 'interface' });
  });

  it('fiche : le jeton à jour passe, deux fois de suite (l’opérateur ne se bloque pas lui-même)', async () => {
    const e = await entrepriseDeTest();
    const premier = await enregistrerFiche(e.id, ficheFictive('Un'), [], { origine: 'interface', connu: e.modifieLe.toISOString() });
    if (!premier.ok) throw new Error('premier enregistrement refusé');
    const relu = (await lireEntreprise(e.id)).modifieLe.toISOString();

    expect(await enregistrerFiche(e.id, ficheFictive('Deux'), [], { origine: 'interface', connu: relu })).toMatchObject({ ok: true });
  });

  it('fiche : une origine inconnue se dit « ailleurs »', async () => {
    const e = await entrepriseDeTest();
    const ouverte = e.modifieLe.toISOString();
    await db.update(entreprises).set({ offre: 'Écrite hors de l’application', modifieLe: new Date(Date.now() + 1000), modifiePar: null });

    const refus = await enregistrerFiche(e.id, ficheFictive('Opérateur'), [], { origine: 'interface', connu: ouverte });

    expect(refus.ok ? '' : refus.raison).toMatch(/^Fiche modifiée ailleurs à /);
  });

  it('objection : refus après une écriture ou un archivage par le MCP, écriture avec le bon jeton', async () => {
    const e = await entrepriseDeTest();
    const creee = await enregistrerObjection(e.id, null, { libelle: 'Trop cher', ...crac }, { origine: 'interface' });
    if (!creee.ok) throw new Error('objection non créée');
    const lire = async () => (await db.select().from(objections).where(eq(objections.id, creee.id)))[0]!;
    const ouverte = (await lire()).modifieLe.toISOString();
    expect((await lire()).modifiePar).toBe('interface');

    await basculerArchiveObjection(e.id, creee.id, true);
    const refus = await enregistrerObjection(e.id, creee.id, { libelle: 'Trop cher pour nous', ...crac }, { origine: 'interface', connu: ouverte });
    expect(refus).toMatchObject({ ok: false, raison: expect.stringMatching(/^Objection modifiée par Claude Code à /) });
    expect((await lire()).libelle).toBe('Trop cher');

    const actuel = (await lire()).modifieLe.toISOString();
    expect(await enregistrerObjection(e.id, creee.id, { libelle: 'Trop cher pour nous', ...crac }, { origine: 'interface', connu: actuel })).toMatchObject({
      ok: true,
    });
    expect(await lire()).toMatchObject({ libelle: 'Trop cher pour nous', modifiePar: 'interface' });
  });

  it('version : refusée si une autre version est arrivée depuis l’ouverture de l’éditeur, créée par-dessus avec le jeton', async () => {
    const e = await entrepriseDeTest();
    const { scriptId } = await creerScript(e.id, 'Découverte');
    await creerVersion(e.id, scriptId, [{ intention: 'Écrite par le MCP', exemples: [] }]);

    const refus = await creerVersion(e.id, scriptId, [{ intention: 'Écrite par l’opérateur', exemples: [] }], { origine: 'interface', connu: '1' });

    expect(refus).toMatchObject({
      ok: false,
      raison: expect.stringMatching(/^Une v2 a été créée par Claude Code à \d\d:\d\d, depuis que tu as ouvert l’éditeur\.$/),
      conflit: { origine: 'mcp', jeton: '2' },
    });
    expect(await db.$count(versionsScript)).toBe(2);

    const v3 = await creerVersion(e.id, scriptId, [{ intention: 'Écrite par l’opérateur', exemples: [] }], { origine: 'interface', connu: '2' });
    expect(v3).toMatchObject({ ok: true, numero: 3 });
    const [derniere] = await db.select().from(versionsScript).where(eq(versionsScript.numero, 3));
    expect(derniere?.creePar).toBe('interface');
  });
});

describe('deplacerObjection', () => {
  async function trois() {
    const e = await entrepriseDeTest();
    const ids: string[] = [];
    for (const libelle of ['Trop cher', 'Pas le temps', 'Déjà équipé']) {
      const r = await enregistrerObjection(e.id, null, { libelle, ...crac });
      if (!r.ok) throw new Error('objection non créée');
      ids.push(r.id);
    }
    return { e, ids: ids as [string, string, string] };
  }
  const ordre = async () => (await db.select().from(objections).orderBy(objections.ordre)).map((o) => o.libelle);

  it('monte et descend d’un rang, ce qui change l’ordre reçu par Mina, sans toucher modifieLe', async () => {
    const { e, ids } = await trois();
    const avant = (await db.select().from(objections).where(eq(objections.id, ids[2])))[0]!.modifieLe;

    expect(await deplacerObjection(e.id, ids[2], -1)).toEqual({ ok: true, position: 2 });
    expect(await ordre()).toEqual(['Trop cher', 'Déjà équipé', 'Pas le temps']);
    expect(await deplacerObjection(e.id, ids[0], 1)).toEqual({ ok: true, position: 2 });
    expect(await ordre()).toEqual(['Déjà équipé', 'Trop cher', 'Pas le temps']);

    const apercu = await apercuVariablesAppel(e.id);
    expect(apercu.ok && apercu.variables.objections.split('\n').map((l) => l.split(' : ')[0])).toEqual(['Déjà équipé', 'Trop cher', 'Pas le temps']);
    expect((await db.select().from(objections).where(eq(objections.id, ids[2])))[0]!.modifieLe).toEqual(avant);
  });

  it('reste en place aux bords, saute les archivées et renumérote les ordres en double', async () => {
    const { e, ids } = await trois();
    await db.update(objections).set({ ordre: 0 });
    await basculerArchiveObjection(e.id, ids[1], true);

    expect(await deplacerObjection(e.id, ids[0], -1)).toMatchObject({ ok: true, position: 1 });
    expect(await deplacerObjection(e.id, ids[2], -1)).toEqual({ ok: true, position: 1 });

    const lignes = await db.select().from(objections).orderBy(objections.ordre);
    expect(lignes.map((o) => o.ordre)).toEqual([1, 2, 3]);
    expect(lignes.filter((o) => !o.archivee).map((o) => o.libelle)).toEqual(['Déjà équipé', 'Trop cher']);
    expect(await deplacerObjection(e.id, ids[1], 1)).toMatchObject({ ok: false, raison: expect.stringMatching(/archivée/) });
  });

  it('refuse l’objection d’une autre entreprise', async () => {
    const { ids } = await trois();
    const autre = await entrepriseDeTest('Autre fictive', 'autre-fictive');

    expect(await deplacerObjection(autre.id, ids[0], 1)).toEqual({ ok: false, raison: 'Cette objection n’existe pas dans cette entreprise.' });
  });
});

describe('renommer et archiver un script', () => {
  it('renomme un script de l’entreprise, pas celui d’une autre', async () => {
    const e = await entrepriseDeTest();
    const autre = await entrepriseDeTest('Autre fictive', 'autre-fictive');
    const { scriptId } = await creerScript(e.id, 'Découverte');

    expect(await renommerScript(autre.id, scriptId, 'Détourné')).toBe(false);
    expect(await renommerScript(e.id, scriptId, 'Premier contact')).toBe(true);
    expect((await versionsDeLEntreprise(e.id))[0]?.libelle).toBe('Premier contact · v1');
  });

  it('un script archivé sort des choix de lancement et de l’aperçu, garde ses versions, revient à la réactivation', async () => {
    const e = await entrepriseDeTest();
    const premier = await creerScript(e.id, 'Découverte');
    const second = await creerScript(e.id, 'Relance');

    expect(await basculerArchiveScript(e.id, premier.scriptId, true)).toBe(true);

    expect((await versionsLancables(e.id)).map((v) => v.libelle)).toEqual(['Relance · v1']);
    expect((await versionsDeLEntreprise(e.id)).map((v) => [v.libelle, v.scriptArchive])).toEqual([
      ['Découverte · v1', true],
      ['Relance · v1', false],
    ]);
    const apercu = await apercuVariablesAppel(e.id);
    expect(apercu).toMatchObject({ ok: true, version: { id: second.versionScriptId, script: 'Relance' } });
    // Une version d'un script archivé reste lisible par son identifiant (appels passés, page du script).
    expect(await apercuVariablesAppel(e.id, { versionScriptId: premier.versionScriptId })).toMatchObject({ ok: true });

    await basculerArchiveScript(e.id, premier.scriptId, false);
    expect(await versionsLancables(e.id)).toHaveLength(2);
    expect((await db.select().from(scripts)).every((s) => !s.archive)).toBe(true);
  });

  it('dit ce qui utilise encore un script : campagnes en cours ou suspendues, appels en ligne', async () => {
    const e = await entrepriseDeTest();
    const { scriptId, versionScriptId } = await creerScript(e.id, 'Découverte');
    expect(await usageDuScript(scriptId)).toEqual({ campagnes: 0, appelsEnCours: 0 });

    await db.insert(campagnes).values([
      { entrepriseId: e.id, versionScriptId, ligne: 'simulation', statut: 'en-pause', entrees: [] },
      { entrepriseId: e.id, versionScriptId, ligne: 'simulation', statut: 'terminee', entrees: [] },
    ]);
    await db.insert(appels).values([
      { entrepriseId: e.id, prospectId: 'fictif', versionScriptId, ligne: 'bluetooth', numero: '+33639980001' },
      { entrepriseId: e.id, prospectId: 'fictif', versionScriptId, ligne: 'bluetooth', numero: '+33639980001', statut: 'termine' },
    ]);

    expect(await usageDuScript(scriptId)).toEqual({ campagnes: 1, appelsEnCours: 1 });
  });
});

describe('creerScript avec ses étapes', () => {
  it('pose les étapes données en version 1, sans les intentions de départ', async () => {
    const e = await entrepriseDeTest();
    const etapes = [{ intention: 'Accroche : se présenter.', exemples: ['Bonjour !'] }];

    const { versionScriptId } = await creerScript(e.id, 'Découverte', etapes);

    const [v] = await db.select().from(versionsScript).where(eq(versionsScript.id, versionScriptId));
    expect(v).toMatchObject({ numero: 1, etapes });
  });
});

describe('ordonnerObjections', () => {
  it('pose l’ordre des actives, range les archivées après, sans toucher modifieLe', async () => {
    const e = await entrepriseDeTest();
    const ids: string[] = [];
    for (const libelle of ['Pas le temps', 'Trop cher', 'Déjà équipé']) {
      const r = await enregistrerObjection(e.id, null, { libelle, ...crac }, { origine: 'mcp' });
      if (r.ok) ids.push(r.id);
    }
    const [a, b, c] = ids as [string, string, string];
    await basculerArchiveObjection(e.id, a, true, 'mcp');
    const avant = await db.select({ id: objections.id, modifieLe: objections.modifieLe }).from(objections);

    expect(await ordonnerObjections(e.id, [c, b])).toEqual({ ok: true });

    const apres = await db.select().from(objections).where(eq(objections.entrepriseId, e.id));
    expect(apres.sort((x, y) => x.ordre - y.ordre).map((o) => o.id)).toEqual([c, b, a]);
    expect(apres.map((o) => [o.id, o.modifieLe.getTime()]).sort()).toEqual(avant.map((o) => [o.id, o.modifieLe.getTime()]).sort());
  });

  it('refuse un ordre incomplet, doublé ou qui cite une archivée', async () => {
    const e = await entrepriseDeTest();
    const r1 = await enregistrerObjection(e.id, null, { libelle: 'Pas le temps', ...crac }, { origine: 'mcp' });
    const r2 = await enregistrerObjection(e.id, null, { libelle: 'Trop cher', ...crac }, { origine: 'mcp' });
    if (!r1.ok || !r2.ok) throw new Error('objections non créées');
    await basculerArchiveObjection(e.id, r2.id, true, 'mcp');

    expect(await ordonnerObjections(e.id, [])).toMatchObject({ ok: false, raison: expect.stringContaining('exactement les 1 objections actives') });
    expect(await ordonnerObjections(e.id, [r1.id, r1.id])).toMatchObject({ ok: false });
    expect(await ordonnerObjections(e.id, [r1.id, r2.id])).toMatchObject({ ok: false, raison: expect.stringContaining('archivées') });
  });
});

describe('renommerIssue', () => {
  it('corrige le libellé sans toucher au rattachement, dans l’entreprise seulement', async () => {
    const e = await entrepriseDeTest();
    const autre = await entrepriseDeTest('Autre fictive', 'autre-fictive');
    const id = await ajouterIssue(e.id, { libelle: 'Brochure', issueSysteme: 'envoi-informations' });

    expect(await renommerIssue(autre.id, id, 'Pirate')).toBe(false);
    expect(await renommerIssue(e.id, id, 'Brochure envoyée')).toBe(true);
    expect(await db.select({ libelle: issuesPersonnalisees.libelle, issueSysteme: issuesPersonnalisees.issueSysteme }).from(issuesPersonnalisees)).toEqual([
      { libelle: 'Brochure envoyée', issueSysteme: 'envoi-informations' },
    ]);
  });
});

describe('supprimerEntrepriseVide', () => {
  it('supprime une entreprise sans historique, avec sa configuration', async () => {
    const e = await entrepriseDeTest();
    await enregistrerObjection(e.id, null, { libelle: 'Pas le temps', ...crac }, { origine: 'mcp' });
    await ajouterIssue(e.id, { libelle: 'Brochure', issueSysteme: 'envoi-informations' });
    const { scriptId } = await creerScript(e.id, 'Découverte');
    await creerVersion(e.id, scriptId, [{ intention: 'Autre accroche', exemples: [] }], { origine: 'mcp' });

    expect(await supprimerEntrepriseVide(e.id)).toEqual({ ok: true, supprime: { objections: 1, issues: 1, scripts: 1, versions: 2 } });
    expect(await db.$count(entreprises)).toBe(0);
    expect(await db.$count(versionsScript)).toBe(0);
  });

  it('refuse une entreprise qui a des prospects ou des imports', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);

    expect(await supprimerEntrepriseVide(e.id)).toMatchObject({ ok: false, raison: expect.stringContaining('1 prospect, 1 import') });
    expect(await db.$count(entreprises)).toBe(1);
  });
});
