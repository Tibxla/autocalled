import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '@/db';
import { appels } from '@/db/schema';
import { creerScript } from '@/lib/entreprises';
import { listerAppels } from '@/lib/lecture';
import { entrepriseDeTest } from '../../../../../../../test/fixtures';
import { avecBaseDeTest } from '../../../../../../../test/outils';
import { POST } from './route';

avecBaseDeTest();

/** Un appel téléphone hors campagne (sans campagne, la route ne programme rien en tâche de fond). */
async function appelTelephone(valeurs: Partial<typeof appels.$inferInsert> = {}) {
  const e = await entrepriseDeTest();
  const { versionScriptId } = await creerScript(e.id, 'Découverte');
  const [appel] = await db
    .insert(appels)
    .values({ entrepriseId: e.id, prospectId: 'fictif', versionScriptId, ligne: 'bluetooth', numero: '+33639980001', ...valeurs })
    .returning();
  if (!appel) throw new Error('appel de test non créé');
  return appel;
}

function fin(id: string, corps: unknown) {
  const requete = new Request(`http://127.0.0.1/api/pont/appels/${id}/fin`, {
    method: 'POST',
    headers: { authorization: 'Bearer secret-de-test', 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  });
  return POST(requete, { params: Promise.resolve({ id }) });
}

describe('fin d’un appel téléphone', () => {
  it('sans conversation : terminé, issue et issue système « non-abouti », retrouvé par le filtre', async () => {
    const appel = await appelTelephone();
    const reponse = await fin(appel.id, { raison: 'pas de réponse', conversationId: null });
    expect(reponse.status).toBe(200);

    const [lu] = await db.select().from(appels).where(eq(appels.id, appel.id));
    expect(lu).toMatchObject({ statut: 'termine', issue: 'non-abouti', issueSysteme: 'non-abouti', bilan: null });
    expect(lu?.finLe).toBeInstanceOf(Date);
    expect((await listerAppels({ issue: 'non-abouti' }, 10)).map((l) => l.appel.id)).toEqual([appel.id]);
  });

  it('téléphone qui n’a pas composé : échec avec sa raison, sans issue', async () => {
    const appel = await appelTelephone();
    await fin(appel.id, { raison: 'composition impossible', conversationId: null });
    const [lu] = await db.select().from(appels).where(eq(appels.id, appel.id));
    expect(lu).toMatchObject({ statut: 'echec', issue: null, issueSysteme: null });
    expect(lu?.erreur).toMatch(/n’a pas composé/);
  });

  it('refuse une requête sans le secret du pont', async () => {
    const appel = await appelTelephone();
    const reponse = await POST(new Request('http://127.0.0.1/', { method: 'POST', body: '{}' }), { params: Promise.resolve({ id: appel.id }) });
    expect(reponse.status).toBe(401);
    const [lu] = await db.select().from(appels).where(eq(appels.id, appel.id));
    expect(lu?.statut).toBe('en-cours');
  });
});

describe('migration 0009 : rattrapage des appels non aboutis', () => {
  const migration = readFileSync(new URL('../../../../../../../drizzle/0009_issue-systeme-non-abouti.sql', import.meta.url), 'utf8');

  it('ne pose l’issue système que sur les appels clos par la route sans conversation', async () => {
    const cible = await appelTelephone({ statut: 'termine', issue: 'non-abouti', finLe: new Date() });
    const [avecConversation] = await db
      .insert(appels)
      .values({ ...sansId(cible), conversationId: 'conv-fictive', statut: 'termine', issue: 'non-abouti' })
      .returning();
    const [autreIssue] = await db.insert(appels).values({ ...sansId(cible), statut: 'termine', issue: 'perso:inconnue' }).returning();
    const [enEchec] = await db.insert(appels).values({ ...sansId(cible), statut: 'echec', issue: null }).returning();

    await db.execute(sql.raw(migration));

    const lus = new Map((await db.select().from(appels)).map((a) => [a.id, a.issueSysteme]));
    expect(lus.get(cible.id)).toBe('non-abouti');
    expect(lus.get(avecConversation!.id)).toBeNull();
    expect(lus.get(autreIssue!.id)).toBeNull();
    expect(lus.get(enEchec!.id)).toBeNull();
  });
});

function sansId(a: typeof appels.$inferSelect) {
  return { entrepriseId: a.entrepriseId, prospectId: a.prospectId, versionScriptId: a.versionScriptId, ligne: a.ligne, numero: a.numero };
}
