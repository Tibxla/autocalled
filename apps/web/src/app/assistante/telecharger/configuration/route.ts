import { lireFichiersAssistante } from '@/lib/fichiers-assistante';
import { configurationATelecharger } from '@/lib/vue-assistante';
import { fichier, operateurOuRefus } from '../reponse';

export const dynamic = 'force-dynamic';

/** `agent/mina.config.json` tel quel ; une clé qui ressemblerait à un secret y serait masquée. */
export async function GET() {
  const refuse = await operateurOuRefus();
  if (refuse) return refuse;
  const { configurationBrute, configuration } = await lireFichiersAssistante();
  return fichier(configurationATelecharger(configurationBrute, configuration).texte, 'mina.config.json', 'application/json');
}
