import type { Metadata } from 'next';
import Link from 'next/link';
import { NomDeLAssistante } from '@/components/assistante';
import { FUSEAU } from '@/components/format-appel';
import { EnTetePage, LienAction, Message, Page, PointCreux, TitreSection } from '@/components/ui';
import { lireAppel } from '@/lib/lecture';
import { assistantePourLaPage } from '@/lib/pages';
import { commanderPont, type ReglagesLigne } from '@/lib/pont';
import type { Appairage, EtatTelephone } from './actions';
import { FormulaireReglages } from './formulaire-reglages';
import { ActionReconnecter, PanneauTelephone } from './panneau-telephone';
import { ReleveEtat } from './releve-etat';

export const metadata: Metadata = { title: 'Téléphone' };

/** Le même que l'écran de chargement (loading.tsx) : le nom vient du layout. */
const SOUS_TITRE = (
  <>
    Le téléphone passerelle compose les appels de <NomDeLAssistante /> avec sa carte SIM.
  </>
);

const HEURE_SECONDES = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: FUSEAU,
});

type Verdict = {
  ton: 'encre' | 'encre-2' | 'alerte' | 'antenne';
  texte: string;
  lien?: string;
  detail?: string;
  /** Téléphone connu mais déconnecté : « Reconnecter le téléphone » sous le verdict. */
  reconnecter?: boolean;
};

const TONS: Record<Verdict['ton'], string> = {
  encre: 'text-encre',
  'encre-2': 'text-encre-2',
  // Ligne tombée, injoignable ou plafonnée : texte en encre, la brique sur le point creux qui le précède.
  alerte: 'text-encre',
  antenne: 'text-antenne',
};

function reglagesLisibles(r: unknown): r is ReglagesLigne {
  const v = r as Partial<ReglagesLigne> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.appelsParHeure === 'number' &&
    typeof v.appelsParJour === 'number' &&
    typeof v.pauseEntreAppelsS === 'number'
  );
}

function etatLisible(corps: Record<string, unknown>): corps is EtatTelephone {
  return typeof corps.connecte === 'boolean' && reglagesLisibles(corps.reglages);
}

/** « Plafond de 15 appels par heure atteint, […]. Prochain appel possible dans 12 min. », dit en une phrase. */
function verdictPlafond(phrase: string): Verdict {
  const m = /Plafond de (\d+) appels par (heure|jour) atteint[\s\S]*Prochain appel possible dans (\d+) min/.exec(phrase);
  if (!m) return { ton: 'alerte', texte: 'Plafond d’appels atteint', detail: phrase };
  return {
    ton: 'alerte',
    texte: `Plafond atteint\u00a0: prochain appel possible dans ${m[3]} min`,
    detail: `${m[1]} appels par ${m[2]} au plus, pour que le numéro ne soit pas signalé comme démarchage.`,
  };
}

async function nomDuProspect(appelId: string): Promise<string | null> {
  try {
    return (await lireAppel(appelId))?.prospect?.nom ?? null;
  } catch {
    // L'identifiant vient de la ligne, pas de la base : il peut ne pas être un UUID connu.
    return null;
  }
}

export default async function PageTelephone() {
  const [etat, appairage, { nom: nomAssistante }] = await Promise.all([
    commanderPont('/etat'),
    commanderPont('/appairage'),
    assistantePourLaPage(),
  ]);
  const luA = HEURE_SECONDES.format(new Date());
  const telephone = etat.ok && etatLisible(etat.corps) ? etat.corps : null;
  const reglages = etat.ok && reglagesLisibles(etat.corps.reglages) ? etat.corps.reglages : null;

  let verdict: Verdict;
  if (!etat.ok) verdict = { ton: 'alerte', texte: 'Ligne injoignable' };
  else if (!telephone)
    verdict = {
      ton: 'alerte',
      texte: 'État du téléphone illisible',
      detail: 'La ligne a répondu, mais pas dans la forme attendue.',
    };
  else if (telephone.appelEnCours) {
    const nom = telephone.appelId ? await nomDuProspect(telephone.appelId) : null;
    verdict = {
      ton: 'antenne',
      texte: nom ? `Appel en cours avec ${nom}` : 'Appel en cours',
      ...(telephone.appelId
        ? {
            lien: `/appels/${telephone.appelId}`,
          }
        : {}),
    };
  } else if (!telephone.adresse)
    verdict = {
      ton: 'encre-2',
      texte: 'Aucun téléphone passerelle appairé',
      detail: `${nomAssistante} ne peut pas appeler par le téléphone ; la ligne navigateur reste disponible.`,
    };
  else if (!telephone.connecte)
    verdict = {
      ton: 'alerte',
      texte: 'Téléphone passerelle déconnecté\u00a0: hors de portée ou Bluetooth coupé',
      reconnecter: true,
    };
  else if (telephone.plafond) verdict = verdictPlafond(telephone.plafond);
  else verdict = { ton: 'encre', texte: 'Prête à appeler' };

  return (
    <Page largeur="lecture">
      <EnTetePage titre="Téléphone" sousTitre={SOUS_TITRE} />
      <div className="grid max-w-[48rem] gap-12">
        <section aria-label="État de la ligne" className="grid gap-1.5">
          <p role="status" className={`text-lg font-semibold text-balance ${TONS[verdict.ton]}`}>
            {verdict.ton === 'alerte' ? <PointCreux className="mr-2.5" /> : null}
            {verdict.lien ? (
              <Link href={verdict.lien} className="decoration-antenne/50 decoration-1 underline-offset-4 hover:underline">
                {verdict.texte}
              </Link>
            ) : (
              verdict.texte
            )}
          </p>
          {verdict.detail ? <p className="max-w-[62ch] text-sm text-encre-2">{verdict.detail}</p> : null}
          {verdict.lien ? (
            <div className="-mx-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <LienAction ton="fort" href={verdict.lien}>
                Rejoindre l’appel
              </LienAction>
              <span className="text-sm text-encre-3">suivi, écoute, prise de main</span>
            </div>
          ) : null}
          {verdict.reconnecter ? (
            <div className="-mx-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <ActionReconnecter />
            </div>
          ) : null}
          <ReleveEtat luA={luA} />
        </section>

        <section aria-labelledby="titre-passerelle" className="grid gap-5">
          <TitreSection id="titre-passerelle">Téléphone passerelle</TitreSection>
          {!etat.ok ? (
            <Injoignable nomAssistante={nomAssistante} />
          ) : telephone ? (
            <PanneauTelephone telephone={telephone} initial={appairage.ok ? (appairage.corps as unknown as Appairage) : null} />
          ) : (
            <Message ton="alerte" titre="État du téléphone illisible.">
              Relis dans quelques secondes ; si cela dure, redémarre le service de la ligne.
            </Message>
          )}
        </section>

        <section aria-labelledby="titre-garde-fous" className="grid gap-5">
          <TitreSection id="titre-garde-fous">Garde-fous</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            Des rafales d’appels courts ou sans réponse font signaler un numéro comme démarchage. La ligne refuse de composer au-delà de ces
            plafonds ; une campagne se met alors en pause sans sauter de prospect.
          </p>
          {reglages ? (
            <FormulaireReglages reglages={reglages} />
          ) : (
            <p className="text-sm text-encre-3">Garde-fous inconnus tant que la ligne ne répond pas.</p>
          )}
        </section>
      </div>
    </Page>
  );
}

/** La ligne ne répond pas : ce qu'on ne peut plus faire, et où regarder sur le serveur. */
function Injoignable({ nomAssistante }: { nomAssistante: string }) {
  return (
    <div className="grid gap-4">
      <p className="max-w-[62ch] text-base text-encre-2">
        {nomAssistante} ne peut pas appeler par le téléphone : le service de la ligne ne répond pas.
      </p>
      <div className="grid gap-1.5">
        <p className="text-sm text-encre-3">Pour vérifier sur le serveur :</p>
        <pre className="rounded-md bg-surface px-3.5 py-2.5 font-mono text-xs leading-6 break-all whitespace-pre-wrap text-encre-2">
          <code>
            systemctl --user status autocalled-pont
            {'\n'}
            journalctl --user -u autocalled-pont -n 50
          </code>
        </pre>
      </div>
      <p className="text-sm text-encre-3">La ligne navigateur reste disponible pour une démo.</p>
    </div>
  );
}
