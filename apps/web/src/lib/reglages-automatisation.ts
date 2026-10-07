import 'server-only';
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { reglagesAutomatisation } from '@/db/schema';

type Lecteur = Pick<typeof db, 'select'>;
type Transaction = Pick<typeof db, 'select' | 'execute' | 'insert'>;

function empreinte(valeur: Record<string, unknown>, revision: Date | null): string {
  return createHash('sha256').update(JSON.stringify([valeur, revision?.toISOString() ?? null])).digest('hex');
}

export async function lireReglage<T extends Record<string, unknown>>(cle: string, defaut: T, lecteur: Lecteur = db): Promise<{ valeur: T; empreinte: string }> {
  const [ligne] = await lecteur.select().from(reglagesAutomatisation).where(eq(reglagesAutomatisation.cle, cle));
  const valeur = (ligne?.valeur ?? defaut) as T;
  return { valeur, empreinte: empreinte(valeur, ligne?.modifieLe ?? null) };
}

export async function enregistrerReglage(cle: string, valeur: Record<string, unknown>, empreinteConnue: string, defaut: Record<string, unknown>, transaction?: Transaction) {
  const enregistrer = async (tx: Transaction) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'autocalled:reglage:' + cle}))`);
    const actuelle = await lireReglage(cle, defaut, tx);
    if (actuelle.empreinte !== empreinteConnue) return { ok: false as const, raison: 'Ces réglages ont changé depuis leur lecture. Recharge-les avant d’enregistrer.' };
    const modifieLe = new Date();
    const [ecrit] = await tx.insert(reglagesAutomatisation).values({ cle, valeur, modifieLe }).onConflictDoUpdate({ target: reglagesAutomatisation.cle, set: { valeur, modifieLe } }).returning();
    if (!ecrit) throw new Error('Le réglage n’a pas été enregistré.');
    return { ok: true as const, empreinte: empreinte(ecrit.valeur, ecrit.modifieLe) };
  };
  return transaction ? enregistrer(transaction) : db.transaction(enregistrer);
}
