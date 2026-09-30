import { lireAssistante } from '@/lib/assistante';
import { lireFichiersAssistante } from '@/lib/fichiers-assistante';
import { nomDeFichier } from '@/lib/vue-assistante';
import { fichier, operateurOuRefus } from '../reponse';

export const dynamic = 'force-dynamic';

/** `agent/prompt.md` tel quel, `{{variables}}` comprises. */
export async function GET() {
  const refuse = await operateurOuRefus();
  if (refuse) return refuse;
  const [{ prompt }, { nom }] = await Promise.all([lireFichiersAssistante(), lireAssistante()]);
  return fichier(prompt, nomDeFichier([nom, 'prompt'], 'md'), 'text/markdown');
}
