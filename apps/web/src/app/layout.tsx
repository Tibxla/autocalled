import type { Metadata, Viewport } from 'next';
import { Chivo, Chivo_Mono } from 'next/font/google';
import { BarreHaut } from '@/components/barre-haut';
import { AideRaccourcis, FournisseurClavier } from '@/components/clavier';
import { GardeSortie } from '@/components/garde-sortie';
import './globals.css';

// Polices variables (100 à 900) : pas de `weight`. Le sous-ensemble latin couvre accents, œ, « », ’, …,
// espace fine, •, ·, ×, ↑ et ↓, mais pas ←, → ni ↵ : les touches s'écrivent en toutes lettres.
const texte = Chivo({ subsets: ['latin'], display: 'swap', variable: '--police-texte' });
const donnees = Chivo_Mono({ subsets: ['latin'], display: 'swap', variable: '--police-donnees' });

/** Tout vient de la base à chaque requête : rien n'est figé au moment de la construction. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Autocalled', template: '%s · Autocalled' },
  description: 'Régie de Mina, l’assistante vocale de prospection.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#121110', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${texte.variable} ${donnees.variable}`}>
      <body className="min-h-dvh bg-fond font-sans text-md text-encre">
        <FournisseurClavier>
          <a
            href="#contenu"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-[4px] focus:bg-surface focus:px-3 focus:py-2"
          >
            Aller au contenu
          </a>
          <BarreHaut />
          <GardeSortie />
          <main id="contenu" tabIndex={-1} className="px-(--gouttiere) pb-24 focus:outline-none">
            {children}
          </main>
          <AideRaccourcis />
        </FournisseurClavier>
      </body>
    </html>
  );
}
