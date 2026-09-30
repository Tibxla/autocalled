import 'server-only';
import { exigerOperateur } from '@/lib/garde';
import { enTeteTelechargement } from '@/lib/vue-assistante';

/**
 * Réponses des téléchargements de la page Assistante. Le proxy les réserve déjà à l'opérateur ; chaque route le
 * revérifie, comme une action serveur, et répond 403 plutôt que par une erreur.
 */

const TEXTE = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };

export async function operateurOuRefus(): Promise<Response | null> {
  try {
    await exigerOperateur();
    return null;
  } catch {
    return new Response('Accès réservé à l’opérateur.', { status: 403, headers: TEXTE });
  }
}

export function refus(message: string, status = 404): Response {
  return new Response(message, { status, headers: TEXTE });
}

export function fichier(contenu: string, nom: string, type: string): Response {
  return new Response(contenu, {
    headers: { 'content-type': `${type}; charset=utf-8`, 'content-disposition': enTeteTelechargement(nom), 'cache-control': 'no-store' },
  });
}
