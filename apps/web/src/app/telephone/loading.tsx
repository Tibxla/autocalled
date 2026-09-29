import { NomDeLAssistante } from '@/components/assistante';
import { EnTetePage, Page } from '@/components/ui';

const LARGEURS = ['38%', '22%', '14%', '10%'];

/**
 * La page Téléphone attend la ligne, qui peut mettre jusqu'à 15 s à répondre : sans ce squelette, l'écran
 * précédent restait figé tout ce temps.
 */
export default function ChargementTelephone() {
  return (
    <Page largeur="lecture">
      <EnTetePage
        titre="Téléphone"
        sousTitre={
          <>
            Le téléphone passerelle compose les appels de <NomDeLAssistante /> avec sa carte SIM.
          </>
        }
      />
      <div className="grid max-w-[48rem] gap-12" aria-busy="true">
        <div className="grid gap-1.5">
          <p role="status" className="text-lg font-semibold text-encre-3">
            Relevé de la ligne…
          </p>
          <p className="text-sm text-encre-3">Jusqu’à 15 secondes quand la ligne tarde à répondre.</p>
        </div>
        <div aria-hidden="true" className="grid gap-5">
          <div className="h-5 w-44 rounded-[3px] bg-survol" />
          <div className="border-t border-filet">
            {LARGEURS.map((largeur, i) => (
              <div key={i} className="grid gap-1 border-b border-filet py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
                <div className="h-3 w-16 rounded-[3px] bg-survol" />
                <div className="h-3 rounded-[3px] bg-survol" style={{ width: largeur }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Page>
  );
}
