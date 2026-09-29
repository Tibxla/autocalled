import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { entreprises, objections, versionsScript } from '@/db/schema';
import { avecBaseDeTest } from '../../test/outils';
import { entrepriseDeTest } from '../../test/fixtures';
import { basculerArchiveObjection, creerEntreprise, creerScript, creerVersion, enregistrerFiche, enregistrerObjection } from './entreprises';
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
