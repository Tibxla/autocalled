import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, entreprises } from '@/db/schema';
import { entrepriseDeTest, fiche } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import { apercuVariablesAppel } from './apercu';
import { preparerAppel } from './appels';
import { creerScript, creerVersion, enregistrerObjection } from './entreprises';
import { importerFiches, revoquerNumero } from './prospects';

avecBaseDeTest();

const vide = { creuser: '', reformuler: '', argumenter: '', controler: '' };

describe('apercuVariablesAppel', () => {
  it('sans prospect : les variables de l’entreprise, la dernière version du premier script, les défauts et les champs non transmis', async () => {
    const e = await entrepriseDeTest();
    const { scriptId } = await creerScript(e.id, 'Découverte');
    await creerVersion(e.id, scriptId, [{ intention: 'Accroche courte', exemples: ['Bonjour !'] }]);
    await creerScript(e.id, 'Relance');

    const apercu = await apercuVariablesAppel(e.id);

    expect(apercu).toMatchObject({ ok: true, prospect: null, version: { numero: 2, script: 'Découverte' }, motsCles: ['Gîte fictif'] });
    if (!apercu.ok) return;
    expect(apercu.variables.script_etapes).toBe('1. Accroche courte (par exemple : « Bonjour ! »)');
    expect(apercu.variables.entreprise_offre).toBe('');
    expect(apercu.variables.entreprise_complements).toBe('');
    expect(apercu.nonTransmis).toEqual([
      'entreprise_offre',
      'entreprise_cible',
      'entreprise_arguments',
      'entreprise_prix_consigne',
      'entreprise_interdits',
      'entreprise_complements',
    ]);
    expect(apercu.parDefaut).toEqual(expect.arrayContaining(['rendez_vous', 'objections']));
    expect(apercu.parDefaut).not.toContain('entreprise_offre');
    expect(apercu.parDefaut).not.toContain('script_etapes');
    expect(apercu.dependDuProspect).toContain('prospect_nom');
    expect(await db.$count(appels)).toBe(0);
  });

  it('avec un prospect : les mêmes variables que l’appel réel, objections dans l’ordre', async () => {
    const e = await entrepriseDeTest();
    await db.update(entreprises).set({ offre: 'Des nuits au calme.', complements: 'Parking : gratuit devant le gîte.' });
    await enregistrerObjection(e.id, null, { libelle: 'Trop cher', ...vide });
    await enregistrerObjection(e.id, null, { libelle: 'Pas le temps', ...vide });
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    const { versionScriptId } = await creerScript(e.id, 'Découverte');

    const apercu = await apercuVariablesAppel(e.id, { prospectId: 'julie', versionScriptId });
    const reel = await preparerAppel(e.id, 'julie', versionScriptId);

    expect(apercu.ok && reel.ok).toBe(true);
    if (!apercu.ok || !reel.ok) return;
    expect(apercu.variables).toEqual(reel.variables);
    expect(apercu.motsCles).toEqual(reel.motsCles);
    expect(apercu.variables.objections).toBe('Trop cher\nPas le temps');
    expect(apercu.prospect).toEqual({ id: 'julie', nom: 'Julie Fictive', refus: null });
    expect(apercu.parDefaut).toContain('prospect_role');
    expect(apercu.variables.entreprise_complements).toBe('Parking : gratuit devant le gîte.');
    expect(apercu.nonTransmis).not.toContain('entreprise_offre');
    expect(apercu.nonTransmis).not.toContain('entreprise_complements');
    expect(apercu.nonTransmis).toContain('entreprise_cible');
  });

  it('signale un numéro révoqué sans refuser l’aperçu', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    await revoquerNumero('+33639980001');

    const apercu = await apercuVariablesAppel(e.id, { prospectId: 'julie' });

    expect(apercu).toMatchObject({ ok: true, prospect: { refus: 'consentement-revoque' }, version: null });
  });

  it('refuse une version ou un prospect d’une autre entreprise', async () => {
    const e = await entrepriseDeTest();
    const autre = await entrepriseDeTest('Autre fictive', 'autre-fictive');
    const { versionScriptId } = await creerScript(autre.id, 'Découverte');
    await importerFiches(autre.id, [fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);

    expect(await apercuVariablesAppel(e.id, { versionScriptId })).toEqual({ ok: false, raison: 'Cette version de script n’appartient pas à cette entreprise.' });
    expect(await apercuVariablesAppel(e.id, { prospectId: 'marc' })).toEqual({ ok: false, raison: 'Ce prospect n’existe pas dans cette entreprise.' });
  });
});
