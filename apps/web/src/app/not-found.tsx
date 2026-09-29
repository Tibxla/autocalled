import type { Metadata } from 'next';
import { LienAction } from '@/components/action';

export const metadata: Metadata = { title: 'Page introuvable' };

export default function Introuvable() {
  return (
    <div className="grid max-w-[60ch] justify-items-start gap-2 pt-8">
      <h1 className="text-xl font-semibold tracking-[-0.01em]">Cette page n’existe pas.</h1>
      <p className="text-base text-encre-2">Le lien est peut-être ancien, ou l’élément a été supprimé.</p>
      <div className="-mx-1.5 flex flex-wrap gap-x-4 pt-2">
        <LienAction href="/" ton="fort">
          Revenir à l’accueil
        </LienAction>
        <LienAction href="/appels">Voir les appels</LienAction>
      </div>
    </div>
  );
}
