import { eq, isNotNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, campagnes, imports, prospects } from '@/db/schema';
import { avecBaseDeTest } from '../../test/outils';
import { agendaFrais, entrepriseDeTest, fiche, opposer } from '../../test/fixtures';
import { PROSPECT_ARCHIVE, preparerAppel } from './appels';
import { appelabiliteDe } from './appelables';
import { PROSPECTS_ARCHIVES, ajouterALaCampagne, enregistrerCampagne, obstacleNouvelleCampagne } from './campagnes';
import { creerScript } from './entreprises';
import {
  archiverProspect,
  FicheChangee,
  filesEnAttente,
  filesEnAttenteDesProspects,
  importerFiches,
  modifierProspect,
  NUMERO_EFFACE,
  reactiverProspect,
} from './prospects';
import { rappelsDuJour } from './rappels';

avecBaseDeTest();

describe('importerFiches', () => {
  it('crée les prospects et note l’import, sans rien demander d’autre', async () => {
    const e = await entrepriseDeTest();

    const rapport = await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);

    expect(rapport).toEqual({ etat: 'fait', crees: ['julie', 'marc'], misAJour: [], inchanges: [], refus: [], archives: [] });
    expect(await db.select({ nombreFiches: imports.nombreFiches }).from(imports)).toEqual([{ nombreFiches: 2 }]);
    expect((await appelabiliteDe(['+33639980001', '+33639980002'])).get('+33639980002')?.appelable).toBe(true);
  });

  it('met une fiche à jour', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);

    const rapport = await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01', 'Nouveau contexte.')]);

    expect(rapport).toMatchObject({ etat: 'fait', misAJour: ['julie'] });
    const [p] = await db.select().from(prospects).where(eq(prospects.id, 'julie'));
    expect(p?.contexte).toBe('Nouveau contexte.');
  });

  it('refuse la fiche d’un numéro effacé, sans bloquer les autres', async () => {
    const e = await entrepriseDeTest();
    await opposer('+33639980001');

    const rapport = await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);

    expect(rapport).toMatchObject({ etat: 'fait', crees: ['marc'], refus: [{ nomFichier: 'julie.md', erreurs: [NUMERO_EFFACE] }] });
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

describe('modifierProspect', () => {
  it('corrige un champ, efface un facultatif, et garde le reste', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01', 'Contexte de départ.')]);

    const r = await modifierProspect(e.id, 'julie', { role: 'Gérante', societe: null });

    expect(r).toMatchObject({ ok: true, rapport: { misAJour: ['julie'] } });
    const [p] = await db.select().from(prospects);
    expect(p).toMatchObject({ nom: 'Julie Fictive', role: 'Gérante', societe: null, contexte: 'Contexte de départ.', telephone: '+33639980001' });
    expect(await db.$count(imports)).toBe(2);
  });

  it('accepte un nouveau numéro, jamais celui d’une personne effacée', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    await opposer('+33639980009');

    expect(await modifierProspect(e.id, 'julie', { telephone: '06 39 98 00 02' })).toMatchObject({ ok: true, rapport: { misAJour: ['julie'] } });
    expect(await modifierProspect(e.id, 'julie', { telephone: '06 39 98 00 09' })).toMatchObject({ ok: false, raison: expect.stringContaining(NUMERO_EFFACE) });
    expect((await db.select({ telephone: prospects.telephone }).from(prospects))[0]?.telephone).toBe('+33639980002');
  });

  it('refuse une fiche invalide, une fiche inchangée ou relue avant une autre écriture', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    const [p] = await db.select().from(prospects);

    expect(await modifierProspect(e.id, 'julie', { telephone: 'pas un numéro' })).toMatchObject({ ok: false, raison: expect.stringContaining('telephone invalide') });
    expect(await modifierProspect(e.id, 'julie', { nom: 'Julie Fictive' })).toEqual({ ok: false, raison: 'Ces champs ne changent rien à la fiche.' });
    await modifierProspect(e.id, 'julie', { role: 'Gérante' });
    expect(await modifierProspect(e.id, 'julie', { role: 'Associée' }, { connu: p!.majLe.toISOString() })).toMatchObject({ ok: false, conflit: expect.any(Object) });
    expect(await modifierProspect(e.id, 'personne', { role: 'x' })).toMatchObject({ ok: false });
  });

  it('refait la comparaison sous verrou dans l’import : une fiche changée entre-temps n’est pas écrasée', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    const [lue] = await db.select().from(prospects);
    // Un réimport arrive entre la lecture de la correction et son écriture.
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01', 'Contexte du réimport.')]);
    const imports1 = await db.$count(imports);

    await expect(importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 05')], { attendu: { prospectId: 'julie', majLe: lue!.majLe } })).rejects.toBeInstanceOf(FicheChangee);

    const [apres] = await db.select().from(prospects);
    expect(apres).toMatchObject({ telephone: '+33639980001', contexte: 'Contexte du réimport.' });
    expect(await db.$count(imports)).toBe(imports1);
  });
});

describe('archiverProspect et reactiverProspect', () => {
  it('le retire de la file d’une campagne non terminée, le rend inappelable et hors campagne, garde ses appels', async () => {
    const e = await entrepriseDeTest();
    await agendaFrais();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    const campagneId = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'simulation', prospects: ['julie', 'marc'] });
    const terminee = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'simulation', prospects: ['julie'] });
    await db.update(campagnes).set({ statut: 'terminee' }).where(eq(campagnes.id, terminee));
    await db.insert(appels).values({ entrepriseId: e.id, prospectId: 'julie', versionScriptId, ligne: 'simulation', numero: '+33639980001', statut: 'termine' });

    // La file où il attend est nommée pour la confirmation ; la campagne terminée n'y est pas.
    const files = await filesEnAttente(e.id, 'julie');
    expect(files).toEqual([{ id: campagneId, libelle: expect.stringMatching(/^Campagne du \d\d\/\d\d · Découverte v1, prête$/), derniere: false }]);
    expect((await filesEnAttenteDesProspects(e.id)).get('julie')).toEqual(files);
    expect(await archiverProspect(e.id, 'julie', 'interface', [campagneId])).toEqual({ ok: true, deja: false, retireDe: [campagneId], terminees: [] });

    const [c] = await db.select().from(campagnes).where(eq(campagnes.id, campagneId));
    expect(c?.entrees[0]).toMatchObject({ prospectId: 'julie', etat: 'retiree', motif: 'retrait', par: 'interface' });
    // La campagne terminée garde son historique tel quel.
    expect((await db.select().from(campagnes).where(eq(campagnes.id, terminee)))[0]?.entrees).toEqual([{ prospectId: 'julie', etat: 'a-appeler' }]);
    expect(await preparerAppel(e.id, 'julie', versionScriptId)).toEqual({ ok: false, raison: PROSPECT_ARCHIVE });
    expect(await obstacleNouvelleCampagne(e.id, { versionScriptId, ligne: 'simulation', prospects: ['julie'] })).toContain(PROSPECTS_ARCHIVES);
    const autre = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'simulation', prospects: ['marc'] });
    expect(await ajouterALaCampagne(autre, ['julie'])).toMatchObject({ ok: false, raison: expect.stringContaining(PROSPECTS_ARCHIVES) });
    expect(await db.$count(appels)).toBe(1);
    expect((await appelabiliteDe(['+33639980001'])).get('+33639980001')?.appelable).toBe(true);
    // Idempotent ; un réimport le laisse archivé et le dit.
    expect(await archiverProspect(e.id, 'julie', 'mcp', [])).toMatchObject({ ok: true, deja: true });
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

    expect((await filesEnAttente(e.id, 'julie'))[0]?.derniere).toBe(true);
    expect(await archiverProspect(e.id, 'julie', 'interface', [campagneId])).toMatchObject({ ok: true, terminees: [campagneId] });
    expect((await db.select().from(campagnes))[0]?.statut).toBe('terminee');
  });

  it('refuse, sans rien changer, une file où il attend sans avoir été confirmée', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    const premiere = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'simulation', prospects: ['julie', 'marc'] });

    // Sans confirmation (lu hors de toute file), puis ajouté à une seconde file entre la lecture et le geste.
    const sans = await archiverProspect(e.id, 'julie', 'interface', []);
    expect(sans).toMatchObject({
      ok: false,
      raison: expect.stringMatching(/attend dans la file de Campagne du .* rien n’est archivé tant que son retrait de cette file n’est pas confirmé/),
      aConfirmer: [{ id: premiere, libelle: expect.stringContaining('Découverte v1'), derniere: false }],
    });
    const seconde = await enregistrerCampagne(e.id, { versionScriptId, ligne: 'simulation', prospects: ['julie'] });
    expect(await archiverProspect(e.id, 'julie', 'interface', [premiere])).toMatchObject({ ok: false, aConfirmer: [{ id: seconde, derniere: true }] });
    expect(await db.$count(prospects, isNotNull(prospects.archiveLe))).toBe(0);
    expect((await db.select().from(campagnes).where(eq(campagnes.id, premiere)))[0]?.entrees[0]).toEqual({ prospectId: 'julie', etat: 'a-appeler' });

    // Confirmée pour les deux : retiré des deux. Une file confirmée qu'il a quittée entre-temps ne gêne pas.
    expect(await archiverProspect(e.id, 'julie', 'interface', [premiere, seconde, '00000000-0000-4000-8000-000000000000'])).toMatchObject({
      ok: true,
      retireDe: [premiere, seconde].sort(),
    });
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

    expect(await archiverProspect(e.id, 'julie', 'interface', [])).toMatchObject({ ok: false, raison: expect.stringContaining('en cours') });
    expect(await archiverProspect(e.id, 'marc', 'interface', [campagneId])).toMatchObject({ ok: false, raison: expect.stringContaining('en appel dans une campagne') });
    expect(await archiverProspect(e.id, 'personne', 'interface', [])).toMatchObject({ ok: false });
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

    await archiverProspect(e.id, 'julie', 'interface', []);

    expect((await rappelsDuJour()).rappels).toHaveLength(0);
  });
});
