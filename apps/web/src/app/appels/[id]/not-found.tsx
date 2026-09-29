import type { Metadata } from 'next';
import { LienAction } from '@/components/action';

export const metadata: Metadata = { title: 'Appel introuvable' };

export default function AppelIntrouvable() {
  return (
    <div className="grid max-w-[60ch] justify-items-start gap-2 pt-8">
      <h1 className="text-xl font-semibold tracking-[-0.01em]">Cet appel n’existe pas.</h1>
      <p className="text-base text-encre-2">Le lien est peut-être incomplet, ou l’appel a été supprimé avec son entreprise.</p>
      <div className="-mx-1.5 flex flex-wrap gap-x-4 pt-2">
        <LienAction href="/appels" ton="fort">
          Revenir aux appels
        </LienAction>
      </div>
    </div>
  );
}
