import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, campagnes, consentements, imports, prospects, rendezVous } from '@/db/schema';
import { avecBaseDeTest } from '../../test/outils';
import { entrepriseDeTest, fiche } from '../../test/fixtures';
import { enregistrerCampagne } from './campagnes';
import { creerScript } from './entreprises';
import { consentementsDuNumero, FicheChangee, importerFiches, modifierProspect, revoquerNumero, supprimerProspect, texteConsentementEnVigueur } from './prospects';

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

describe('supprimerProspect', () => {
  it('efface la fiche, garde ses appels et le consentement du numéro', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    await db.insert(appels).values({ entrepriseId: e.id, prospectId: 'julie', versionScriptId, ligne: 'simulation', numero: '+33639980001', statut: 'termine' });

    expect(await supprimerProspect(e.id, 'julie')).toEqual({ ok: true, appelsGardes: 1 });
    expect(await db.$count(prospects)).toBe(0);
    expect(await db.$count(appels)).toBe(1);
    expect(await db.$count(consentements)).toBe(1);
  });

  it('refuse un prospect en file d’une campagne non terminée, ou en appel', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    await enregistrerCampagne(e.id, { versionScriptId, ligne: 'simulation', prospects: ['julie'] });
    await db.insert(appels).values({ entrepriseId: e.id, prospectId: 'marc', versionScriptId, ligne: 'bluetooth', numero: '+33639980002' });

    expect(await supprimerProspect(e.id, 'julie')).toMatchObject({ ok: false, raison: expect.stringContaining('retirer_de_la_file') });
    expect(await supprimerProspect(e.id, 'marc')).toMatchObject({ ok: false, raison: expect.stringContaining('en cours') });
    await db.update(campagnes).set({ statut: 'terminee' });
    expect(await supprimerProspect(e.id, 'julie')).toMatchObject({ ok: true });
  });

  it('refuse un prospect dont un rendez-vous reste à inscrire dans Google Agenda (à créer, échec)', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    const { versionScriptId } = await creerScript(e.id, 'Découverte');
    const [a] = await db.insert(appels).values({ entrepriseId: e.id, prospectId: 'julie', versionScriptId, ligne: 'bluetooth', numero: '+33639980001', statut: 'termine' }).returning();
    const debut = new Date(Date.UTC(2026, 9, 1, 9));
    const [r] = await db.insert(rendezVous).values({ appelId: a!.id, debut, fin: new Date(debut.getTime() + 1_800_000) }).returning();

    expect(await supprimerProspect(e.id, 'julie')).toMatchObject({ ok: false, raison: expect.stringContaining('en cours d’inscription') });
    await db.update(rendezVous).set({ statut: 'echec' }).where(eq(rendezVous.id, r!.id));
    expect(await supprimerProspect(e.id, 'julie')).toMatchObject({ ok: false, raison: expect.stringContaining('recreer_evenement') });
    await db.update(rendezVous).set({ statut: 'cree' }).where(eq(rendezVous.id, r!.id));
    expect(await supprimerProspect(e.id, 'julie')).toMatchObject({ ok: true });
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
