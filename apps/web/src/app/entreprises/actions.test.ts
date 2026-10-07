import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { entreprises, issuesPersonnalisees } from '@/db/schema';
import { ajouterIssue, creerScript } from '@/lib/entreprises';
import { importerFiches } from '@/lib/prospects';
import { entrepriseDeTest, fiche } from '../../../test/fixtures';
import { avecBaseDeTest } from '../../../test/outils';

const etat = vi.hoisted(() => ({ operateur: true, revalidations: [] as string[] }));
vi.mock('@/lib/garde', () => ({ exigerOperateur: async () => {
  if (!etat.operateur) throw new Error('accès réservé à l’opérateur');
} }));
vi.mock('next/cache', () => ({ revalidatePath: (chemin: string) => void etat.revalidations.push(chemin) }));

const { supprimerEntreprise } = await import('./actions');
const { renommerIssue, enregistrerFiche } = await import('./[slug]/actions');
avecBaseDeTest();
beforeEach(() => { etat.operateur = true; etat.revalidations = []; });

describe('configuration des entreprises depuis l’interface', () => {
  it('supprime une entreprise vide et sa configuration seulement après confirmation', async () => {
    const e = await entrepriseDeTest();
    await creerScript(e.id, 'Découverte fictive');
    expect(await supprimerEntreprise(e.id, false)).toMatchObject({ ok: false });
    expect((await db.select().from(entreprises))).toHaveLength(1);
    expect(await supprimerEntreprise(e.id, true)).toMatchObject({ ok: true });
    expect((await db.select().from(entreprises))).toHaveLength(0);
    expect(etat.revalidations).toContain('/entreprises');
  });

  it('refuse la suppression si un prospect a été ajouté depuis l’ouverture de la page', async () => {
    const e = await entrepriseDeTest();
    await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01')]);
    expect(await supprimerEntreprise(e.id, true)).toMatchObject({ ok: false, raison: expect.stringContaining('historique') });
    expect(await supprimerEntreprise('invalide', true)).toMatchObject({ ok: false });
    expect((await db.select().from(entreprises))).toHaveLength(1);
    expect(etat.revalidations).toEqual([]);
  });

  it('renomme une issue sans changer son rattachement et refuse les libellés invalides ou d’une autre entreprise', async () => {
    const e = await entrepriseDeTest();
    const autre = await entrepriseDeTest('Autre entreprise fictive', 'autre-fictive');
    const id = await ajouterIssue(e.id, { libelle: 'Documentation', issueSysteme: 'envoi-informations' });
    expect(await renommerIssue(autre.id, id, 'Autre libellé')).toMatchObject({ ok: false });
    expect(await renommerIssue(e.id, id, 'Nom\nsur deux lignes')).toMatchObject({ ok: false });
    expect(await renommerIssue(e.id, id, ' Brochure envoyée ')).toEqual({ ok: true, libelle: 'Brochure envoyée' });
    expect((await db.select().from(issuesPersonnalisees))[0]).toMatchObject({ id, libelle: 'Brochure envoyée', issueSysteme: 'envoi-informations' });
  });

  it('enregistre une durée libre et des plages à la minute, avec la garde de concurrence de la fiche', async () => {
    const e = await entrepriseDeTest();
    const donnees = new FormData();
    for (const cle of ['nom', 'offre', 'cible', 'arguments', 'prixConsigne', 'interdits', 'complements', 'interlocuteur', 'dureeRendezVousMinutes', 'delaiMinimumHeures', 'horizonJours'] as const) {
      donnees.set(cle, String(e[cle]));
    }
    donnees.set('connu', e.modifieLe.toISOString());
    donnees.set('dureeRendezVousMinutes', '90');
    donnees.set('jour-1', 'on');
    donnees.set('debut-1', '06:17');
    donnees.set('fin-1', '23:43');
    expect(await enregistrerFiche(e.id, null, donnees)).toMatchObject({ ok: true });
    expect((await db.select().from(entreprises))[0]).toMatchObject({ dureeRendezVousMinutes: 90, plagesRendezVous: [{ jour: 1, debut: '06:17', fin: '23:43' }] });
    donnees.set('dureeRendezVousMinutes', '120');
    expect(await enregistrerFiche(e.id, null, donnees)).toMatchObject({ conflit: { jeton: expect.any(String) } });
    donnees.set('dureeRendezVousMinutes', '121');
    expect(await enregistrerFiche(e.id, null, donnees)).toMatchObject({ erreurs: { dureeRendezVousMinutes: expect.any(String) } });
  });

  it('réserve les suppressions et renommages à l’opérateur', async () => {
    const e = await entrepriseDeTest();
    const id = await ajouterIssue(e.id, { libelle: 'Documentation', issueSysteme: 'envoi-informations' });
    etat.operateur = false;
    await expect(supprimerEntreprise(e.id, true)).rejects.toThrow('réservé à l’opérateur');
    await expect(renommerIssue(e.id, id, 'Brochure')).rejects.toThrow('réservé à l’opérateur');
    expect((await db.select().from(entreprises))).toHaveLength(1);
  });
});
