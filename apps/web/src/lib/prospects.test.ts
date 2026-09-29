import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { consentements, imports, prospects } from '@/db/schema';
import { avecBaseDeTest } from '../../test/outils';
import { entrepriseDeTest, fiche } from '../../test/fixtures';
import { importerFiches, revoquerNumero } from './prospects';

avecBaseDeTest();

describe('importerFiches', () => {
  it('crée les prospects et autorise leurs numéros avec le texte de consentement en vigueur', async () => {
    const e = await entrepriseDeTest();

    const rapport = await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);

    expect(rapport).toMatchObject({ etat: 'fait', crees: ['julie', 'marc'], numerosAutorises: 2, numerosRevoques: [] });
    const lignes = await db.select().from(consentements);
    expect(lignes.map((c) => c.numero).sort()).toEqual(['+33639980001', '+33639980002']);
    expect(lignes.every((c) => c.texteVersion === 1 && c.revoqueLe === null)).toBe(true);
    expect(await db.$count(imports)).toBe(1);
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
