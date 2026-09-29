/**
 * Synchronise la configuration de l'assistante entre le dépôt et ElevenLabs.
 *
 *   node --env-file=.env scripts/agent.ts create   crée l'agent et affiche son identifiant
 *   node --env-file=.env scripts/agent.ts pull     rapatrie la configuration distante dans agent/ (refuse d'écraser
 *                                                   des modifications locales non poussées, sauf --force)
 *   node --env-file=.env scripts/agent.ts push     montre la différence avec ElevenLabs, demande confirmation, puis
 *                                                   envoie agent/ (--oui saute la question ; sans terminal, --oui est exigé)
 *   node --env-file=.env scripts/agent.ts status   dit si le dépôt et ElevenLabs divergent, et en quoi
 *
 * `push` refuse d'écraser une configuration distante modifiée depuis le dernier `pull` ou `push` :
 * agent/remote.lock.json garde la dernière configuration distante connue. La logique vit dans
 * packages/agent, que le serveur MCP partage : un seul verrou, une seule empreinte.
 */
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  avecPrompt,
  CHEMIN_PROMPT,
  clientElevenLabs,
  difference,
  distanteModifieeDepuis,
  empreinte,
  enregistrerDistante,
  lireLocal,
  pousser,
  rapatrier,
  separerPrompt,
  versionDe,
} from '../packages/agent/src/index.ts';

const DOSSIER = fileURLToPath(new URL('../agent/', import.meta.url));

function exiger(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`variable d'environnement manquante : ${nom}`);
  return valeur;
}

function client() {
  return clientElevenLabs({ cle: exiger('ELEVENLABS_API_KEY'), agentId: process.env.ELEVENLABS_AGENT_ID });
}

/** La différence de la configuration distante vers le dépôt : ce qu'un push changerait. */
async function differenceAvecDistante() {
  const locale = await lireLocal(DOSSIER);
  const distante = await client().lire();
  const d = difference(separerPrompt(distante), { prompt: locale.prompt, configuration: locale.configuration });
  const distanteModifiee = distanteModifieeDepuis(locale.verrou, { versionId: versionDe(distante), empreinte: empreinte(distante) });
  return { locale, distante, d, distanteModifiee };
}

async function confirmer(question: string): Promise<boolean> {
  if (process.argv.includes('--oui')) return true;
  if (!stdin.isTTY) {
    console.error('Pas de terminal pour confirmer : relance avec --oui après avoir relu la différence.');
    return false;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return /^o(ui)?$/i.test((await rl.question(`${question} (o/N) `)).trim());
  } finally {
    rl.close();
  }
}

const commandes: Record<string, () => Promise<void>> = {
  async create() {
    if (process.env.ELEVENLABS_AGENT_ID) throw new Error('ELEVENLABS_AGENT_ID est déjà défini : utilise push');
    const locale = await lireLocal(DOSSIER);
    const agentId = await client().creer(avecPrompt(locale.configuration, locale.prompt));
    const cree = clientElevenLabs({ cle: exiger('ELEVENLABS_API_KEY'), agentId });
    await enregistrerDistante(DOSSIER, await cree.lire());
    console.log(`Agent créé. Ajoute dans .env : ELEVENLABS_AGENT_ID=${agentId}`);
  },

  async pull() {
    const resultat = await rapatrier(DOSSIER, client(), { force: process.argv.includes('--force') });
    if (!resultat.ok) throw new Error(`${resultat.raison} Ou relance avec --force pour les écraser.`);
    console.log('Configuration distante rapatriée dans agent/. Relis le diff, puis commite.');
  },

  async push() {
    const { locale, distante, d, distanteModifiee } = await differenceAvecDistante();
    if (distanteModifiee) {
      throw new Error('La configuration distante a changé depuis le dernier pull : lance pull et relis le diff avant de pousser.');
    }
    if (d.vide) {
      console.log('Rien à pousser : agent/ est identique à la configuration distante.');
      return;
    }
    console.log(`Ce que la poussée change chez ElevenLabs (distant → dépôt) :\n\n${d.texte}\n`);
    if (!(await confirmer('Pousser ?'))) {
      console.log('Rien n’est parti.');
      process.exitCode = 1;
      return;
    }
    // La poussée revérifie que ni le dépôt ni la configuration distante n'ont bougé depuis la différence affichée.
    const resultat = await pousser(DOSSIER, client(), {
      empreinteLocale: empreinte(avecPrompt(locale.configuration, locale.prompt)),
      versionIdDistante: versionDe(distante),
    });
    if (!resultat.ok) throw new Error(resultat.raison);
    console.log(`Configuration envoyée (version ${versionDe(distante) ?? 'inconnue'} → ${resultat.versionId ?? 'inconnue'}). Relis le diff de agent/, puis commite.`);
  },

  async status() {
    const { d, distanteModifiee } = await differenceAvecDistante();
    console.log(`distante modifiée depuis le dernier pull : ${distanteModifiee ? 'oui' : 'non'}`);
    console.log(`dépôt différent de la configuration distante : ${d.vide ? 'non' : 'oui'}`);
    for (const { chemin } of d.champs) console.log(`  ${chemin === CHEMIN_PROMPT ? 'prompt' : chemin}`);
  },
};

const commande = commandes[process.argv[2] ?? ''];
if (!commande) {
  console.error('usage : scripts/agent.ts create | pull [--force] | push [--oui] | status');
  process.exit(1);
}
try {
  await commande();
} catch (erreur) {
  console.error((erreur as Error).message);
  process.exit(1);
}
