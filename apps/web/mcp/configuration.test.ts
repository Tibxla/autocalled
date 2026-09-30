import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { campagnes, consentements, entreprises, imports, issuesPersonnalisees, journalMcp, objections, prospects, scripts, versionsScript } from '@/db/schema';
import { basculerArchiveScript, creerScript } from '@/lib/entreprises';
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

  it('lit et écrit les informations complémentaires, bornées à 1 500 caractères, sous la garde de `connu`', async () => {
    await entrepriseDeTest();
    const lue = (await appeler('lire_entreprise', { entreprise: 'gite-fictif' })).json as { modifieLe: string; fiche: { complements: string } };
    expect(lue.fiche.complements).toBe('');

    const ecrite = await appeler('modifier_fiche_entreprise', { entreprise: 'gite-fictif', champs: { complements: 'Parking : gratuit devant le gîte.' }, connu: lue.modifieLe });
    expect(ecrite).toMatchObject({ erreur: false, json: { fiche: { complements: 'Parking : gratuit devant le gîte.' } } });
    expect(((await appeler('lire_entreprise', { entreprise: 'gite-fictif' })).json as { fiche: { complements: string } }).fiche.complements).toBe(
      'Parking : gratuit devant le gîte.',
    );

    const trop = await appeler('modifier_fiche_entreprise', { entreprise: 'gite-fictif', champs: { complements: 'x'.repeat(1501) } });
    expect(trop).toMatchObject({ erreur: true, texte: expect.stringContaining('1500 caractères au plus.') });
    // `connu` lu avant l'écriture précédente : périmé, refusé.
    expect(await appeler('modifier_fiche_entreprise', { entreprise: 'gite-fictif', champs: { complements: 'Autre chose.' }, connu: lue.modifieLe })).toMatchObject({
      erreur: true,
      texte: expect.stringContaining('par Claude Code'),
    });
    expect((await db.select({ complements: entreprises.complements }).from(entreprises))[0]?.complements).toBe('Parking : gratuit devant le gîte.');
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
    const premieres = [{ intention: 'Accroche : se présenter', exemples: [] }];
    expect((await appeler('creer_script', { entreprise: 'gite-fictif', nom: 'Découverte' })).erreur).toBe(true);
    const { scriptId } = (await appeler('creer_script', { entreprise: 'gite-fictif', nom: 'Découverte', etapes: premieres })).json as { scriptId: string };
    expect(await db.select({ etapes: versionsScript.etapes, creePar: versionsScript.creePar }).from(versionsScript)).toEqual([{ etapes: premieres, creePar: 'mcp' }]);
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

describe('gestes de configuration ajoutés', () => {
  it('refuse d’écraser une fiche relue avant une autre écriture, écrit avec la lecture à jour', async () => {
    await entrepriseDeTest();
    const { modifieLe } = (await appeler('lire_entreprise', { entreprise: 'gite-fictif' })).json as { modifieLe: string };
    await appeler('modifier_fiche_entreprise', { entreprise: 'gite-fictif', champs: { offre: 'Première offre.' } });

    expect(await appeler('modifier_fiche_entreprise', { entreprise: 'gite-fictif', champs: { offre: 'Offre périmée.' }, connu: modifieLe })).toMatchObject({
      erreur: true,
      texte: expect.stringContaining('par Claude Code'),
    });
    expect((await db.select({ offre: entreprises.offre, modifiePar: entreprises.modifiePar }).from(entreprises))[0]).toEqual({ offre: 'Première offre.', modifiePar: 'mcp' });
  });

  it('ordonne les objections et les rend dans cet ordre, l’origine mcp posée', async () => {
    await entrepriseDeTest();
    const ids: string[] = [];
    for (const libelle of ['Pas le temps', 'Trop cher']) ids.push(((await appeler('enregistrer_objection', { entreprise: 'gite-fictif', libelle })).json as { objectionId: string }).objectionId);

    expect((await appeler('ordonner_objections', { entreprise: 'gite-fictif', ordre: [ids[1], ids[0]] })).erreur).toBe(false);
    const lue = (await appeler('lire_entreprise', { entreprise: 'gite-fictif' })).json as { objections: { libelle: string; modifiePar: string }[] };
    expect(lue.objections.map((o) => [o.libelle, o.modifiePar])).toEqual([
      ['Trop cher', 'mcp'],
      ['Pas le temps', 'mcp'],
    ]);
    expect((await appeler('ordonner_objections', { entreprise: 'gite-fictif', ordre: [ids[0]] })).erreur).toBe(true);
  });

  it('renomme une issue sans toucher son rattachement', async () => {
    await entrepriseDeTest();
    const { issueId } = (await appeler('ajouter_issue', { entreprise: 'gite-fictif', libelle: 'Brochure', issueSysteme: 'envoi-informations' })).json as { issueId: string };

    expect((await appeler('renommer_issue', { entreprise: 'gite-fictif', issueId, libelle: 'Brochure envoyée' })).json).toEqual({ issueId, libelle: 'Brochure envoyée' });
    expect(await db.select({ libelle: issuesPersonnalisees.libelle, issueSysteme: issuesPersonnalisees.issueSysteme }).from(issuesPersonnalisees)).toEqual([
      { libelle: 'Brochure envoyée', issueSysteme: 'envoi-informations' },
    ]);
  });

  it('renomme et archive un script, dit son usage, et refuse ensuite de lancer une campagne sur lui', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    const { scriptId, versionScriptId } = await creerScript(e.id, 'Découverte');

    expect((await appeler('renommer_script', { entreprise: 'gite-fictif', scriptId, nom: 'Relance' })).json).toEqual({ scriptId, nom: 'Relance' });
    expect((await appeler('archiver_script', { entreprise: 'gite-fictif', scriptId, archive: true })).json).toEqual({ scriptId, archive: true, usage: { campagnes: 0, appelsEnCours: 0 } });
    expect(await db.select({ nom: scripts.nom, archive: scripts.archive }).from(scripts)).toEqual([{ nom: 'Relance', archive: true }]);
    expect(await appeler('nouvelle_campagne', { entreprise: 'gite-fictif', versionScriptId, ligne: 'simulation', prospects: ['julie'] })).toMatchObject({
      erreur: true,
      texte: expect.stringContaining('Ce script est archivé'),
    });
    await basculerArchiveScript(e.id, scriptId, false);
    expect((await appeler('nouvelle_campagne', { entreprise: 'gite-fictif', versionScriptId, ligne: 'simulation', prospects: ['julie'] })).erreur).toBe(false);
  });

  it('crée une version seulement si `connu` est la dernière version', async () => {
    const e = await entrepriseDeTest();
    const { scriptId } = await creerScript(e.id, 'Découverte');

    expect(await appeler('creer_version_script', { entreprise: 'gite-fictif', scriptId, etapes: [{ intention: 'Autre accroche', exemples: [] }], connu: 2 })).toMatchObject({
      erreur: true,
      texte: expect.stringContaining('Une v1 a été créée'),
    });
    expect((await appeler('creer_version_script', { entreprise: 'gite-fictif', scriptId, etapes: [{ intention: 'Autre accroche', exemples: [] }], connu: 1 })).json).toMatchObject({ numero: 2 });
    expect((await db.select({ creePar: versionsScript.creePar }).from(versionsScript)).map((v) => v.creePar).sort()).toEqual(['mcp', null]);
  });
});

describe('supprimer_entreprise', () => {
  it('annonce ce qui part et supprime une entreprise vide après l’accord ; refuse sans rien demander une entreprise qui a un historique', async () => {
    const c = await clientDeTest({ elicitation: 'accepter' });
    try {
      const vide = await entrepriseDeTest('Erreur fictive', 'erreur-fictive');
      await creerScript(vide.id, 'Découverte');
      const pleine = await entrepriseDeTest();
      await importerFiches(pleine.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);

      expect(await c.appeler('supprimer_entreprise', { entreprise: 'gite-fictif' })).toMatchObject({ erreur: true, texte: expect.stringContaining('1 prospect, 1 import') });
      expect(c.messages).toHaveLength(0);
      expect((await c.appeler('supprimer_entreprise', { entreprise: 'erreur-fictive' })).json).toMatchObject({ supprimee: true, scripts: 1, versions: 1 });
      expect(c.messages[0]).toBe(
        'Supprimer définitivement l’entreprise Erreur fictive (erreur-fictive) et sa fiche, avec 1 script (1 version). Rien ne se récupère.',
      );
      expect((await db.select({ slug: entreprises.slug }).from(entreprises)).map((e) => e.slug)).toEqual(['gite-fictif']);
    } finally {
      await c.fermer();
    }
  });
});

describe('archiver_issue', () => {
  it('archive puis désarchive une issue, refuse celle d’une autre entreprise, et journalise chaque geste', async () => {
    const e = await entrepriseDeTest();
    const autre = await entrepriseDeTest('Autre fictive', 'autre-fictive');
    const [issue] = await db.insert(issuesPersonnalisees).values({ entrepriseId: e.id, libelle: 'Veut une plaquette', issueSysteme: 'refus' }).returning();
    const [ailleurs] = await db.insert(issuesPersonnalisees).values({ entrepriseId: autre.id, libelle: 'Déjà équipé', issueSysteme: 'refus' }).returning();
    const archivee = async (id: string) => (await db.select({ archivee: issuesPersonnalisees.archivee }).from(issuesPersonnalisees).where(eq(issuesPersonnalisees.id, id)))[0]?.archivee;

    expect((await appeler('archiver_issue', { entreprise: 'gite-fictif', issueId: issue!.id, archivee: true })).json).toEqual({ issueId: issue!.id, archivee: true });
    expect(await archivee(issue!.id)).toBe(true);
    expect((await appeler('archiver_issue', { entreprise: 'gite-fictif', issueId: issue!.id, archivee: false })).json).toEqual({ issueId: issue!.id, archivee: false });
    expect(await archivee(issue!.id)).toBe(false);

    expect(await appeler('archiver_issue', { entreprise: 'gite-fictif', issueId: ailleurs!.id, archivee: true })).toMatchObject({
      erreur: true,
      texte: 'Cette issue n’existe pas dans cette entreprise.',
    });
    expect(await archivee(ailleurs!.id)).toBe(false);

    const journal = await db.select().from(journalMcp).where(eq(journalMcp.outil, 'archiver_issue'));
    expect(journal.map((j) => j.resultat).sort()).toEqual(['ok', 'ok', 'refus']);
    expect(journal.find((j) => j.resultat === 'refus')?.arguments).toEqual({ entreprise: 'gite-fictif', issueId: ailleurs!.id, archivee: true });
  });
});
