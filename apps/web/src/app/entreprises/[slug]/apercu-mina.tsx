'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useNomAssistante } from '@/components/assistante';
import { REFUS_NUMERO } from '@/components/refus-numero';
import { Chevron, Message, Selection } from '@/components/ui';
import type { ResultatAction } from '@/lib/formulaire';
import type { ApercuVariables } from '@/lib/apercu';
import { GROUPES_VARIABLES } from '@/lib/vue-assistante';
import { lireApercu } from './actions';

/**
 * « Ce que l'assistante recevra » : les variables d'appel calculées par le serveur comme pour un vrai appel
 * (lib/apercu.ts), pour un prospect choisi ou sans prospect. Repliée par défaut ; chaque ouverture relit la base,
 * `revision` (l'horodatage de la donnée affichée à côté) relit aussi quand la page vient d'enregistrer.
 */
export function ApercuMina({
  entrepriseId,
  prospects,
  versions,
  versionFixe,
  numeroVersion,
  titre,
  revision,
}: {
  entrepriseId: string;
  prospects: { id: string; nom: string }[];
  /** Choix de version (fiche d'entreprise) ; absent quand la page montre déjà une version (`versionFixe`). */
  versions?: { id: string; libelle: string }[];
  versionFixe?: string;
  /** Le numéro de la version montrée par la page, repris dans le titre par défaut. */
  numeroVersion?: number;
  titre?: string;
  revision?: string;
}) {
  const id = useId();
  const nom = useNomAssistante();
  const intitule = titre ?? `Ce que ${nom} recevra${numeroVersion !== undefined ? ` avec la v${numeroVersion}` : ''}`;
  const [ouvert, setOuvert] = useState(false);
  const [prospectId, setProspectId] = useState('');
  const [versionChoisie, setVersionId] = useState(versions?.[0]?.id ?? '');
  const versionId = versionFixe ?? versionChoisie;
  const [resultat, setResultat] = useState<ResultatAction<{ apercu: ApercuVariables }> | null>(null);
  const [enCours, demarrer] = useTransition();

  const charger = (p: string, v: string) =>
    demarrer(async () => {
      try {
        setResultat(await lireApercu(entrepriseId, p || null, v || null));
      } catch {
        setResultat({ ok: false, raison: 'L’aperçu n’a pas pu être calculé : réessaie.' });
      }
    });

  // Une autre version affichée (page de script) ou une donnée enregistrée à côté : l'aperçu ouvert se relit.
  const cle = `${versionFixe ?? ''}|${revision ?? ''}`;
  const vue = useRef(cle);
  useEffect(() => {
    if (vue.current === cle) return;
    vue.current = cle;
    if (ouvert) charger(prospectId, versionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seul le changement de clé relit
  }, [cle]);

  const apercu = resultat?.ok ? resultat.apercu : null;
  const sansProspect = apercu && !apercu.prospect;

  return (
    <details
      className="group max-w-[44rem]"
      open={ouvert}
      onToggle={(ev) => {
        const ouverture = ev.currentTarget.open;
        setOuvert(ouverture);
        if (ouverture) charger(prospectId, versionId);
      }}
    >
      <summary className="-mx-1.5 inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-[4px] px-1.5 text-md text-encre-2 hover:text-encre pointer-coarse:h-11 pointer-coarse:active:bg-survol [&::-webkit-details-marker]:hidden">
        <Chevron className="stroke-encre-3 group-open:rotate-90" />
        <span className="decoration-souligne underline-offset-4 group-hover:underline pointer-coarse:underline">{intitule}</span>
      </summary>

      <div className="grid gap-4 pt-2 pb-2" aria-busy={enCours}>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-prospect`} className="text-sm font-medium text-encre">
              Prospect
            </label>
            <Selection
              id={`${id}-prospect`}
              value={prospectId}
              onChange={(ev) => {
                setProspectId(ev.target.value);
                charger(ev.target.value, versionId);
              }}
              className="w-[16rem] max-w-full"
            >
              <option value="">Aucun prospect choisi</option>
              {prospects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom}
                </option>
              ))}
            </Selection>
          </div>
          {versions && versions.length > 0 ? (
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-version`} className="text-sm font-medium text-encre">
                Version du script
              </label>
              <Selection
                id={`${id}-version`}
                value={versionId}
                onChange={(ev) => {
                  setVersionId(ev.target.value);
                  charger(prospectId, ev.target.value);
                }}
                className="w-[16rem] max-w-full"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.libelle}
                  </option>
                ))}
              </Selection>
            </div>
          ) : null}
          <p role="status" className="pb-2 text-sm text-encre-3">
            {enCours ? 'Calcul…' : null}
          </p>
        </div>

        {resultat && !resultat.ok ? <Message ton="alerte">{resultat.raison}</Message> : null}

        {apercu ? (
          <>
            <p className="max-w-[62ch] text-sm text-encre-3">
              Calculé comme au début d’un vrai appel, d’après ce qui est enregistré
              {apercu.version ? (
                <>
                  , avec <span className="text-encre-2">{apercu.version.script}</span>{' '}
                  <span className="font-mono">v{apercu.version.numero}</span>
                </>
              ) : (
                ` ; aucun script : ${nom} recevrait l’étape par défaut`
              )}
              .{' '}
              {sansProspect ? 'Sans prospect choisi, les variables du prospect sont calculées sur une fiche vide.' : null}
              {apercu.prospect?.refus ? (
                <span className="text-encre-2">
                  Numéro {REFUS_NUMERO[apercu.prospect.refus]} : cet appel serait refusé.
                </span>
              ) : null}
            </p>
            <dl className="border-t border-filet">
              {GROUPES_VARIABLES.map((g) => (
                <div key={g.titre} className="border-b border-filet py-2">
                  <dt className="pb-1 text-sm font-medium text-encre">{g.titre}</dt>
                  <dd>
                    <dl>
                      {g.cles.map(([cle, libelle]) => {
                        const depend = sansProspect && apercu.dependDuProspect.includes(cle);
                        const parDefaut = apercu.parDefaut.includes(cle);
                        const nonTransmis = apercu.nonTransmis.includes(cle);
                        return (
                          <div key={cle} className="grid gap-0.5 py-1.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                            <dt className="grid content-start text-sm text-encre-3">
                              <span>{libelle}</span>
                              <span className="font-mono text-xs break-all">{cle}</span>
                            </dt>
                            <dd className="min-w-0 text-md break-words whitespace-pre-line">
                              {depend ? (
                                <span className="text-encre-3">selon la fiche du prospect</span>
                              ) : nonTransmis ? (
                                <span className="text-encre-3">Non renseigné, non transmis.</span>
                              ) : (
                                <>
                                  <span className={parDefaut ? 'text-encre-2' : 'text-encre'}>{apercu.variables[cle]}</span>
                                  {parDefaut ? <span className="block text-sm text-encre-3">Texte par défaut : rien n’est écrit pour ce champ.</span> : null}
                                </>
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </dd>
                </div>
              ))}
              <div className="grid gap-0.5 border-b border-filet py-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-sm text-encre-3">Mots-clés de la reconnaissance vocale</dt>
                <dd className="text-md text-encre-2">{apercu.motsCles.join(' · ')}</dd>
              </div>
              <div className="grid gap-0.5 border-b border-filet py-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-sm text-encre-3">Premier message, si le prospect se tait au décroché</dt>
                <dd className="text-md text-encre-2">« {apercu.premierMessage} »</dd>
              </div>
            </dl>
          </>
        ) : null}
      </div>
    </details>
  );
}
