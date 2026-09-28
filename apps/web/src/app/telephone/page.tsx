import type { Metadata } from 'next';
import { EnTetePage, Message, TitreSection } from '@/components/ui';
import { commanderPont, type ReglagesLigne } from '@/lib/pont';
import type { Appairage } from './actions';
import { FormulaireReglages } from './formulaire-reglages';
import { BoutonOublier, PanneauAppairage } from './panneau-appairage';

export const metadata: Metadata = { title: 'Téléphone' };

type EtatTelephone = {
  connecte: boolean;
  nom?: string;
  adresse?: string;
  operateur?: string;
  signal?: number;
  batterie?: number;
  appelEnCours: boolean;
  plafond: string | null;
  reglages: ReglagesLigne;
};

export default async function PageTelephone() {
  const [etat, appairage] = await Promise.all([commanderPont('/etat'), commanderPont('/appairage')]);
  const telephone = etat.ok ? (etat.corps as unknown as EtatTelephone) : null;

  return (
    <>
      <EnTetePage titre="Téléphone" sousTitre="Le téléphone passerelle par lequel Mina appelle sur la ligne téléphone." />
      <div className="grid max-w-[48rem] gap-14">
        <section className="grid gap-5">
          <TitreSection>Téléphone passerelle</TitreSection>
          {!etat.ok ? (
            <Message ton="alerte">{etat.raison}</Message>
          ) : telephone?.connecte ? (
            <>
              <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-[12rem_1fr]">
                <dt className="text-sm text-encre-3">Appareil</dt>
                <dd>
                  {telephone.nom} <span className="font-mono text-sm text-encre-3">{telephone.adresse}</span>
                </dd>
                <dt className="text-sm text-encre-3">Réseau</dt>
                <dd>
                  {telephone.operateur || 'inconnu'}
                  {telephone.signal !== undefined ? <span className="text-encre-3"> · signal {telephone.signal} %</span> : null}
                </dd>
                {telephone.batterie !== undefined ? (
                  <>
                    <dt className="text-sm text-encre-3">Batterie</dt>
                    <dd>{telephone.batterie} %</dd>
                  </>
                ) : null}
                <dt className="text-sm text-encre-3">Ligne</dt>
                <dd>{telephone.appelEnCours ? <span className="text-antenne">Appel en cours</span> : 'Libre'}</dd>
              </dl>
              {telephone.plafond ? <Message ton="alerte">{telephone.plafond}</Message> : null}
              {telephone.signal !== undefined && telephone.signal < 40 ? (
                <Message ton="neutre">Signal faible : la voix risque de se dégrader. Rapproche le téléphone d’une fenêtre.</Message>
              ) : null}
              {telephone.adresse && !telephone.appelEnCours ? <BoutonOublier adresse={telephone.adresse} /> : null}
            </>
          ) : telephone?.adresse ? (
            <>
              <p className="text-encre-2">
                {telephone.nom} <span className="font-mono text-sm text-encre-3">{telephone.adresse}</span> est connu mais pas connecté : hors de
                portée, ou Bluetooth coupé.
              </p>
              <BoutonOublier adresse={telephone.adresse} />
            </>
          ) : (
            <p className="text-encre-2">Aucun téléphone connecté. Allume le Bluetooth du téléphone passerelle, ou appaire-en un ci-dessous.</p>
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

        {etat.ok ? (
          <section className="grid gap-5">
            <TitreSection>Appairer un téléphone</TitreSection>
            <p className="max-w-[62ch] text-encre-2">
              Le serveur devient visible pendant trois minutes, et n’accepte que le téléphone dont tu donnes l’adresse Bluetooth. Compare le
              code affiché ici avec celui du téléphone avant d’accepter : s’ils diffèrent, refuse.
            </p>
            <PanneauAppairage initial={appairage.ok ? (appairage.corps as unknown as Appairage) : null} />
          </section>
        ) : null}
      </div>
    </>
  );
}
