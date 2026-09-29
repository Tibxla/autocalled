import type { Metadata, Viewport } from 'next';
import { Chivo, Chivo_Mono } from 'next/font/google';
import { FournisseurAssistante } from '@/components/assistante';
import { BarreHaut } from '@/components/barre-haut';
import { AideRaccourcis, FournisseurClavier } from '@/components/clavier';
import { GardeSortie } from '@/components/garde-sortie';
import { NavBas } from '@/components/nav-bas';
import { ASSISTANTE_PAR_DEFAUT } from '@/lib/assistante';
import { assistantePourLaPage } from '@/lib/pages';
import './globals.css';

// Polices variables (100 à 900) : pas de `weight`. Le sous-ensemble latin couvre accents, œ, « », ’, …,
// espace fine, •, ·, ×, ↑ et ↓, mais pas ←, → ni ↵ : les touches s'écrivent en toutes lettres.
const texte = Chivo({ subsets: ['latin'], display: 'swap', variable: '--police-texte' });
const donnees = Chivo_Mono({ subsets: ['latin'], display: 'swap', variable: '--police-donnees' });

/** Tout vient de la base à chaque requête : rien n'est figé au moment de la construction. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Autocalled', template: '%s · Autocalled' },
  description: 'Régie de l’assistante vocale de prospection.',
  robots: { index: false, follow: false },
  // Installable sur l'écran d'accueil (manifest.ts, apple-icon.tsx) ; barre d'état noire : le contenu reste
  // dessous, sans marge de sécurité en haut à gérer.
  appleWebApp: { capable: true, title: 'Autocalled', statusBarStyle: 'black' },
};

// viewport-fit=cover : les gouttières et la barre du bas tiennent compte des zones de sécurité (globals.css).
// resizes-content : le clavier de l'écran réduit la page, les barres collées en bas restent au-dessus de lui.
// Jamais de maximum-scale ni de user-scalable : les champs passent à 16 px au doigt pour éviter le zoom au focus.
export const viewport: Viewport = { themeColor: '#121110', colorScheme: 'dark', viewportFit: 'cover', interactiveWidget: 'resizes-content' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Base injoignable : le layout tient (la page montrera son erreur), avec le nom par défaut.
  const { nom } = await assistantePourLaPage().catch(() => ASSISTANTE_PAR_DEFAUT);
  return (
    <html lang="fr" className={`${texte.variable} ${donnees.variable}`}>
      <body className="min-h-dvh bg-fond font-sans text-md text-encre">
        <FournisseurAssistante nom={nom}>
          <FournisseurClavier>
            <a
              href="#contenu"
              className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-[4px] focus:bg-surface focus:px-3 focus:py-2"
            >
              Aller au contenu
            </a>
            <BarreHaut />
            <GardeSortie />
            <main id="contenu" tabIndex={-1} className="px-(--gouttiere) pb-(--fin-de-page) focus:outline-none">
              {children}
            </main>
            <NavBas />
            <AideRaccourcis />
          </FournisseurClavier>
        </FournisseurAssistante>
      </body>
    </html>
  );
}
