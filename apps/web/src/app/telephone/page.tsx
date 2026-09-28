import type { Metadata } from 'next';
import { EnTetePage, Message, TitreSection } from '@/components/ui';
import { commanderPont } from '@/lib/pont';
import type { Appairage, EtatTelephone } from './actions';
import { FormulaireReglages } from './formulaire-reglages';
import { PanneauTelephone } from './panneau-telephone';

export const metadata: Metadata = { title: 'Téléphone' };

export default async function PageTelephone() {
  const [etat, appairage] = await Promise.all([commanderPont('/etat'), commanderPont('/appairage')]);
  const telephone = etat.ok ? (etat.corps as unknown as EtatTelephone) : null;

  return (
    <>
      <EnTetePage titre="Téléphone" sousTitre="Le téléphone passerelle par lequel Mina appelle sur la ligne téléphone." />
      <div className="grid max-w-[48rem] gap-14">
        <section className="grid gap-5">
          <TitreSection>Téléphone passerelle</TitreSection>
          {telephone ? (
            <PanneauTelephone telephone={telephone} initial={appairage.ok ? (appairage.corps as unknown as Appairage) : null} />
          ) : (
            <Message ton="alerte">{etat.ok ? 'État du téléphone illisible.' : etat.raison}</Message>
          )}
        </section>

        {telephone ? (
          <section className="grid gap-5">
            <TitreSection>Garde-fous</TitreSection>
            <p className="max-w-[62ch] text-encre-2">
              Des rafales d’appels courts ou sans réponse font signaler un numéro comme démarchage. Le pont refuse de composer au-delà de ces
              plafonds ; une campagne se met alors en pause sans sauter de prospect.
            </p>
            <FormulaireReglages reglages={telephone.reglages} />
          </section>
        ) : null}
      </div>
    </>
  );
}
