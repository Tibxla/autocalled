import { ceQueVoitLAssistante } from '@/lib/ce-que-voit-l-assistante';
import { jourIso, markdownDeLaVue, nomDeFichier } from '@/lib/vue-assistante';
import { fichier, operateurOuRefus, refus } from '../reponse';

export const dynamic = 'force-dynamic';

/** Ce que voit l'assistante pour l'entreprise, la version et le prospect de l'URL, en Markdown. */
export async function GET(requete: Request) {
  const refuse = await operateurOuRefus();
  if (refuse) return refuse;
  const parametres = new URL(requete.url).searchParams;
  const choix = {
    entreprise: parametres.get('entreprise') ?? undefined,
    version: parametres.get('version') ?? undefined,
    prospect: parametres.get('prospect') ?? undefined,
  };
  const { entreprise, vue, erreur } = await ceQueVoitLAssistante(choix);
  if (!entreprise || !vue) return refus(erreur ?? 'Aucune entreprise : rien à calculer.');
  const nom = nomDeFichier(
    [
      vue.assistante,
      'vue',
      entreprise.slug,
      vue.version ? `v${vue.version.numero}` : 'sans script',
      vue.prospect ?? 'sans prospect',
      jourIso(vue.calculeLe),
    ],
    'md',
  );
  return fichier(markdownDeLaVue(vue), nom, 'text/markdown');
}
