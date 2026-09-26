import type { Metadata } from 'next';
import { Geist_Mono, Schibsted_Grotesk } from 'next/font/google';
import { BarreHaut } from '@/components/barre-haut';
import './globals.css';

const texte = Schibsted_Grotesk({ subsets: ['latin'], variable: '--police-texte' });
const donnees = Geist_Mono({ subsets: ['latin'], variable: '--police-donnees' });

export const metadata: Metadata = {
  title: { default: 'Autocalled', template: '%s · Autocalled' },
  description: 'Régie de Mina, l’assistante vocale de prospection.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${texte.variable} ${donnees.variable}`}>
      <body className="min-h-dvh font-sans text-base">
        <BarreHaut />
        <main className="mx-auto w-full max-w-[72rem] px-5 pb-24 sm:px-8">{children}</main>
      </body>
    </html>
  );
}
