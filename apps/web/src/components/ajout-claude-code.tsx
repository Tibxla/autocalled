import { dateCourte } from './format-appel';

/**
 * « Numéro ajouté par Claude Code le 29/09 à 14:32. » : le consentement de ce numéro est entré par le serveur
 * MCP (ADR 0009, `ajoutParMcp`). Une information, pas une alerte : l'opérateur la relit avant d'appeler, un
 * numéro glissé dans un import par une consigne injectée se voit ainsi.
 */
export function AjoutClaudeCode({ le }: { le: Date | string }) {
  const [jour, heure] = dateCourte(le).split(' ');
  return (
    <>
      Numéro ajouté par Claude Code le <span className="font-mono">{jour}</span> à <span className="font-mono">{heure}</span>.
    </>
  );
}
