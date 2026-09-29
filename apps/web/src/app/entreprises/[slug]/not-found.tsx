import type { Metadata } from 'next';
import { LienAction } from '@/components/action';

export const metadata: Metadata = { title: 'Entreprise introuvable' };

/** Slug inconnu (le layout s'efface alors) ou prospect introuvable dans cette entreprise. */
export default function EntrepriseIntrouvable() {
  return (
    <div className="grid max-w-[60ch] justify-items-start gap-2 pt-8">
      <h1 className="text-xl font-semibold tracking-[-0.01em]">Aucune entreprise à cette adresse.</h1>
      <p className="text-base text-encre-2">Le lien est peut-être ancien, ou l’entreprise a changé de nom.</p>
      <div className="-mx-1.5 flex flex-wrap gap-x-4 pt-2">
        <LienAction href="/entreprises" ton="fort">
          Voir les entreprises
        </LienAction>
      </div>
    </div>
  );
}
