import type { Metadata } from 'next';
import Link from 'next/link';
import { EnTetePage, EtatVide } from '@/components/ui';
import { listerEntreprises, prospectsAutorisesParEntreprise } from '@/lib/donnees';
import { FormulaireCreation } from './formulaire-creation';

export const metadata: Metadata = { title: 'Entreprises' };

function compte(nombre: number, singulier: string, pluriel: string) {
  return `${nombre} ${nombre > 1 ? pluriel : singulier}`;
}

export default async function PageEntreprises() {
  const [liste, autorises] = await Promise.all([listerEntreprises(), prospectsAutorisesParEntreprise()]);

  return (
    <>
      <EnTetePage
        titre="Entreprises"
        sousTitre="Chaque entreprise que Mina peut représenter : son offre, ses objections, ses scripts et ses prospects."
        action={<FormulaireCreation />}
      />

      {liste.length === 0 ? (
        <EtatVide titre="Aucune entreprise pour l’instant">
          Crée la première avec son nom, puis décris son offre : c’est ce que Mina dira au téléphone.
        </EtatVide>
      ) : (
        <ul className="border-t border-filet">
          {liste.map((e) => (
            <li key={e.id} className="border-b border-filet">
              <Link
                href={`/entreprises/${e.slug}`}
                className="group grid gap-1 py-5 transition-colors duration-150 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-8"
              >
                <div className="grid gap-1">
                  <span className="font-medium group-hover:underline group-hover:decoration-filet-fort group-hover:underline-offset-4">
                    {e.nom}
                  </span>
                  <span className="max-w-[70ch] truncate text-sm text-encre-2">
                    {e.offre || 'Offre pas encore décrite'}
                  </span>
                </div>
                <span className="text-sm text-encre-3">
                  {compte(e.nombreProspects, 'prospect', 'prospects')}
                  {e.nombreProspects > 0 ? `, dont ${autorises.get(e.id) ?? 0} appelable${(autorises.get(e.id) ?? 0) > 1 ? 's' : ''}` : ''} · {compte(e.nombreObjections, 'objection', 'objections')} ·{' '}
                  {compte(e.nombreScripts, 'script', 'scripts')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
