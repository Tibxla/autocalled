'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRaccourci } from '@/components/clavier';
import { Confirmation, useConfirmation } from '@/components/confirmation';
import { BORNES, desserre, dureeLisible, estimation, validerReglages, type ReglagesLigne } from '@/components/garde-fous';
import { Action, Message, Saisie } from '@/components/ui';
import { useFormulaire } from '@/components/use-formulaire';
import { enregistrerReglages } from './actions';
import { texteLigne } from './panneau-telephone';

/**
 * Garde-fous de la ligne. Resserrer s'enregistre directement ; desserrer (plafond qui monte, pause qui
 * baisse) passe par une Confirmation, même règle que le serveur MCP (ADR 0009). La ligne reste seule juge :
 * la validation locale ne fait que prévenir avant l'envoi.
 */

type Cle = keyof ReglagesLigne;
type EtatEnvoi = { message: string | null; ok: boolean };
type Envoi = (etat: EtatEnvoi, donnees: FormData) => Promise<EtatEnvoi>;

const CHAMPS: { nom: Cle; libelle: string; unite: string; aide: string }[] = [
  {
    nom: 'appelsParHeure',
    libelle: 'Appels par heure',
    unite: 'appels',
    aide: 'sur l’heure glissante.',
  },
  {
    nom: 'appelsParJour',
    libelle: 'Appels par jour',
    unite: 'appels',
    aide: 'sur 24 heures glissantes.',
  },
  {
    nom: 'pauseEntreAppelsS',
    libelle: 'Pause entre deux appels',
    unite: 's',
    aide: 'après la fin d’un appel de campagne.',
  },
];

/** Le volume de référence de la phrase de conséquence : une journée pleine. */
const VOLUME = 100;

const enTextes = (r: ReglagesLigne): Record<Cle, string> => ({
  appelsParHeure: String(r.appelsParHeure),
  appelsParJour: String(r.appelsParJour),
  pauseEntreAppelsS: String(r.pauseEntreAppelsS),
});

const enNombre = (texte: string) => (texte.trim() === '' ? Number.NaN : Number(texte.trim()));

const memes = (a: ReglagesLigne, b: ReglagesLigne) =>
  a.appelsParHeure === b.appelsParHeure && a.appelsParJour === b.appelsParJour && a.pauseEntreAppelsS === b.pauseEntreAppelsS;

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** Ce que ces réglages font à une campagne de cent appels. */
function phraseRythme(r: ReglagesLigne): string {
  if (r.appelsParJour >= VOLUME) return estimation({ appels: VOLUME, reglages: r }).phrase;
  const premiers = r.appelsParJour;
  const suite =
    premiers > 1
      ? ` Le dernier de ces ${premiers} appels part au plus tôt dans ${dureeLisible(estimation({ appels: premiers, reglages: r }).minutesAuPlusTot)}.`
      : '';
  return `À ce rythme, une campagne de ${VOLUME} appels se met en pause après ${pluriel(premiers, 'appel')} sur 24 heures glissantes.${suite}`;
}

/** Les nombres en Chivo Mono, les mots et les unités (h, min, s, appels) en Chivo. */
function EnChasse({ texte }: { texte: string }) {
  return texte.split(/(\d+)/).map((morceau, i) =>
    i % 2 === 1 ? (
      <span key={i} className="font-mono">
        {morceau}
      </span>
    ) : (
      morceau
    ),
  );
}

/** « de 15 à 40 appels par heure », pour chaque réglage qui desserre. */
function changementsDesserres(avant: ReglagesLigne, apres: ReglagesLigne): string[] {
  const liste: string[] = [];
  if (apres.appelsParHeure > avant.appelsParHeure) liste.push(`de ${avant.appelsParHeure} à ${apres.appelsParHeure} appels par heure`);
  if (apres.appelsParJour > avant.appelsParJour) liste.push(`de ${avant.appelsParJour} à ${apres.appelsParJour} appels par jour`);
  if (apres.pauseEntreAppelsS < avant.pauseEntreAppelsS)
    liste.push(`d’une pause de ${avant.pauseEntreAppelsS} s à ${apres.pauseEntreAppelsS} s`);
  return liste;
}

export function FormulaireReglages({ reglages, envoyer = enregistrerReglages }: { reglages: ReglagesLigne; envoyer?: Envoi }) {
  const { etat, enCours, proprietes } = useFormulaire(envoyer, {
    message: null,
    ok: false,
  });
  const [valeurs, setValeurs] = useState<Record<Cle, string>>(() => enTextes(reglages));
  const [montrerErreurs, setMontrerErreurs] = useState(false);
  // Le retour du serveur reste affiché jusqu'à la saisie suivante.
  const [etatMasque, setEtatMasque] = useState<EtatEnvoi | null>(null);
  const confirmation = useConfirmation();
  const bouton = useRef<HTMLButtonElement>(null);
  const confirme = useRef(false);

  const saisis: ReglagesLigne = {
    appelsParHeure: enNombre(valeurs.appelsParHeure),
    appelsParJour: enNombre(valeurs.appelsParJour),
    pauseEntreAppelsS: enNombre(valeurs.pauseEntreAppelsS),
  };
  const change = !memes(saisis, reglages);

  // Les réglages relus changent (enregistrés ici, ou par Claude Code) : la saisie suit tant qu'elle est intacte.
  const [base, setBase] = useState(reglages);
  if (!memes(base, reglages)) {
    setBase(reglages);
    if (memes(saisis, base)) setValeurs(enTextes(reglages));
  }

  const erreurs = validerReglages(saisis);
  const valide = Object.keys(erreurs).length === 0;
  const desserrant = valide && desserre(reglages, saisis);
  const retour = etat.message && etat !== etatMasque ? etat : null;

  // Ctrl Entrée, comme « Enregistrer la fiche » : depuis le formulaire seulement ; desserrer garde sa confirmation.
  useRaccourci({
    touche: 'Enter',
    ctrl: true,
    dansChamp: true,
    libelle: 'Enregistrer les garde-fous',
    actif: change && !enCours,
    action: () => {
      const f = proprietes.ref.current;
      if (!f?.contains(document.activeElement)) return false;
      f.requestSubmit();
    },
  });

  const surEnvoi = (e: FormEvent<HTMLFormElement>) => {
    if (!valide) {
      e.preventDefault();
      setMontrerErreurs(true);
      const formulaire = e.currentTarget;
      requestAnimationFrame(() => formulaire.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    if (desserrant && !confirme.current) {
      e.preventDefault();
      confirmation.ouvrir(bouton.current);
      return;
    }
    confirme.current = false;
    proprietes.onSubmit(e);
  };

  return (
    <form
      {...proprietes}
      onSubmit={surEnvoi}
      noValidate
      className="grid gap-5"
      // Une saisie non enregistrée suspend le relevé automatique de la page (releve-etat.tsx).
      data-garde-releve={change ? '' : undefined}
    >
      <div className="grid gap-5 sm:grid-cols-3 sm:gap-6">
        {CHAMPS.map((c) => {
          const [min, max] = BORNES[c.nom];
          const erreur = montrerErreurs ? erreurs[c.nom] : undefined;
          return (
            <div key={c.nom} className="grid content-start gap-1.5">
              <label htmlFor={c.nom} className="text-sm font-medium text-encre">
                {c.libelle}
              </label>
              <span className="flex items-baseline gap-2">
                <span className="w-20 shrink-0">
                  <Saisie
                    id={c.nom}
                    name={c.nom}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={valeurs[c.nom]}
                    onChange={(e) => {
                      const texte = e.target.value;
                      setValeurs((v) => ({ ...v, [c.nom]: texte }));
                      setEtatMasque(etat);
                    }}
                    aria-invalid={erreur ? true : undefined}
                    aria-describedby={`${c.nom}-aide${erreur ? ` ${c.nom}-erreur` : ''}`}
                    className="font-mono"
                  />
                </span>
                <span className="text-sm text-encre-3">{c.unite}</span>
              </span>
              <p id={`${c.nom}-aide`} className="text-sm text-encre-3">
                <EnChasse texte={`${min} à ${max}${c.unite === 's' ? ' s' : ''}, ${c.aide}`} />
              </p>
              {erreur ? (
                <p id={`${c.nom}-erreur`} className="text-sm text-alerte">
                  {erreur}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="max-w-[62ch] text-sm text-encre-2" aria-live="polite">
        {valide ? <EnChasse texte={phraseRythme(saisis)} /> : 'Corrige les valeurs pour voir le rythme qu’elles donnent.'}
      </p>

      {retour ? (
        <Message ton={retour.ok ? 'neutre' : 'alerte'}>{retour.ok ? retour.message : texteLigne(retour.message ?? '')}</Message>
      ) : null}

      <div className="grid gap-3">
        <div className="-mx-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 pointer-coarse:mx-0">
          <Action
            ref={bouton}
            type="submit"
            ton="fort"
            touche="Ctrl Entrée"
            disabled={!change || enCours}
            enCours={enCours}
            libelleEnCours="Enregistrement…"
          >
            {desserrant ? 'Enregistrer et desserrer' : 'Enregistrer'}
          </Action>
          {change && !enCours ? (
            <Action
              ton="discret"
              onClick={() => {
                setValeurs(enTextes(reglages));
                setMontrerErreurs(false);
                confirmation.fermer();
              }}
            >
              Revenir aux réglages actuels
            </Action>
          ) : null}
        </div>
        <Confirmation
          ouverte={confirmation.ouverte}
          question="Desserrer les garde-fous ?"
          libelleConfirmer="Desserrer"
          ton="alerte"
          onAnnuler={confirmation.fermer}
          onConfirmer={() => {
            confirme.current = true;
            confirmation.fermer();
            proprietes.ref.current?.requestSubmit();
          }}
        >
          Tu passes {changementsDesserres(reglages, saisis).join(' et ')}. Des rafales d’appels courts font signaler le numéro comme
          démarchage.
        </Confirmation>
      </div>
    </form>
  );
}
