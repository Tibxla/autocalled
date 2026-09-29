import { eq, isNotNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, campagnes, consentements, imports, prospects } from '@/db/schema';
import { avecBaseDeTest } from '../../test/outils';
import { agendaFrais, entrepriseDeTest, fiche } from '../../test/fixtures';
import { PROSPECT_ARCHIVE, preparerAppel } from './appels';
import { autorisationsDe } from './autorisations';
import { PROSPECTS_ARCHIVES, ajouterALaCampagne, enregistrerCampagne, obstacleNouvelleCampagne } from './campagnes';
import { creerScript } from './entreprises';
import {
  archiverProspect,
  consentementsDuNumero,
  FicheChangee,
  importerFiches,
  modifierProspect,
  reactiverProspect,
  revoquerNumero,
  texteConsentementEnVigueur,
} from './prospects';
import { rappelsDuJour } from './rappels';

avecBaseDeTest();

describe('importerFiches', () => {
  it('crée les prospects et autorise leurs numéros avec le texte de consentement en vigueur', async () => {
    const e = await entrepriseDeTest();

    const rapport = await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);

    expect(rapport).toMatchObject({ etat: 'fait', crees: ['julie', 'marc'], numerosAutorises: 2, numerosRevoques: [] });
    const lignes = await db.select().from(consentements);
    expect(lignes.map((c) => c.numero).sort()).toEqual(['+33639980001', '+33639980002']);
    expect(lignes.every((c) => c.texteVersion === 2 && c.revoqueLe === null)).toBe(true);
    expect(await db.select({ canal: imports.canal }).from(imports)).toEqual([{ canal: 'interface' }]);
  });

  it('met une fiche à jour sans créer de second consentement pour un numéro déjà autorisé', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);

    const rapport = await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01', 'Nouveau contexte.')]);

    expect(rapport).toMatchObject({ etat: 'fait', misAJour: ['julie'], numerosAutorises: 0 });
    expect(await db.$count(consentements)).toBe(1);
    const [p] = await db.select().from(prospects).where(eq(prospects.id, 'julie'));
    expect(p?.contexte).toBe('Nouveau contexte.');
  });

  it('ne réautorise jamais un numéro révoqué', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    await revoquerNumero('+33639980001');

    const rapport = await importerFiches(e.id, [fiche('julie-bis', 'Julie Fictive', '06 39 98 00 01')]);

    expect(rapport).toMatchObject({ etat: 'fait', crees: ['julie-bis'], numerosAutorises: 0, numerosRevoques: ['06 39 98 00 01'] });
    const lignes = await db.select().from(consentements);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.revoqueLe).not.toBeNull();
  });

  it('refuse une fiche invalide sans bloquer les autres', async () => {
    const e = await entrepriseDeTest();

    const rapport = await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), { nomFichier: 'Mauvais Nom.md', contenu: 'rien' }]);

    expect(rapport).toMatchObject({ etat: 'fait', crees: ['julie'] });
    if (rapport.etat === 'fait') expect(rapport.refus[0]?.nomFichier).toBe('Mauvais Nom.md');
  });

  it('refuse un fichier de plus de 32 Ko', async () => {
    const e = await entrepriseDeTest();

    const rapport = await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01', 'x'.repeat(33 * 1024))]);

    expect(rapport).toEqual({ etat: 'erreur', message: '« julie.md » dépasse 32 Ko : une fiche tient en quelques paragraphes.' });
    expect(await db.$count(prospects)).toBe(0);
  });
});

describe('revoquerNumero', () => {
  it('révoque le numéro pour tous les prospects qui le partagent', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 01')]);

    expect(await revoquerNumero('+33639980001')).toBe(1);
    expect(await revoquerNumero('+33639980001')).toBe(0);
  });
});

describe('modifierProspect', () => {
  it('corrige un champ, efface un facultatif, et garde le reste', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01', 'Contexte de départ.')]);

    const r = await modifierProspect(e.id, 'julie', { role: 'Gérante', societe: null }, { canal: 'mcp' });

    expect(r).toMatchObject({ ok: true, rapport: { misAJour: ['julie'], numerosAutorises: 0 } });
    const [p] = await db.select().from(prospects);
    expect(p).toMatchObject({ nom: 'Julie Fictive', role: 'Gérante', societe: null, contexte: 'Contexte de départ.', telephone: '+33639980001' });
    expect((await db.select({ canal: imports.canal }).from(imports)).map((i) => i.canal)).toEqual(['interface', 'mcp']);
  });

  it('autorise un nouveau numéro, jamais un numéro révoqué', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 09')]);
    await revoquerNumero('+33639980009');

    expect(await modifierProspect(e.id, 'julie', { telephone: '06 39 98 00 02' }, { canal: 'mcp' })).toMatchObject({ ok: true, rapport: { numerosAutorises: 1 } });
    expect(await modifierProspect(e.id, 'julie', { telephone: '06 39 98 00 09' }, { canal: 'mcp' })).toMatchObject({
      ok: true,
      rapport: { numerosAutorises: 0, numerosRevoques: ['06 39 98 00 09'] },
    });
  });

  it('refuse une fiche invalide, une fiche inchangée ou relue avant une autre écriture', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    const [p] = await db.select().from(prospects);

    expect(await modifierProspect(e.id, 'julie', { telephone: 'pas un numéro' }, { canal: 'mcp' })).toMatchObject({ ok: false, raison: expect.stringContaining('telephone invalide') });
    expect(await modifierProspect(e.id, 'julie', { nom: 'Julie Fictive' }, { canal: 'mcp' })).toEqual({ ok: false, raison: 'Ces champs ne changent rien à la fiche.' });
    await modifierProspect(e.id, 'julie', { role: 'Gérante' }, { canal: 'mcp' });
    expect(await modifierProspect(e.id, 'julie', { role: 'Associée' }, { canal: 'mcp', connu: p!.majLe.toISOString() })).toMatchObject({ ok: false, conflit: expect.any(Object) });
    expect(await modifierProspect(e.id, 'personne', { role: 'x' }, { canal: 'mcp' })).toMatchObject({ ok: false });
  });

  it('refait la comparaison sous verrou dans l’import : une fiche changée entre-temps n’est pas écrasée', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    const [lue] = await db.select().from(prospects);
    // Un réimport arrive entre la lecture de la correction et son écriture.
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01', 'Contexte du réimport.')]);
    const imports1 = await db.$count(imports);

    await expect(importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 05')], 'mcp', { attendu: { prospectId: 'julie', majLe: lue!.majLe } })).rejects.toBeInstanceOf(FicheChangee);

    const [apres] = await db.select().from(prospects);
    expect(apres).toMatchObject({ telephone: '+33639980001', contexte: 'Contexte du réimport.' });
    expect(await db.$count(imports)).toBe(imports1);
    expect(await db.$count(consentements, eq(consentements.numero, '+33639980005'))).toBe(0);
  });
});

describe('archiverProspect et reactiverProspect', () => {
  it('le retire de la file d’une campagne non terminée, le rend inappelable et hors campagne, garde appels et consentement', async () => {
    const e = await entrepriseDeTest();
    await agendaFrais();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    const campagneId = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'simulation', prospects: ['julie', 'marc'] });
    const terminee = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'simulation', prospects: ['julie'] });
    await db.update(campagnes).set({ statut: 'terminee' }).where(eq(campagnes.id, terminee));
    await db.insert(appels).values({ entrepriseId: e.id, prospectId: 'julie', versionScriptId, ligne: 'simulation', numero: '+33639980001', statut: 'termine' });

    expect(await archiverProspect(e.id, 'julie', 'interface')).toEqual({ ok: true, deja: false, retireDe: [campagneId], terminees: [] });

    const [c] = await db.select().from(campagnes).where(eq(campagnes.id, campagneId));
    expect(c?.entrees[0]).toMatchObject({ prospectId: 'julie', etat: 'retiree', motif: 'retrait', par: 'interface' });
    // La campagne terminée garde son historique tel quel.
    expect((await db.select().from(campagnes).where(eq(campagnes.id, terminee)))[0]?.entrees).toEqual([{ prospectId: 'julie', etat: 'a-appeler' }]);
    expect(await preparerAppel(e.id, 'julie', versionScriptId)).toEqual({ ok: false, raison: PROSPECT_ARCHIVE });
    expect(await obstacleNouvelleCampagne(e.id, { versionScriptId, ligne: 'simulation', prospects: ['julie'] })).toContain(PROSPECTS_ARCHIVES);
    const autre = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'simulation', prospects: ['marc'] });
    expect(await ajouterALaCampagne(autre, ['julie'])).toMatchObject({ ok: false, raison: expect.stringContaining(PROSPECTS_ARCHIVES) });
    expect(await db.$count(appels)).toBe(1);
    expect((await autorisationsDe(['+33639980001'])).get('+33639980001')?.autorise).toBe(true);
    // Idempotent ; un réimport le laisse archivé et le dit.
    expect(await archiverProspect(e.id, 'julie', 'mcp')).toMatchObject({ ok: true, deja: true });
    expect(await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01', 'Autre contexte.')])).toMatchObject({ etat: 'fait', misAJour: ['julie'], archives: ['julie'] });

    expect(await reactiverProspect(e.id, 'julie')).toEqual({ ok: true, deja: false });
    expect(await preparerAppel(e.id, 'julie', versionScriptId)).toMatchObject({ ok: true });
    // Réactivé, il ne revient dans aucune file.
    expect((await db.select().from(campagnes).where(eq(campagnes.id, campagneId)))[0]?.entrees[0]).toMatchObject({ etat: 'retiree' });
  });

  it('termine la campagne dont il était le dernier à appeler', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    const campagneId = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'simulation', prospects: ['julie'] });

    expect(await archiverProspect(e.id, 'julie', 'interface')).toMatchObject({ ok: true, terminees: [campagneId] });
    expect((await db.select().from(campagnes))[0]?.statut).toBe('terminee');
  });

  it('refuse pendant un appel avec lui, isolé ou de campagne', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    const [a] = await db.insert(appels).values({ entrepriseId: e.id, prospectId: 'julie', versionScriptId, ligne: 'bluetooth', numero: '+33639980001' }).returning();
    const campagneId = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'bluetooth', prospects: ['marc'] });
    await db
      .update(campagnes)
      .set({ statut: 'en-cours', entrees: [{ prospectId: 'marc', etat: 'en-appel', appelId: a!.id }] })
      .where(eq(campagnes.id, campagneId));

    expect(await archiverProspect(e.id, 'julie', 'interface')).toMatchObject({ ok: false, raison: expect.stringContaining('en cours') });
    expect(await archiverProspect(e.id, 'marc', 'interface')).toMatchObject({ ok: false, raison: expect.stringContaining('en appel dans une campagne') });
    expect(await archiverProspect(e.id, 'personne', 'interface')).toMatchObject({ ok: false });
    expect(await db.$count(prospects, isNotNull(prospects.archiveLe))).toBe(0);
  });

  it('sort ses rappels convenus des rappels à faire', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    await db.insert(appels).values({
      entrepriseId: e.id,
      prospectId: 'julie',
      versionScriptId,
      ligne: 'bluetooth',
      numero: '+33639980001',
      statut: 'termine',
      issueSysteme: 'rappel-convenu',
      rappelLe: new Date(Date.now() - 3_600_000),
    });
    expect((await rappelsDuJour()).rappels).toHaveLength(1);

    await archiverProspect(e.id, 'julie', 'interface');

    expect((await rappelsDuJour()).rappels).toHaveLength(0);
  });
});

describe('consentements', () => {
  it('rend le texte en vigueur et l’historique d’un numéro avec son canal', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')], 'mcp');
    await revoquerNumero('+33639980001');

    expect(await texteConsentementEnVigueur()).toMatchObject({ version: 2, texte: expect.stringContaining('assistante vocale IA') });
    expect(await consentementsDuNumero('+33639980001')).toEqual([{ accordeLe: expect.any(Date), revoqueLe: expect.any(Date), texteVersion: 2, canal: 'mcp' }]);
  });
});
