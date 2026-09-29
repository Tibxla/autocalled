import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { campagnes, consentements, entreprises, imports, journalMcp, objections, prospects, versionsScript } from '@/db/schema';
import { creerScript } from '@/lib/entreprises';
import { importerFiches, revoquerNumero } from '@/lib/prospects';
import { clientDeTest } from '../test/client-mcp';
import { entrepriseDeTest, fiche } from '../test/fixtures';
import { avecBaseDeTest } from '../test/outils';

avecBaseDeTest();
let fermer: (() => Promise<void>) | undefined;
afterEach(async () => fermer?.());

async function appeler(nom: string, args: Record<string, unknown> = {}) {
  if (!fermer) {
    const c = await clientDeTest();
    fermer = async () => {
      await c.fermer();
      fermer = undefined;
    };
    appelerAvec = c.appeler;
  }
  return appelerAvec(nom, args);
}
let appelerAvec: Awaited<ReturnType<typeof clientDeTest>>['appeler'];

describe('configuration d’une entreprise', () => {
  it('crée une entreprise puis modifie seulement les champs donnés de sa fiche', async () => {
    expect((await appeler('creer_entreprise', { nom: 'Gîte des Essais' })).json).toEqual({ entreprise: 'gite-des-essais' });

    const r = await appeler('modifier_fiche_entreprise', {
      entreprise: 'gite-des-essais',
      champs: { offre: 'Un site qui réserve en direct.', dureeRendezVousMinutes: 20 },
      plages: [{ jour: 2, debut: '09:00', fin: '12:00' }],
    });

    expect(r.erreur).toBe(false);
    const [e] = await db.select().from(entreprises);
    expect(e).toMatchObject({ nom: 'Gîte des Essais', offre: 'Un site qui réserve en direct.', dureeRendezVousMinutes: 20, horizonJours: 14 });
    expect(e?.plagesRendezVous).toEqual([{ jour: 2, debut: '09:00', fin: '12:00' }]);
  });

  it('refuse une fiche que le formulaire refuserait', async () => {
    await entrepriseDeTest();

    expect(await appeler('modifier_fiche_entreprise', { entreprise: 'gite-fictif', champs: { dureeRendezVousMinutes: 5 } })).toMatchObject({ erreur: true });
    const plages = await appeler('modifier_fiche_entreprise', { entreprise: 'gite-fictif', plages: [{ jour: 1, debut: '12:00', fin: '09:00' }] });
    expect(plages.erreur).toBe(true);
    expect(plages.texte).toContain('Chaque jour coché a besoin d’une heure de début avant l’heure de fin.');
    expect(await db.select({ plages: entreprises.plagesRendezVous }).from(entreprises)).toEqual([{ plages: [] }]);
  });

  it('ajoute une objection, la modifie en gardant les champs absents, puis l’archive', async () => {
    await entrepriseDeTest();
    const creee = await appeler('enregistrer_objection', { entreprise: 'gite-fictif', libelle: 'On a déjà un site', creuser: 'Il vous rapporte des réservations ?' });
    const { objectionId } = creee.json as { objectionId: string };

    await appeler('enregistrer_objection', { entreprise: 'gite-fictif', objectionId, argumenter: 'La commission coûte plus cher.' });
    await appeler('archiver_objection', { entreprise: 'gite-fictif', objectionId, archivee: true });

    const [o] = await db.select().from(objections);
    expect(o).toMatchObject({ libelle: 'On a déjà un site', creuser: 'Il vous rapporte des réservations ?', argumenter: 'La commission coûte plus cher.', archivee: true });
  });

  it('crée un script, puis une version, et refuse une version identique à la précédente', async () => {
    await entrepriseDeTest();
    const { scriptId } = (await appeler('creer_script', { entreprise: 'gite-fictif', nom: 'Découverte' })).json as { scriptId: string };
    const etapes = [{ intention: 'Accroche courte', exemples: ['Bonjour !'] }];

    expect((await appeler('creer_version_script', { entreprise: 'gite-fictif', scriptId, etapes })).json).toMatchObject({ numero: 2 });
    expect(await appeler('creer_version_script', { entreprise: 'gite-fictif', scriptId, etapes })).toMatchObject({
      erreur: true,
      texte: 'Ces étapes sont celles de la version 2 : rien n’a été enregistré.',
    });
    expect(await db.$count(versionsScript)).toBe(2);
  });
});

describe('importer_fiches', () => {
  it('enregistre les numéros nouveaux comme consentants, sans confirmation', async () => {
    const e = await entrepriseDeTest();

    const r = await appeler('importer_fiches', { entreprise: 'gite-fictif', fiches: [fiche('julie', 'Julie Fictive', '06 39 98 00 01')] });

    expect(r.json).toMatchObject({ etat: 'fait', crees: ['julie'], numerosAutorises: 1 });
    expect(await db.$count(consentements, eq(consentements.numero, '+33639980001'))).toBe(1);
    expect(await db.$count(prospects, eq(prospects.entrepriseId, e.id))).toBe(1);
    expect(await db.select({ canal: imports.canal }).from(imports)).toEqual([{ canal: 'mcp' }]);
  });

  it('ne réautorise jamais un numéro révoqué, même en changeant le numéro d’une fiche', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
    await revoquerNumero('+33639980001');

    const r = await appeler('importer_fiches', { entreprise: 'gite-fictif', fiches: [fiche('marc', 'Marc Fictif', '06 39 98 00 01')] });

    expect(r.json).toMatchObject({ misAJour: ['marc'], numerosAutorises: 0, numerosRevoques: ['06 39 98 00 01'] });
    const lignes = await db.select().from(consentements).where(eq(consentements.numero, '+33639980001'));
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.revoqueLe).not.toBeNull();
  });

  it('ne recopie pas le contenu des fiches dans le journal', async () => {
    await entrepriseDeTest();

    await appeler('importer_fiches', { entreprise: 'gite-fictif', fiches: [fiche('julie', 'Julie Fictive', '06 39 98 00 01', 'Contexte confidentiel.')] });

    const [ligne] = await db.select().from(journalMcp);
    expect(JSON.stringify(ligne?.arguments)).not.toContain('confidentiel');
    expect(ligne?.arguments).toEqual({ entreprise: 'gite-fictif', fiches: [{ nomFichier: 'julie.md', octets: expect.any(Number) }] });
  });
});

describe('campagnes', () => {
  it('prépare une campagne sans rien appeler, puis la suspension est sans effet sur une campagne prête', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    const { versionScriptId } = await creerScript(e.id, 'Découverte');

    const r = await appeler('nouvelle_campagne', { entreprise: 'gite-fictif', versionScriptId, ligne: 'bluetooth', prospects: ['julie'] });
    const { campagneId } = r.json as { campagneId: string };
    expect((await appeler('suspendre_campagne', { campagneId })).json).toEqual({ campagneId, statut: 'prete' });

    const [c] = await db.select().from(campagnes);
    expect(c).toMatchObject({ statut: 'prete', ligne: 'bluetooth', entrees: [{ prospectId: 'julie', etat: 'a-appeler' }] });
  });

  it('refuse une version d’une autre entreprise ou un prospect inconnu', async () => {
    const e = await entrepriseDeTest();
    const autre = await entrepriseDeTest('Autre fictive', 'autre-fictive');
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    const { versionScriptId: etrangere } = await creerScript(autre.id, 'Découverte');
    const { versionScriptId } = await creerScript(e.id, 'Découverte');

    expect((await appeler('nouvelle_campagne', { entreprise: 'gite-fictif', versionScriptId: etrangere, ligne: 'simulation', prospects: ['julie'] })).erreur).toBe(true);
    expect(await appeler('nouvelle_campagne', { entreprise: 'gite-fictif', versionScriptId, ligne: 'simulation', prospects: ['julie', 'personne'] })).toMatchObject({
      erreur: true,
      texte: 'Prospects inconnus dans cette entreprise : personne.',
    });
    expect(await db.$count(campagnes)).toBe(0);
  });
});
