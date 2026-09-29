/**
 * Niveaux des deux voix d'un appel téléphone, relayés par le fil du pont à partir du décroché : un relevé toutes
 * les `pasMs` (50 ms), valeur sur [0, 1] par voix, jamais l'audio. Format côté pont : docstring de
 * apps/pont/pont/service.py. Un pont ancien n'en envoie pas : la bande garde alors sa piste de parole.
 *
 * Les lots arrivent par paquets d'un ou quelques relevés, avec les à-coups du réseau. Le tampon les replace sur
 * l'horloge du navigateur (décalage estimé au transit le plus court observé) et les rejoue avec un léger retard,
 * sur une grille de cases de `pasMs` : l'onde défile au rythme du temps, sans saccade, et s'aplatit si le fil
 * se tait.
 */

export interface LotNiveaux {
  /** Heure du pont du dernier relevé du lot, en ms depuis l'epoch ; les précédents le suivent de `pasMs` en `pasMs`. */
  t: number;
  pasMs: number;
  mina: number[];
  prospect: number[];
}

const borne = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Un message `niveaux` du fil, validé ; null pour tout autre message ou un lot mal formé. */
export function lotDeNiveaux(e: unknown): LotNiveaux | null {
  if (!e || typeof e !== 'object') return null;
  const m = e as Record<string, unknown>;
  if (m.type !== 'niveaux' || typeof m.t !== 'number' || !Number.isFinite(m.t)) return null;
  if (!Array.isArray(m.mina) || !Array.isArray(m.prospect) || m.mina.length !== m.prospect.length || m.mina.length === 0) return null;
  const pasMs = typeof m.pasMs === 'number' && m.pasMs >= 10 && m.pasMs <= 1000 ? m.pasMs : 50;
  return { t: m.t, pasMs, mina: m.mina.map(borne), prospect: m.prospect.map(borne) };
}

/** Retard de lecture : absorbe les à-coups du fil (un lot tous les dixièmes de seconde, plus le réseau). */
const RETARD_MS = 250;
/** Le transit le plus court peut s'allonger durablement (réseau, horloges qui dérivent) : on le laisse remonter. */
const DERIVE_PAR_LOT_MS = 2;
const GARDES = 1200;

export interface VueNiveaux {
  /** Du plus ancien au plus récent, une valeur par case de `pasMs` ; 0 là où rien n'est arrivé. */
  mina: number[];
  prospect: number[];
  /** Avancée dans la case la plus récente, de 0 à 1 : de quoi faire glisser l'onde entre deux relevés. */
  glisse: number;
}

export class TamponNiveaux {
  private temps: number[] = [];
  private mina: number[] = [];
  private prospect: number[] = [];
  private decalage: number | null = null;
  private pas = 50;

  constructor(private readonly retardMs = RETARD_MS) {}

  /** `recuLe` : Date.now() à la réception du lot. */
  ajouter(lot: LotNiveaux, recuLe: number): void {
    const ecart = recuLe - lot.t;
    this.decalage = this.decalage === null ? ecart : Math.min(this.decalage + DERIVE_PAR_LOT_MS, ecart);
    this.pas = lot.pasMs;
    const n = lot.mina.length;
    for (let i = 0; i < n; i++) {
      const t = lot.t - (n - 1 - i) * lot.pasMs + this.decalage;
      // Un relevé plus ancien que le dernier gardé (décalage réajusté entre deux lots) : il rejoint sa case.
      let j = this.temps.length;
      while (j > 0 && this.temps[j - 1]! > t) j--;
      this.temps.splice(j, 0, t);
      this.mina.splice(j, 0, lot.mina[i]!);
      this.prospect.splice(j, 0, lot.prospect[i]!);
    }
    const trop = this.temps.length - GARDES;
    if (trop > 0) {
      this.temps.splice(0, trop);
      this.mina.splice(0, trop);
      this.prospect.splice(0, trop);
    }
  }

  /** Les `cases` dernières cases à afficher à `maintenant` (Date.now() du navigateur). */
  vue(maintenant: number, cases: number): VueNiveaux {
    const mina = new Array<number>(Math.max(0, cases)).fill(0);
    const prospect = new Array<number>(Math.max(0, cases)).fill(0);
    const position = (maintenant - this.retardMs) / this.pas;
    const derniere = Math.floor(position);
    const premiere = derniere - cases + 1;
    for (let i = this.temps.length - 1; i >= 0; i--) {
      const c = Math.round(this.temps[i]! / this.pas);
      if (c < premiere) break;
      if (c > derniere) continue;
      const k = c - premiere;
      mina[k] = Math.max(mina[k]!, this.mina[i]!);
      prospect[k] = Math.max(prospect[k]!, this.prospect[i]!);
    }
    return { mina, prospect, glisse: position - derniere };
  }
}
