/**
 * Point d'entrée du serveur MCP, lancé par Claude Code d'après `.mcp.json` (à la racine du dépôt) :
 *
 *   cd apps/web && node --env-file=../../.env --conditions=react-server --import ./scripts/resolution.ts mcp/stdio.ts
 *
 * stdout porte le protocole : rien d'autre ne doit y écrire (les journaux partent sur stderr).
 */
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { creerServeur } from './serveur';

await creerServeur().connect(new StdioServerTransport());
