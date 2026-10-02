import 'server-only';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { campagnes, entreprises } from '@/db/schema';
import { commanderPont } from './pont';

/**
 * Ce que la barre du haut sait de la ligne, relu toutes les 3 s par chaque onglet ouvert (GET /ligne/etat) :
 * l'état du pont, l'heure du décroché (le chrono survit au rechargement), le plafond et l'heure du prochain
 * appel possible, la campagne qui tourne ou attend. Rien d'autre : ni numéro, ni prospect, ni entrées de
 * campagne (comptées en base).
 */

export interface CampagneBarre {
  id: string;
  entreprise: string;
  statut: 'en-cours' | 'en-pause';
  traites: number;
  total: number;
}

export type EtatBarre = {
  pont: boolean;
  connecte: boolean;
  appelEnCours: boolean;
  appelId: string | null;
  /** L'appel sur la ligne est entrant : un prospect qui rappelle (avec `appelId`), ou un numéro inconnu qui sonne (sans). */
  entrant: boolean;
  /** Heure du décroché de l'appel en cours (ms depuis l'epoch), donnée par le pont ; null avant ou s'il ne la donne pas. */
  decrocheLe: number | null;
  /** Plafond atteint : `jusqua` est l'heure du prochain appel possible (ms), null si le pont ne la donne pas. */
  plafond: { jusqua: number | null } | null;
  campagne: CampagneBarre | null;
};

const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** La campagne en cours, sinon la suspendue la plus récente ; ses comptes sont faits en base. */
export async function campagneOuverte(): Promise<CampagneBarre | null> {
  const [c] = await db
    .select({
      id: campagnes.id,
      entreprise: entreprises.nom,
      statut: campagnes.statut,
      total: sql<number>`jsonb_array_length(${campagnes.entrees})`.mapWith(Number),
      traites: sql<number>`(select count(*) from jsonb_array_elements(${campagnes.entrees}) e where e->>'etat' in ('appelee', 'en-analyse', 'sautee', 'retiree'))`.mapWith(
        Number,
      ),
    })
    .from(campagnes)
    .innerJoin(entreprises, eq(entreprises.id, campagnes.entrepriseId))
    .where(inArray(campagnes.statut, ['en-cours', 'en-pause']))
    .orderBy(sql`${campagnes.statut} = 'en-cours' desc`, desc(campagnes.creeLe))
    .limit(1);
  if (!c || (c.statut !== 'en-cours' && c.statut !== 'en-pause')) return null;
  return { ...c, statut: c.statut };
}

export async function etatPourLaBarre(): Promise<EtatBarre> {
  const [pont, campagne] = await Promise.all([commanderPont('/etat'), campagneOuverte()]);
  if (!pont.ok) return { pont: false, connecte: false, appelEnCours: false, appelId: null, entrant: false, decrocheLe: null, plafond: null, campagne };
  const c = pont.corps;
  const appelEnCours = Boolean(c.appelEnCours);
  const appelId = typeof c.appelId === 'string' ? c.appelId : null;
  return {
    pont: true,
    connecte: Boolean(c.connecte),
    appelEnCours,
    appelId,
    // Un entrant qui sonne pendant un appel sortant reste en attente : la ligne suit le sortant.
    entrant: c.sens === 'entrant' || (appelId === null && Boolean(c.entrantEnCours)),
    decrocheLe: appelEnCours ? nombre(c.decrocheLe) : null,
    plafond: typeof c.plafond === 'string' ? { jusqua: nombre(c.plafondJusqua) } : null,
    campagne,
  };
}
