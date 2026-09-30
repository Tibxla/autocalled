import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { prospects, scripts, versionsScript } from '@/db/schema';
import { entrepriseDeTest } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import { ceQueVoitLAssistante } from './ce-que-voit-l-assistante';
import { texteDesSegments, resoudre } from './vue-assistante';

avecBaseDeTest();

async function versionDe(entrepriseId: string, nom: string) {
  const [script] = await db.insert(scripts).values({ entrepriseId, nom }).returning();
  const [version] = await db
    .insert(versionsScript)
    .values({ scriptId: script!.id, numero: 1, etapes: [{ intention: 'Accroche', exemples: [] }] })
    .returning();
  return version!;
}

describe('ce que voit l’assistante', () => {
  it('prend la première entreprise sans choix, et marque les variables du prospect sans prospect', async () => {
    const entreprise = await entrepriseDeTest('Atelier fictif', 'atelier-fictif');
    await versionDe(entreprise.id, 'Accroche courte');

    const r = await ceQueVoitLAssistante({});

    expect(r.entreprise?.slug).toBe('atelier-fictif');
    expect(r.erreur).toBeNull();
    expect(r.vue?.version).toEqual({ script: 'Accroche courte', numero: 1 });
    expect(r.etats).toMatchObject({ prospect_nom: 'selon-la-fiche', entreprise_offre: 'par-defaut', entreprise_nom: 'valeur' });
    const prompt = texteDesSegments(resoudre(r.vue!.prompt, r.vue!.variables, r.etats));
    expect(prompt).toContain('Atelier fictif');
    expect(prompt).toContain('[{{prospect_nom}} : selon la fiche du prospect]');
    expect(prompt).not.toMatch(/\{\{(?!prospect_|historique_appels)\w+\}\}/);
  });

  it('résout les variables du prospect choisi', async () => {
    const entreprise = await entrepriseDeTest();
    await db.insert(prospects).values({ entrepriseId: entreprise.id, id: 'lea-fictive', nom: 'Léa Fictive', telephone: '+33639980003', contexte: '' });

    const r = await ceQueVoitLAssistante({ entreprise: entreprise.slug, prospect: 'lea-fictive' });

    expect(r.vue?.prospect).toBe('Léa Fictive');
    expect(r.etats).toMatchObject({ prospect_nom: 'valeur', prospect_contexte: 'par-defaut' });
    expect(r.vue?.variables.prospect_nom).toBe('Léa Fictive');
  });

  it('refuse une version d’une autre entreprise, un identifiant mal formé et une entreprise inconnue', async () => {
    const a = await entrepriseDeTest('Atelier A', 'atelier-a');
    const b = await entrepriseDeTest('Atelier B', 'atelier-b');
    const versionB = await versionDe(b.id, 'Script B');

    expect((await ceQueVoitLAssistante({ entreprise: a.slug, version: versionB.id })).erreur).toBe('Cette version de script n’appartient pas à cette entreprise.');
    expect((await ceQueVoitLAssistante({ entreprise: a.slug, version: 'pas-un-uuid' })).vue).toBeNull();
    expect((await ceQueVoitLAssistante({ entreprise: 'inconnue' })).erreur).toBe('Cette entreprise n’existe pas.');
  });
});
