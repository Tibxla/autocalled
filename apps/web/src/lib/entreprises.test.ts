import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { entreprises, objections, versionsScript } from '@/db/schema';
import { avecBaseDeTest } from '../../test/outils';
import { entrepriseDeTest } from '../../test/fixtures';
import { basculerArchiveObjection, creerEntreprise, creerScript, creerVersion, enregistrerObjection } from './entreprises';

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
