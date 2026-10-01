import { TransitionInvalide } from '@autocalled/domain';
import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { entrepriseDeTest, fiche } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import { preparerAppel } from './appels';
import { demarrerCampagne, enregistrerCampagne, obstacleNouvelleCampagne } from './campagnes';
import { basculerArchiveScript, creerScript } from './entreprises';
import { archiverProspect, importerFiches } from './prospects';
import { rappelsDuJour } from './rappels';

/** Les contrôles que le MCP applique, tenus aussi pour l'interface par la bibliothèque. */

avecBaseDeTest();

async function deuxEntreprises() {
  const e = await entrepriseDeTest();
  const autre = await entrepriseDeTest('Autre fictive', 'autre-fictive');
  await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '+33639980001')]);
  const script = await creerScript(e.id, 'Découverte');
  const etranger = await creerScript(autre.id, 'Ailleurs');
  return { e, script, etranger };
}

describe('obstacleNouvelleCampagne', () => {
  it('refuse la version d’une autre entreprise, un script archivé, un prospect inconnu et une file trop longue', async () => {
    const { e, script, etranger } = await deuxEntreprises();
    const saisie = (versionScriptId: string, prospects = ['julie']) => ({ versionScriptId, ligne: 'bluetooth' as const, prospects });

    expect(await obstacleNouvelleCampagne(e.id, saisie(script.versionScriptId))).toBeNull();
    expect(await obstacleNouvelleCampagne(e.id, saisie(etranger.versionScriptId))).toMatch(/n’appartient pas/);
    expect(await obstacleNouvelleCampagne(e.id, saisie(script.versionScriptId, ['julie', 'inconnu']))).toMatch(/introuvable.*inconnu/);
    expect(await obstacleNouvelleCampagne(e.id, saisie(script.versionScriptId, Array.from({ length: 201 }, (_, i) => `p${i}`)))).toMatch(/200/);
    await basculerArchiveScript(e.id, script.scriptId, true);
    expect(await obstacleNouvelleCampagne(e.id, saisie(script.versionScriptId))).toMatch(/archivé/);
  });
});

describe('demarrerCampagne', () => {
  it('une campagne prête ne part pas sur un script archivé entre-temps', async () => {
    const { e, script } = await deuxEntreprises();
    const campagneId = await enregistrerCampagne(e.id, { versionScriptId: script.versionScriptId, ligne: 'navigateur', prospects: ['julie'] });
    await basculerArchiveScript(e.id, script.scriptId, true);
    await expect(demarrerCampagne(campagneId)).rejects.toThrow(TransitionInvalide);
  });
});

describe('preparerAppel', () => {
  it('refuse la version d’un script d’une autre entreprise', async () => {
    const { e, script, etranger } = await deuxEntreprises();
    expect((await preparerAppel(e.id, 'julie', script.versionScriptId)).ok).toBe(true);
    expect(await preparerAppel(e.id, 'julie', etranger.versionScriptId)).toEqual({ ok: false, raison: 'Prospect ou version de script introuvable.' });
  });
});

describe('rappels à faire', () => {
  it('un prospect archivé depuis n’a plus de rappel', async () => {
    const { e, script } = await deuxEntreprises();
    await db.insert(appels).values({
      entrepriseId: e.id,
      prospectId: 'julie',
      versionScriptId: script.versionScriptId,
      ligne: 'bluetooth',
      numero: '+33639980001',
      statut: 'termine',
      debutLe: new Date(Date.now() - 86_400_000),
      issue: 'rappel-convenu',
      issueSysteme: 'rappel-convenu',
      rappelLe: new Date(Date.now() - 3_600_000),
    });
    expect((await rappelsDuJour()).rappels).toHaveLength(1);
    await archiverProspect(e.id, 'julie', 'interface', []);
    expect((await rappelsDuJour()).rappels).toHaveLength(0);
  });
});
