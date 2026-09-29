import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cleFiltreIssue } from '@/components/liste-appels';
import { db } from '@/db';
import { appels, issuesPersonnalisees } from '@/db/schema';
import { creerScript } from '@/lib/entreprises';
import { comptesAppels, comptesParJour, type FiltresAppels, listerAppels, pageAppels, voisinsAppel } from '@/lib/lecture';
import { entrepriseDeTest } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';

avecBaseDeTest();

const JOUR = 86_400_000;
const PARIS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Jeu fictif : une entreprise, deux versions de script, des appels qui couvrent chaque filtre d'issue. */
async function jeu() {
  const e = await entrepriseDeTest();
  const { versionScriptId: v1 } = await creerScript(e.id, 'Découverte');
  const { versionScriptId: v2 } = await creerScript(e.id, 'Relance');
  const [perso] = await db.insert(issuesPersonnalisees).values({ entrepriseId: e.id, libelle: 'Rappel fictif', issueSysteme: 'rappel-convenu' }).returning();
  if (!perso) throw new Error('issue personnalisée non créée');
  const base = { entrepriseId: e.id, prospectId: 'fictif', versionScriptId: v1, ligne: 'bluetooth' as const, numero: '+33639980001' };
  const maintenant = Date.now();
  const lignes: (typeof appels.$inferInsert)[] = [
    { ...base, debutLe: new Date(maintenant), statut: 'termine', issueSysteme: 'rendez-vous-pris', issue: 'rendez-vous-pris' },
    { ...base, debutLe: new Date(maintenant - 1000), statut: 'termine', issueSysteme: 'rendez-vous-pris', issue: 'rendez-vous-pris', versionScriptId: v2 },
    { ...base, debutLe: new Date(maintenant - 3 * JOUR), statut: 'termine', issueSysteme: 'rappel-convenu', issue: `perso:${perso.id}` },
    { ...base, debutLe: new Date(maintenant - 3 * JOUR - 1000), statut: 'echec', erreur: 'composition impossible' },
    { ...base, debutLe: new Date(maintenant - 10 * JOUR), statut: 'echec', conversationId: 'conv-fictive-1', erreur: 'analyse impossible' },
    { ...base, debutLe: new Date(maintenant - 40 * JOUR), statut: 'traitement', conversationId: 'conv-fictive-2' },
    { ...base, debutLe: new Date(maintenant - 40 * JOUR - 1000), statut: 'termine', issueSysteme: 'refus', issue: 'refus', ligne: 'simulation' },
  ];
  const inseres = await db.insert(appels).values(lignes).returning();
  return { e, v1, v2, perso, inseres, maintenant };
}

describe('liste des appels en base', () => {
  it('les comptes par issue en SQL suivent cleFiltreIssue, hors filtre d’issue', async () => {
    const { inseres, perso } = await jeu();
    const attendu: Record<string, number> = {};
    for (const a of inseres) attendu[cleFiltreIssue(a)] = (attendu[cleFiltreIssue(a)] ?? 0) + 1;

    const tous = await comptesAppels({});
    expect(tous.parIssue).toEqual(attendu);
    expect(tous.total).toBe(inseres.length);
    expect(tous.parPerso).toEqual({ [`perso:${perso.id}`]: 1 });

    // Le filtre d'issue ne change pas les comptes (chaque filtre dit ce qu'il montrera) ; « réels » écarte le simulé.
    const reels = await comptesAppels({ issue: 'rendez-vous-pris', reels: true });
    expect(reels.total).toBe(inseres.length - 1);
    expect(reels.parIssue.refus).toBeUndefined();
    expect(reels.parIssue['rendez-vous-pris']).toBe(2);
  });

  it('chaque filtre d’issue en SQL retrouve les appels de cette clé', async () => {
    const { inseres, perso } = await jeu();
    for (const cle of ['rendez-vous-pris', 'non-compose', 'sans-bilan', 'refus']) {
      const ids = (await listerAppels({ issue: cle }, 50)).map((l) => l.appel.id).sort();
      expect(ids, cle).toEqual(
        inseres
          .filter((a) => cleFiltreIssue(a) === cle)
          .map((a) => a.id)
          .sort(),
      );
    }
    const persos = await listerAppels({ issue: `perso:${perso.id}` }, 50);
    expect(persos.map((l) => l.appel.issue)).toEqual([`perso:${perso.id}`]);
    // Issue inconnue : ignorée, comme dans l'URL.
    expect(await listerAppels({ issue: 'inventee' }, 50)).toHaveLength(inseres.length);
  });

  it('période, date précise, version, ligne réelle et recherche', async () => {
    const { v2, inseres, maintenant } = await jeu();
    const compte = async (f: FiltresAppels) => (await comptesAppels(f)).total;
    expect(await compte({ periode: 'aujourdhui' })).toBe(2);
    expect(await compte({ periode: '7-jours' })).toBe(4);
    expect(await compte({ periode: '30-jours' })).toBe(5);
    expect(await compte({ periode: 'tout' })).toBe(inseres.length);
    expect(await compte({ periode: PARIS.format(new Date(maintenant - 40 * JOUR - 1000)) })).toBeGreaterThanOrEqual(1);
    expect(await compte({ periode: '2026-02-31' })).toBe(inseres.length);
    expect(await compte({ version: v2 })).toBe(1);
    expect(await compte({ reels: true })).toBe(inseres.length - 1);
    expect(await compte({ reels: true, ligne: 'simulation' })).toBe(1);
    expect(await compte({ recherche: 'fictif' })).toBe(0);

    await db.execute(sql`update appels set bilan = '{"resume":"Le prospect veut une plaquette."}'::jsonb where id = ${inseres[0]!.id}`);
    expect((await listerAppels({ recherche: 'plaquette' }, 10)).map((l) => l.appel.id)).toEqual([inseres[0]!.id]);
  });

  it('le curseur parcourt toute la liste sans doublon ni trou, même à début identique', async () => {
    const { e, v1 } = await jeu();
    // Trois appels au même début, à la microseconde : seul l'identifiant les départage.
    await db.execute(
      sql`insert into appels (entreprise_id, prospect_id, version_script_id, ligne, numero, statut, debut_le)
          select ${e.id}, 'fictif', ${v1}, 'bluetooth', '+33639980002', 'termine', '2026-01-05 10:00:00.123456+00' from generate_series(1, 3)`,
    );
    const tous = (await listerAppels({}, 100)).map((l) => l.appel.id);
    const vus: string[] = [];
    let avant: string | undefined;
    for (let tour = 0; tour < 10; tour++) {
      const page = await pageAppels({}, { taille: 2, ...(avant ? { avant } : {}) });
      vus.push(...page.lignes.map((l) => l.id));
      if (!page.suivant) break;
      avant = page.suivant;
    }
    expect(vus).toEqual(tous);
    expect(new Set(vus).size).toBe(tous.length);
  });

  it('la vue des rappels va du rappel le plus ancien au plus tardif, les rappels sans date à la fin, sans curseur', async () => {
    const { e, v1 } = await jeu();
    const base = { entrepriseId: e.id, versionScriptId: v1, ligne: 'bluetooth' as const, numero: '+33639980003', statut: 'termine' as const, issueSysteme: 'rappel-convenu' as const };
    const maintenant = Date.now();
    const [sansDate, tardif, ancien] = await db
      .insert(appels)
      .values([
        { ...base, prospectId: 'fictif-a', debutLe: new Date(maintenant - 1000) },
        { ...base, prospectId: 'fictif-b', debutLe: new Date(maintenant - 2000), rappelLe: new Date(maintenant + 2 * JOUR) },
        { ...base, prospectId: 'fictif-c', debutLe: new Date(maintenant - 3000), rappelLe: new Date(maintenant - JOUR) },
      ])
      .returning();
    await db.execute(sql`update appels set bilan = '{"rappel":"jeudi matin fictif"}'::jsonb where id = ${ancien!.id}`);
    const { lignes } = await pageAppels({ rappels: true, reels: true, recherche: '' }, { taille: 10, ordre: 'rappel', avant: tardif!.id });
    const nouveaux = lignes.filter((l) => [sansDate!.id, tardif!.id, ancien!.id].includes(l.id));
    expect(nouveaux.map((l) => l.id)).toEqual([ancien!.id, tardif!.id, sansDate!.id]);
    expect(nouveaux[0]).toMatchObject({ rappelTexte: 'jeudi matin fictif' });
  });

  it('une page porte société, étapes, libellé personnalisé et rendez-vous ; la transcription seulement en recherche', async () => {
    const { perso } = await jeu();
    const { lignes } = await pageAppels({ issue: `perso:${perso.id}` }, { taille: 10 });
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ libellePerso: 'Rappel fictif', rendezVous: false, nombreEtapes: expect.any(Number), transcription: null });
  });

  it('en recherche, la transcription revient décodée pour l’extrait', async () => {
    const { inseres } = await jeu();
    const tours = [{ role: 'agent', texte: 'Je vous envoie une plaquette fictive.', secondes: 3 }];
    await db.execute(sql`update appels set transcription = ${JSON.stringify(tours)}::jsonb where id = ${inseres[1]!.id}`);
    const { lignes } = await pageAppels({ recherche: 'plaquette' }, { taille: 10 });
    expect(lignes.map((l) => l.id)).toEqual([inseres[1]!.id]);
    expect(lignes[0]!.transcription).toEqual(tours);
  });

  it('comptes par jour de Paris et voisins d’un appel dans la liste filtrée', async () => {
    const { inseres, maintenant } = await jeu();
    const aujourdhui = PARIS.format(new Date(maintenant));
    expect(await comptesParJour({ reels: true }, [aujourdhui, 'pas-une-date'])).toEqual({ [aujourdhui]: 2 });
    expect(await comptesParJour({ issue: 'rendez-vous-pris' }, [aujourdhui])).toEqual({ [aujourdhui]: 2 });

    const [premier, deuxieme, troisieme] = inseres;
    expect(await voisinsAppel(deuxieme!.id, {})).toEqual({ precedent: premier!.id, suivant: troisieme!.id });
    // Filtrée par issue, la liste saute les appels d'une autre issue.
    expect(await voisinsAppel(premier!.id, { issue: 'rendez-vous-pris' })).toEqual({ precedent: null, suivant: deuxieme!.id });
    expect(await voisinsAppel(deuxieme!.id, { issue: 'rendez-vous-pris' })).toEqual({ precedent: premier!.id, suivant: null });
  });
});
