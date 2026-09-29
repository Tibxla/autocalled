import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  createRequestStateCodec,
  type McpServer,
  type RequestStateCodec,
  type ServerContext,
  inputRequired,
  inputResponse,
} from '@modelcontextprotocol/server';
import { type Issue, noterConfirmation, refus } from './outil';

/**
 * Confirmation humaine des gestes irréversibles ou dits au prospect (ADR 0009, ADR 0010) : faire sonner le
 * téléphone, révoquer un numéro, effacer une personne, supprimer une entreprise, renvoyer une invitation, desserrer les
 * plafonds de la ligne, pousser la configuration de l'assistante, changer son nom ou son premier message.
 *
 * Le modèle peut être manipulé par ce qu'il lit (une transcription d'appel est la parole d'un tiers, ADR 0005) :
 * la garde est donc une question posée à l'opérateur par l'élicitation MCP, que Claude Code lui affiche et à
 * laquelle le modèle ne peut pas répondre. Le message est rédigé ici, depuis la base, les fichiers et ElevenLabs,
 * jamais à partir d'un texte fourni par le modèle. Sans élicitation (client qui ne la déclare pas, `claude -p`), le
 * geste est refusé.
 *
 * L'outil rend `inputRequired(...)`, la forme du SDK v2 pour les deux révisions du protocole : en 2025 (celle que
 * sert le transport stdio), le SDK pose lui-même la question au client puis rappelle l'outil ; en 2026-07-28, c'est
 * le client qui rappelle l'outil avec la réponse. L'outil repasse donc depuis le début : il revérifie tout, et
 * n'accepte la réponse que si les faits qui portent la décision (`cle` : prospect, numéro, valeurs cibles…) n'ont
 * pas bougé depuis la question. Le message, lui, peut changer sans invalider l'accord : il rappelle l'heure, et
 * l'opérateur peut mettre plus d'une minute à répondre.
 *
 * L'empreinte de ces faits fait l'aller-retour par le client (`requestState`) : elle est signée (HMAC, clé tirée au
 * démarrage du serveur, dix minutes de validité) et porte un nonce à usage unique. Un client ne peut donc ni forger
 * un accord (le SDK rejette un état mal signé avant l'outil, sans journal), ni rejouer un accord déjà servi.
 */

const CLE = 'confirmation';

/** Durée de validité d'une question : au-delà, elle est reposée. */
export const DUREE_QUESTION_S = 600;

/** Ce qui fait l'aller-retour, signé : l'empreinte des faits et un nonce. */
export interface EtatConfirmation {
  e: string;
  n: string;
}

/** La clé de signature et les nonces déjà servis d'un serveur. Un seul processus stdio sert la question et sa réponse. */
export interface Gardien {
  codec: RequestStateCodec<EtatConfirmation>;
  /** Consomme un nonce : vrai la première fois seulement, tant qu'il n'a pas expiré. */
  consommer(nonce: string): boolean;
}

export function creerGardien(cle: Uint8Array = randomBytes(32)): Gardien {
  const codec = createRequestStateCodec<EtatConfirmation>({ key: cle, ttlSeconds: DUREE_QUESTION_S });
  const servis = new Map<string, number>();
  return {
    codec,
    consommer(nonce) {
      const maintenant = Date.now();
      for (const [n, expire] of servis) if (expire < maintenant) servis.delete(n);
      if (servis.has(nonce)) return false;
      servis.set(nonce, maintenant + DUREE_QUESTION_S * 1000);
      return true;
    },
  };
}

const gardiens = new WeakMap<object, Gardien>();

/** Lie un gardien au serveur : `confirmer` le retrouve à partir du serveur que reçoit chaque outil. */
export function associerGardien(serveur: McpServer, gardien: Gardien): void {
  gardiens.set(serveur, gardien);
}

function gardienDe(serveur: McpServer): Gardien {
  const g = gardiens.get(serveur);
  if (!g) throw new Error('serveur MCP sans gardien de confirmation : passer par creerServeur');
  return g;
}

export type Garde = { etat: 'acceptee' } | { etat: 'refusee' } | { etat: 'indisponible' } | { etat: 'a-demander'; issue: Issue };

/**
 * Un champ de la base interpolé dans une question (nom, société, libellé…). Ces champs peuvent avoir été écrits par
 * un modèle manipulé (une fiche importée par le MCP) : sauts de ligne et caractères de contrôle deviennent des
 * espaces, et le texte est coupé, pour qu'aucun n'imite une autre question ni ne repousse hors de l'écran les faits
 * qui portent la décision.
 */
export function champ(texte: string | null | undefined, max = 60): string {
  const ligne = (texte ?? '').replace(/[\p{Cc}\p{Cf}\u2028\u2029\s]+/gu, ' ').trim();
  return ligne.length > max ? `${ligne.slice(0, max - 1).trimEnd()}…` : ligne;
}

/** Un champ cité entre guillemets dans une question, ou « (vide) ». */
export const citation = (texte: string | null | undefined, max = 60) => {
  const c = champ(texte, max);
  return c ? `« ${c} »` : '(vide)';
};

function formulaireAccepte(serveur: McpServer): boolean {
  const e = serveur.server.getClientCapabilities()?.elicitation;
  // Une capacité vide vaut « formulaire » (compatibilité de la spécification) ; `url` seul ne suffit pas.
  return e !== undefined && (e.form !== undefined || e.url === undefined);
}

const estEtat = (v: unknown): v is EtatConfirmation =>
  typeof v === 'object' && v !== null && typeof (v as EtatConfirmation).e === 'string' && typeof (v as EtatConfirmation).n === 'string';

export const empreinteDe = (cle: readonly unknown[]) => createHash('sha256').update(JSON.stringify(cle)).digest('hex');

export async function confirmer(serveur: McpServer, ctx: ServerContext, message: string, cle: readonly unknown[]): Promise<Garde> {
  const gardien = gardienDe(serveur);
  const empreinte = empreinteDe(cle);
  const reponse = inputResponse(ctx.mcpReq.inputResponses, CLE);
  // Décodé et vérifié par le SDK (`requestState.verify`) avant l'outil ; une chaîne brute n'est jamais un accord.
  const etat = ctx.mcpReq.requestState<unknown>();
  if (reponse.kind !== 'missing' && estEtat(etat) && etat.e === empreinte && gardien.consommer(etat.n)) {
    const accord = reponse.kind === 'elicit' && reponse.action === 'accept' && reponse.content?.confirme === true;
    noterConfirmation(ctx, accord ? 'acceptee' : 'refusee');
    return { etat: accord ? 'acceptee' : 'refusee' };
  }
  if (!formulaireAccepte(serveur)) {
    noterConfirmation(ctx, 'indisponible');
    return { etat: 'indisponible' };
  }
  return {
    etat: 'a-demander',
    issue: {
      question: message,
      demande: inputRequired({
        requestState: await gardien.codec.mint({ e: empreinte, n: randomUUID() }),
        inputRequests: {
          [CLE]: inputRequired.elicit({
            message,
            requestedSchema: {
              type: 'object',
              properties: { confirme: { type: 'boolean', title: 'Je confirme', description: 'Coche pour autoriser ce geste. Sinon, refuse.' } },
              required: ['confirme'],
            },
          }),
        },
      }),
    },
  };
}

/** Refus d'un geste non confirmé, avec la raison à rapporter à l'opérateur. */
export function refusDeConfirmation(garde: { etat: 'refusee' | 'indisponible' }): Issue {
  return garde.etat === 'refusee'
    ? refus('L’opérateur n’a pas confirmé : rien n’a été fait.', 'refusee')
    : refus(
        'Ce geste demande la confirmation de l’opérateur, et ce client MCP ne sait pas la demander (élicitation absente, ou mode non interactif) : à faire depuis l’interface.',
        'indisponible',
      );
}

/** Heure de Paris, rappelée dans les confirmations d'appel : aucune règle d'heure ne protège un appel, c'est à l'opérateur d'en juger. */
export const heureDeParis = () => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date());
