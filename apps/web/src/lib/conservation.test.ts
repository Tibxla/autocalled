import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bilan } from '@autocalled/domain';
import { asc, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels, journalMcp, objections, oppositions, rendezVous } from '@/db/schema';
import { clientDeTest } from '../../test/client-mcp';
import { entrepriseDeTest, fiche } from '../../test/fixtures';
import { avecBaseDeTest } from '../../test/outils';
import { APPEL_PURGE, preparerReanalyse } from './appels';
import { compteRendu, dureeConservationMois, inventairePurge, limiteConservation, mentionPurge, purger } from './conservation';
import { creerScript } from './entreprises';
import { analyseEntreprise } from './lecture';
import { importerFiches } from './prospects';

avecBaseDeTest();

let dossier: string;
beforeEach(async () => {
  dossier = await mkdtemp(join(tmpdir(), 'autocalled-conservation-'));
  process.env.DOSSIER_DONNEES = dossier;
});
afterEach(async () => {
  delete process.env.DOSSIER_DONNEES;
  delete process.env.DUREE_CONSERVATION_MOIS;
  await rm(dossier, { recursive: true, force: true });
});

const MOIS = 60 * 60 * 1000 * 24 * 31;

function bilanComplet(objectionId: string): Bilan {
  return {
    issue: 'rappel-convenu',
    etapeAtteinte: 2,
    objections: [
      { objectionId, libelle: 'Déjà équipé', levee: false, tempsBloquant: 'argumenter', citation: 'on a déjà un prestataire' },
      { objectionId: null, libelle: 'Pas le temps en saison', levee: true, tempsBloquant: null, citation: 'je suis en plein ménage' },
    ],
    resume: 'Julie Fictive gère un gîte et demande un rappel jeudi matin.',
    pointsForts: ['Question ouverte sur la saison.'],
    pointsFaibles: ['Argument trop long.'],
    rappel: 'jeudi matin',
    rappelLe: { date: '2025-01-09', heure: null, moment: 'matin' },
  };
}

/**
 * Un appel ancien (treize mois, bilan complet, rendez-vous et fichiers), un ancien en échec dont l'erreur cite le
 * prospect, un ancien encore en analyse, un récent, deux lignes de journal et une opposition ancienne.
 */
async function monde(maintenant = new Date()) {
  const e = await entrepriseDeTest();
  await importerFiches(e.id, [fiche('julie', 'Julie Fictive', '06 39 98 00 01'), fiche('marc', 'Marc Fictif', '06 39 98 00 02')]);
  const { versionScriptId } = await creerScript(e.id, 'Découverte');
  const [objection] = await db.insert(objections).values({ entrepriseId: e.id, libelle: 'Déjà un prestataire' }).returning();
  const ancien = new Date(maintenant.getTime() - 13 * MOIS);
  const recent = new Date(maintenant.getTime() - MOIS);
  const tours = [
    { role: 'agent' as const, texte: 'Bonjour, c’est Mina.', secondes: 0 },
    { role: 'prospect' as const, texte: 'Oui, on a déjà un prestataire, et je suis en plein ménage.', secondes: 3 },
  ];
  const commun = { entrepriseId: e.id, versionScriptId, versionAgent: 'agtvrsn_fictive1', assistanteNom: 'Mina' };
  const [vieux] = await db
    .insert(appels)
    .values({
      ...commun,
      prospectId: 'julie',
      ligne: 'bluetooth',
      numero: '+33639980001',
      statut: 'termine',
      conversationId: 'conv_fictive_ancienne',
      debutLe: ancien,
      finLe: new Date(ancien.getTime() + 95_000),
      dureeSecondes: 95,
      transcription: tours,
      bilan: bilanComplet(objection!.id),
      issue: 'rappel-convenu',
      issueSysteme: 'rappel-convenu',
      rappelLe: new Date('2025-01-09T08:00:00Z'),
      versionAnalyseur: 'analyseur-test',
    })
    .returning();
  await db.update(appels).set({ audio: `enregistrements/${vieux!.id}.mp3` }).where(eq(appels.id, vieux!.id));
  const [echec] = await db
    .insert(appels)
    .values({
      ...commun,
      prospectId: 'marc',
      ligne: 'bluetooth',
      numero: '+33639980002',
      statut: 'echec',
      conversationId: 'conv_fictive_echec',
      debutLe: new Date(ancien.getTime() + 1000),
      transcription: tours,
      erreur: 'bilan refusé après deux essais : citation absente des paroles du prospect : « je suis en plein ménage »',
    })
    .returning();
  const [enAnalyse] = await db
    .insert(appels)
    .values({ ...commun, prospectId: 'marc', ligne: 'simulation', numero: '+33639980002', statut: 'traitement', debutLe: ancien, traitementLe: new Date(maintenant.getTime() - 60_000), transcription: tours })
    .returning();
  const [jeune] = await db
    .insert(appels)
    .values({
      ...commun,
      prospectId: 'julie',
      ligne: 'bluetooth',
      numero: '+33639980001',
      statut: 'termine',
      debutLe: recent,
      dureeSecondes: 60,
      transcription: tours,
      bilan: { ...bilanComplet(objection!.id), issue: 'refus', rappel: null, rappelLe: null },
      issue: 'refus',
      issueSysteme: 'refus',
    })
    .returning();
  await db.update(appels).set({ audio: `enregistrements/${jeune!.id}.mp3` }).where(eq(appels.id, jeune!.id));
  await db.insert(rendezVous).values({ appelId: vieux!.id, debut: ancien, fin: new Date(ancien.getTime() + 1_800_000), statut: 'cree', email: 'julie@exemple.test', lienVisio: 'https://visio.exemple.test/abc' });

  await mkdir(join(dossier, 'enregistrements'), { recursive: true });
  await mkdir(join(dossier, 'pont'), { recursive: true });
  const fichiers = {
    vieux: [`enregistrements/${vieux!.id}.mp3`, `pont/${vieux!.id}.wav`, `pont/${vieux!.id}.log`],
    echec: [`pont/${echec!.id}.wav`, `pont/${echec!.id}.log`],
    jeune: [`enregistrements/${jeune!.id}.mp3`, `pont/${jeune!.id}.wav`, `pont/${jeune!.id}.log`],
  };
  for (const f of Object.values(fichiers).flat()) await writeFile(join(dossier, f), 'son fictif');

  await db.insert(journalMcp).values([
    { le: ancien, outil: 'lire_appel', arguments: { appelId: vieux!.id }, resultat: 'ok' },
    { le: recent, outil: 'lire_appel', arguments: { appelId: jeune!.id }, resultat: 'ok' },
  ]);
  await db.insert(oppositions).values({ empreinte: 'empreinte-fictive', le: new Date(maintenant.getTime() - 30 * MOIS), par: 'interface', bilan: { appels: 1 } });
  return { e, objection: objection!, vieux: vieux!, echec: echec!, enAnalyse: enAnalyse!, jeune: jeune!, fichiers, maintenant };
}

const lireAppel = async (id: string) => (await db.select().from(appels).where(eq(appels.id, id)))[0]!;
const toutesLesLignes = async () => ({
  appels: await db.select().from(appels).orderBy(asc(appels.id)),
  rendezVous: await db.select().from(rendezVous),
  journal: await db.select().from(journalMcp).orderBy(asc(journalMcp.le)),
  oppositions: await db.select().from(oppositions),
});
const present = (relatif: string) => existsSync(join(dossier, relatif));

describe('durée de conservation', () => {
  it('lit DUREE_CONSERVATION_MOIS : 12 par défaut, 1 au moins, refuse une valeur illisible', () => {
    expect(dureeConservationMois(undefined)).toBe(12);
    expect(dureeConservationMois(' ')).toBe(12);
    expect(dureeConservationMois('24')).toBe(24);
    expect(dureeConservationMois('0')).toBe(1);
    expect(dureeConservationMois('-3')).toBe(1);
    expect(() => dureeConservationMois('12m')).toThrow(/nombre entier/);
    expect(() => dureeConservationMois('1.5')).toThrow(/nombre entier/);
  });

  it('compte en mois de calendrier, le 31 ramené au dernier jour du mois', () => {
    expect(limiteConservation(new Date('2026-09-29T10:00:00Z'), 12).toISOString()).toBe('2025-09-29T10:00:00.000Z');
    expect(limiteConservation(new Date('2026-03-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
  });

  it('dit la durée réglée dans la mention d’un appel purgé', () => {
    process.env.DUREE_CONSERVATION_MOIS = '18';
    expect(mentionPurge()).toBe('Bilan purgé après 18 mois : détail effacé, issue et étapes conservées.');
    process.env.DUREE_CONSERVATION_MOIS = 'n’importe quoi';
    expect(mentionPurge(false)).toBe('Appel purgé après la durée de conservation : enregistrement, transcription et détail effacés.');
  });
});

describe('purger', () => {
  it('efface fichiers, transcription et texte du bilan d’un appel ancien, garde les champs structurés', async () => {
    const m = await monde();
    const avant = await lireAppel(m.vieux.id);

    const r = await purger(m.maintenant);

    const apres = await lireAppel(m.vieux.id);
    for (const f of m.fichiers.vieux) expect(present(f)).toBe(false);
    expect(apres.transcription).toBeNull();
    expect(apres.audio).toBeNull();
    expect(apres.purgeLe).toEqual(m.maintenant);
    expect(apres.bilan).toEqual({
      purge: true,
      issue: 'rappel-convenu',
      etapeAtteinte: 2,
      objections: [
        { objectionId: m.objection.id, levee: false, tempsBloquant: 'argumenter' },
        { objectionId: null, levee: true, tempsBloquant: null },
      ],
      rappelLe: { date: '2025-01-09', heure: null, moment: 'matin' },
    });
    expect(JSON.stringify(apres.bilan)).not.toMatch(/Julie|prestataire|ménage|jeudi|Question|Argument|Déjà/);
    // Tout le reste de la ligne est intact : issue, étape, durée, dates, ligne, versions, numéro, rappel daté.
    const structure = (a: typeof avant) => ({ ...a, transcription: 'effacée', audio: 'effacé', bilan: 'purgé', purgeLe: 'posée' });
    expect(structure(apres)).toEqual(structure(avant));

    const [rdv] = await db.select().from(rendezVous).where(eq(rendezVous.appelId, m.vieux.id));
    expect(rdv!.email).toBeNull();
    expect(rdv!.debut).toEqual(new Date(avant.debutLe));

    const echec = await lireAppel(m.echec.id);
    expect(echec.erreur).toBeNull();
    expect(echec.transcription).toBeNull();
    expect(echec.purgeLe).toEqual(m.maintenant);
    expect(echec.statut).toBe('echec');
    for (const f of m.fichiers.echec) expect(present(f)).toBe(false);

    expect(r).toMatchObject({ dureeMois: 12, appels: 2, transcriptions: 2, bilans: 1, erreurs: 1, invitations: 1, fichiers: 5, reportes: 1, journal: 1, fichiersEnEchec: [] });
  });

  it('laisse intact un appel récent et reporte un appel ancien encore en analyse', async () => {
    const m = await monde();
    const [jeuneAvant, analyseAvant] = [await lireAppel(m.jeune.id), await lireAppel(m.enAnalyse.id)];

    await purger(m.maintenant);

    expect(await lireAppel(m.jeune.id)).toEqual(jeuneAvant);
    expect(await lireAppel(m.enAnalyse.id)).toEqual(analyseAvant);
    for (const f of m.fichiers.jeune) expect(present(f)).toBe(true);
  });

  it('est idempotente : un second passage ne change rien', async () => {
    const m = await monde();
    await purger(m.maintenant);
    const une = await toutesLesLignes();

    const r = await purger(new Date(m.maintenant.getTime() + 60_000));

    expect(await toutesLesLignes()).toEqual(une);
    expect(r).toMatchObject({ appels: 0, transcriptions: 0, bilans: 0, fichiers: 0, journal: 0, fichiersEnEchec: [] });
  });

  it('supprime les lignes du journal MCP plus vieilles que la durée, et jamais la liste d’opposition', async () => {
    const m = await monde();
    const oppositionsAvant = await db.select().from(oppositions);

    await purger(m.maintenant);

    const journal = await db.select().from(journalMcp);
    expect(journal).toHaveLength(1);
    expect(journal[0]!.arguments).toEqual({ appelId: m.jeune.id });
    expect(await db.select().from(oppositions)).toEqual(oppositionsAvant);
  });

  it('garde l’analyse des versions identique avant et après la purge', async () => {
    const m = await monde();
    const chiffres = async () => {
      const a = await analyseEntreprise(m.e.id, true);
      return { parVersion: a.parVersion, parVersionAssistante: a.parVersionAssistante, parObjection: a.parObjection };
    };
    const avant = await chiffres();

    await purger(m.maintenant);

    expect(avant.parObjection.length).toBeGreaterThan(0);
    expect(await chiffres()).toEqual(avant);
  });

  it('laisse entier un appel dont un fichier résiste, et le reprend au passage suivant', async () => {
    const m = await monde();
    // Un dossier à la place du son du pont : unlink le refuse.
    const bloque = `pont/${m.vieux.id}.wav`;
    await rm(join(dossier, bloque));
    await mkdir(join(dossier, bloque, 'dedans'), { recursive: true });

    const r = await purger(m.maintenant);

    expect(r.fichiersEnEchec).toEqual([bloque]);
    const vieux = await lireAppel(m.vieux.id);
    expect(vieux.purgeLe).toBeNull();
    expect(vieux.transcription).not.toBeNull();
    expect(compteRendu(r, false)).toContain(bloque);

    await rm(join(dossier, bloque), { recursive: true });
    const reprise = await purger(m.maintenant);
    expect(reprise.appels).toBe(1);
    expect((await lireAppel(m.vieux.id)).purgeLe).not.toBeNull();
  });

  it('refuse de réanalyser un appel purgé (la conversation serait rapatriée de nouveau)', async () => {
    const m = await monde();
    await purger(m.maintenant);

    expect(await preparerReanalyse(m.vieux.id)).toEqual({ ok: false, raison: APPEL_PURGE });
    expect((await lireAppel(m.vieux.id)).statut).toBe('termine');
  });
});

describe('essai de purge', () => {
  it('compte ce qui partirait sans rien écrire ni supprimer, même dans une transaction en lecture seule', async () => {
    const m = await monde();
    const avant = await toutesLesLignes();

    const inventaire = await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      return inventairePurge(m.maintenant, { lecteur: tx });
    });

    expect(inventaire).toMatchObject({ dureeMois: 12, appels: 2, transcriptions: 2, bilans: 1, erreurs: 1, invitations: 1, fichiers: 5, reportes: 1, journal: 1 });
    expect(await toutesLesLignes()).toEqual(avant);
    for (const f of Object.values(m.fichiers).flat()) expect(present(f)).toBe(true);
    // Ce que la purge fait ensuite est exactement ce que l'essai annonçait.
    expect(await purger(m.maintenant)).toMatchObject({ appels: inventaire.appels, fichiers: inventaire.fichiers, journal: inventaire.journal });
  });

  it('écrit un compte rendu sans donnée personnelle', async () => {
    const m = await monde();
    const texte = [compteRendu(await inventairePurge(m.maintenant), true), compteRendu(await purger(m.maintenant), false)].join('\n');

    expect(texte).toContain('Essai de purge (rien n’est supprimé) : conservation 12 mois');
    expect(texte).toContain('2 appels purgés');
    expect(texte).not.toMatch(/Julie|Marc|39 98|39980|exemple\.test|julie|marc|conv_fictive/);
  });
});

describe('lecture d’un appel purgé', () => {
  it('lire_appel (MCP) ne rend ni texte ni bloc de tiers, et dit que le bilan est purgé', async () => {
    const m = await monde();
    await purger(m.maintenant);
    const c = await clientDeTest();
    try {
      const r = await c.appeler('lire_appel', { appelId: m.vieux.id, transcription: true });

      expect(r.erreur).toBe(false);
      expect(r.blocs).toHaveLength(1);
      expect(r.json).toMatchObject({
        purgeLe: m.maintenant.toISOString(),
        transcriptionDisponible: false,
        audioDisponible: false,
        bilan: {
          issue: 'Rappel convenu',
          etapeAtteinte: 2,
          purge: 'Bilan purgé après 12 mois : détail effacé, issue et étapes conservées.',
          objections: [
            { objectionId: m.objection.id, libelle: 'Déjà un prestataire', nouvelle: false, levee: false, tempsBloquant: 'argumenter' },
            { objectionId: null, libelle: null, nouvelle: true, levee: true, tempsBloquant: null },
          ],
        },
      });
      expect(r.texte).not.toMatch(/ménage|jeudi matin|Julie Fictive gère/);
    } finally {
      await c.fermer();
    }
  });
});
