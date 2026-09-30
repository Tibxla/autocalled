'use client';

import type { PlageHoraire } from '@autocalled/domain';
import { useState } from 'react';
import { NomDeLAssistante, useNomAssistante } from '@/components/assistante';
import { useRaccourci } from '@/components/clavier';
import { ChampConnu, MessageConflit, useRechargement } from '@/components/conflit';
import { Action, Champ, Compteur, Message, Saisie, Selection, TitreSection, ZoneTexte } from '@/components/ui';
import { useFormulaire } from '@/components/use-formulaire';
import type { EtatFormulaire } from '@/lib/formulaire';
import { enregistrerFiche } from './actions';

const NOMS_JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/** Demi-heures de 7 h à 22 h : le même pas que les créneaux proposés au téléphone. */
const HEURES = Array.from({ length: 31 }, (_, i) => {
  const minutes = 7 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

/** Limites de lib/schemas.ts (ficheSchema), affichées par les compteurs. */
const LIMITES = { offre: 400, cible: 400, arguments: 1200, prixConsigne: 400, interdits: 600, complements: 1500 } as const;
type ChampLimite = keyof typeof LIMITES;

/** Nom de chaque champ dans le message de refus, dans l'ordre de la page, avec l'id qui reçoit le focus. */
const CHAMPS: { cle: string; libelle: string; id: string }[] = [
  { cle: 'nom', libelle: 'Nom', id: 'nom' },
  { cle: 'offre', libelle: 'L’offre', id: 'offre' },
  { cle: 'cible', libelle: 'Pour qui', id: 'cible' },
  { cle: 'arguments', libelle: 'Ce qui fait la différence', id: 'arguments' },
  { cle: 'prixConsigne', libelle: 'Consigne sur le prix', id: 'prixConsigne' },
  { cle: 'interdits', libelle: 'À ne jamais dire ni promettre', id: 'interdits' },
  { cle: 'complements', libelle: 'Informations complémentaires', id: 'complements' },
  { cle: 'interlocuteur', libelle: 'Avec qui', id: 'interlocuteur' },
  { cle: 'dureeRendezVousMinutes', libelle: 'Durée', id: 'dureeRendezVousMinutes' },
  { cle: 'delaiMinimumHeures', libelle: 'Pas avant', id: 'delaiMinimumHeures' },
  { cle: 'horizonJours', libelle: 'Pas au-delà de', id: 'horizonJours' },
  { cle: 'plages', libelle: 'Plages autorisées', id: 'plage-1' },
];

interface Fiche {
  id: string;
  nom: string;
  offre: string;
  cible: string;
  arguments: string;
  prixConsigne: string;
  interdits: string;
  complements: string;
  dureeRendezVousMinutes: number;
  interlocuteur: string;
  plagesRendezVous: PlageHoraire[];
  delaiMinimumHeures: number;
  horizonJours: number;
  fuseau: string;
  modifieLe: Date;
}

interface Plage {
  actif: boolean;
  debut: string;
  fin: string;
}

function ChoixHeure({ id, name, valeur, libelle, actif, invalide, onChange }: { id?: string; name: string; valeur: string; libelle: string; actif: boolean; invalide?: boolean; onChange: (v: string) => void }) {
  // Une heure enregistrée hors du pas de 30 minutes reste proposée telle quelle.
  const options = HEURES.includes(valeur) ? HEURES : [...HEURES, valeur].sort();
  return (
    <Selection
      {...(id ? { id } : {})}
      name={name}
      value={valeur}
      onChange={(e) => onChange(e.target.value)}
      aria-label={libelle}
      aria-invalid={invalide || undefined}
      disabled={!actif}
      className="w-[5.5rem] font-mono"
    >
      {options.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </Selection>
  );
}

const LISTE_FR = new Intl.ListFormat('fr-FR', { type: 'conjunction' });

/** « 5 jours, de 14:00 à 18:00, heure de Paris » ou « Lundi et mardi, de 14:00 à 18:00 ; vendredi, de 09:00 à 12:00, heure de Paris ». */
function ResumePlages({ plages, fuseau }: { plages: Plage[]; fuseau: string }) {
  const actifs = plages.flatMap((p, i) => (p.actif ? [{ ...p, jour: i }] : []));
  const zone = fuseau === 'Europe/Paris' ? 'heure de Paris' : `heure de ${(fuseau.split('/').at(-1) ?? fuseau).replaceAll('_', ' ')}`;
  if (actifs.length === 0)
    return (
      <>
        Aucun jour coché : <NomDeLAssistante /> ne proposera aucun créneau.
      </>
    );

  const groupes = [...Map.groupBy(actifs, (p) => `${p.debut}-${p.fin}`).values()];
  const heures = (p: Plage) => (
    <>
      de <span className="font-mono">{p.debut}</span> à <span className="font-mono">{p.fin}</span>
    </>
  );
  if (groupes.length === 1) {
    const [premier] = actifs;
    return (
      <>
        {actifs.length === 1 ? NOMS_JOURS[premier!.jour] : `${actifs.length} jours`}, {heures(premier!)}, {zone}
      </>
    );
  }
  return (
    <>
      {groupes.map((g, i) => {
        const jours = LISTE_FR.format(g.map((p) => NOMS_JOURS[p.jour]!.toLocaleLowerCase('fr-FR')));
        return (
          <span key={i}>
            {i > 0 ? ' ; ' : ''}
            {i === 0 ? jours.charAt(0).toLocaleUpperCase('fr-FR') + jours.slice(1) : jours}, {heures(g[0]!)}
          </span>
        );
      })}
      , {zone}
    </>
  );
}

/** « Recharger », après un refus pour modification concurrente, remonte le formulaire avec la fiche relue. */
export function FormulaireFiche({ fiche }: { fiche: Fiche }) {
  const { cle, recharger, enCours } = useRechargement();
  return <Formulaire key={cle} fiche={fiche} recharger={recharger} rechargement={enCours} />;
}

function Formulaire({ fiche, recharger, rechargement }: { fiche: Fiche; recharger: () => void; rechargement: boolean }) {
  const { etat, enCours, modifie, proprietes } = useFormulaire<EtatFormulaire>(enregistrerFiche.bind(null, fiche.id), null, {
    avertirSiQuitte: true,
  });
  const e = etat?.erreurs ?? {};
  const fautifs = CHAMPS.filter((c) => e[c.cle]);

  const [longueurs, setLongueurs] = useState<Record<ChampLimite, number>>(() => ({
    offre: fiche.offre.length,
    cible: fiche.cible.length,
    arguments: fiche.arguments.length,
    prixConsigne: fiche.prixConsigne.length,
    interdits: fiche.interdits.length,
    complements: fiche.complements.length,
  }));
  const suivre = (cle: ChampLimite) => (ev: React.FormEvent<HTMLTextAreaElement>) => {
    const n = ev.currentTarget.value.length;
    setLongueurs((l) => (l[cle] === n ? l : { ...l, [cle]: n }));
  };
  const compteur = (cle: ChampLimite) => <Compteur valeur={longueurs[cle]} max={LIMITES[cle]} />;

  // L'aide des visios cite la valeur saisie : ce que l'assistante annoncera vraiment.
  const [interlocuteur, setInterlocuteur] = useState(fiche.interlocuteur);
  const nomAssistante = useNomAssistante();

  const [plages, setPlages] = useState<Plage[]>(() =>
    NOMS_JOURS.map((_, i) => {
      const p = fiche.plagesRendezVous.find((x) => x.jour === i + 1);
      return { actif: Boolean(p), debut: p?.debut ?? '14:00', fin: p?.fin ?? '18:00' };
    }),
  );
  const changerPlage = (i: number, changement: Partial<Plage>) => setPlages((l) => l.map((p, j) => (j === i ? { ...p, ...changement } : p)));
  const premierCoche = plages.findIndex((p) => p.actif);
  const cochees = plages.filter((p) => p.actif);
  const recopiable = cochees.length > 1 && cochees.some((p) => p.debut !== cochees[0]!.debut || p.fin !== cochees[0]!.fin);
  const recopier = () => {
    const modele = plages[premierCoche];
    if (!modele) return;
    setPlages((l) => l.map((p) => (p.actif ? { ...p, debut: modele.debut, fin: modele.fin } : p)));
    // Un changement d'état sans frappe : la fiche est tout de même modifiée.
    proprietes.onInput();
  };

  useRaccourci({
    touche: 'Enter',
    ctrl: true,
    dansChamp: true,
    libelle: 'Enregistrer la fiche',
    actif: !enCours,
    action: () => {
      // Comme la soumission native : seulement depuis le formulaire lui-même.
      const f = proprietes.ref.current;
      if (!f?.contains(document.activeElement)) return false;
      f.requestSubmit();
    },
  });

  const allerAuChamp = (id: string) => (ev: React.MouseEvent) => {
    ev.preventDefault();
    document.getElementById(id)?.focus();
  };

  const statut = enCours ? null : modifie ? (
    <span className="text-encre-2">Modifications non enregistrées</span>
  ) : etat?.ok ? (
    <span className="text-encre-3">{etat.message ?? 'Fiche enregistrée.'}</span>
  ) : null;

  return (
    // Marge basse de défilement égale à la hauteur de la barre collée (--barre) : un champ atteint au clavier
    // s'arrête au-dessus de « Enregistrer la fiche », jamais dessous.
    <form
      {...proprietes}
      aria-label="Fiche de l’entreprise"
      className="grid gap-12 [--barre:4rem] [&_:is(input,textarea,select,summary)]:scroll-mb-(--barre)"
    >
      <ChampConnu valeur={fiche.modifieLe.toISOString()} />
      <section aria-labelledby="titre-mina" className="grid max-w-[44rem] gap-6">
        <TitreSection id="titre-mina">Ce que {nomAssistante} dit de l’entreprise</TitreSection>
        <p className="max-w-[62ch] text-sm text-encre-2">
          Un champ laissé vide n’est pas transmis : {nomAssistante} n’en parle pas et n’invente rien.
        </p>
        <Champ libelle="Nom" htmlFor="nom" erreur={e.nom}>
          <Saisie id="nom" name="nom" defaultValue={fiche.nom} required maxLength={80} autoComplete="off" />
        </Champ>
        <Champ libelle="L’offre, en une phrase" htmlFor="offre" erreur={e.offre} aide="Ce que l’entreprise propose, dit simplement." complement={compteur('offre')}>
          <ZoneTexte id="offre" name="offre" defaultValue={fiche.offre} onInput={suivre('offre')} />
        </Champ>
        <Champ libelle="Pour qui" htmlFor="cible" erreur={e.cible} aide="Les prospects visés : métier, taille, situation." complement={compteur('cible')}>
          <ZoneTexte id="cible" name="cible" defaultValue={fiche.cible} onInput={suivre('cible')} />
        </Champ>
        <Champ
          libelle="Ce qui fait la différence"
          htmlFor="arguments"
          erreur={e.arguments}
          aide={`Trois ou quatre arguments. ${nomAssistante} en choisit un selon ce que dit le prospect.`}
          complement={compteur('arguments')}
        >
          <ZoneTexte id="arguments" name="arguments" defaultValue={fiche.arguments} onInput={suivre('arguments')} />
        </Champ>
        <Champ
          libelle="Consigne sur le prix"
          htmlFor="prixConsigne"
          erreur={e.prixConsigne}
          aide={`Ce que ${nomAssistante} a le droit d’en dire au téléphone.`}
          complement={compteur('prixConsigne')}
        >
          <ZoneTexte id="prixConsigne" name="prixConsigne" defaultValue={fiche.prixConsigne} onInput={suivre('prixConsigne')} />
        </Champ>
        <Champ libelle="À ne jamais dire ni promettre" htmlFor="interdits" erreur={e.interdits} complement={compteur('interdits')}>
          <ZoneTexte id="interdits" name="interdits" defaultValue={fiche.interdits} onInput={suivre('interdits')} />
        </Champ>
        <Champ
          libelle="Informations complémentaires"
          htmlFor="complements"
          erreur={e.complements}
          aide={`Ce que ${nomAssistante} peut dire si la conversation y mène, par exemple « Parking : gratuit devant le gîte ».`}
          complement={compteur('complements')}
        >
          <ZoneTexte id="complements" name="complements" defaultValue={fiche.complements} onInput={suivre('complements')} />
        </Champ>
      </section>

      <section aria-labelledby="titre-rdv" className="grid max-w-[44rem] gap-6">
        <TitreSection id="titre-rdv">Règles de rendez-vous</TitreSection>
        <Champ
          libelle="Avec qui ont lieu les visios"
          htmlFor="interlocuteur"
          erreur={e.interlocuteur}
          aide={
            interlocuteur.trim()
              ? `${nomAssistante} l’annonce au prospect : « une visio avec ${interlocuteur.trim()} ».`
              : `Champ vide : ${nomAssistante} parlera d’une visio avec un membre de l’équipe.`
          }
        >
          <Saisie
            id="interlocuteur"
            name="interlocuteur"
            defaultValue={fiche.interlocuteur}
            onInput={(ev) => setInterlocuteur(ev.currentTarget.value)}
            placeholder="Prénom"
            maxLength={60}
            autoComplete="off"
            className="max-w-[20rem]"
          />
        </Champ>
        <div className="grid gap-6 sm:grid-cols-3">
          <Champ libelle="Durée" htmlFor="dureeRendezVousMinutes" erreur={e.dureeRendezVousMinutes}>
            <Selection id="dureeRendezVousMinutes" name="dureeRendezVousMinutes" defaultValue={fiche.dureeRendezVousMinutes}>
              {[...new Set([15, 20, 30, 45, 60, fiche.dureeRendezVousMinutes])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </Selection>
          </Champ>
          <Champ libelle="Pas avant" htmlFor="delaiMinimumHeures" erreur={e.delaiMinimumHeures} aide="heures après l’appel">
            <Saisie id="delaiMinimumHeures" name="delaiMinimumHeures" type="number" min={0} max={168} defaultValue={fiche.delaiMinimumHeures} className="font-mono" />
          </Champ>
          <Champ libelle="Pas au-delà de" htmlFor="horizonJours" erreur={e.horizonJours} aide="jours après l’appel">
            <Saisie id="horizonJours" name="horizonJours" type="number" min={1} max={60} defaultValue={fiche.horizonJours} className="font-mono" />
          </Champ>
        </div>

        <fieldset className="grid gap-3" aria-describedby={e.plages ? 'plages-erreur resume-plages' : 'resume-plages'}>
          <legend className="mb-3 text-sm font-medium">Plages autorisées</legend>
          <div className="grid border-y border-filet">
            {plages.map((p, i) => {
              const jour = i + 1;
              const nomJour = NOMS_JOURS[i]!;
              const inversee = p.actif && p.debut >= p.fin;
              return (
                <div key={jour} className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-filet py-2 last:border-b-0 ${p.actif ? '' : 'text-encre-3'}`}>
                  <label className="flex w-[7.5rem] items-center gap-2.5 text-md pointer-coarse:min-h-11">
                    <input
                      id={`plage-${jour}`}
                      type="checkbox"
                      name={`jour-${jour}`}
                      checked={p.actif}
                      onChange={(ev) => changerPlage(i, { actif: ev.target.checked })}
                      aria-invalid={e.plages && i === premierCoche ? true : undefined}
                      className="size-4 accent-[var(--encre)]"
                    />
                    {nomJour}
                  </label>
                  <div className="flex items-center gap-2">
                    <ChoixHeure name={`debut-${jour}`} valeur={p.debut} libelle={`${nomJour}, début`} actif={p.actif} onChange={(v) => changerPlage(i, { debut: v })} />
                    <span aria-hidden="true" className="text-encre-3">
                      à
                    </span>
                    <ChoixHeure
                      name={`fin-${jour}`}
                      valeur={p.fin}
                      libelle={`${nomJour}, fin`}
                      actif={p.actif}
                      invalide={inversee}
                      onChange={(v) => changerPlage(i, { fin: v })}
                    />
                  </div>
                  {inversee ? <span className="text-sm text-alerte">La fin doit venir après le début.</span> : null}
                  {i === premierCoche && recopiable ? (
                    <Action ton="discret" onClick={recopier} className="-ml-1.5 sm:ml-auto">
                      Recopier sur les jours cochés
                    </Action>
                  ) : null}
                </div>
              );
            })}
          </div>
          {e.plages ? (
            <p id="plages-erreur" className="text-sm text-alerte">
              {e.plages}
            </p>
          ) : null}
          <p id="resume-plages" className="text-sm text-encre-3">
            <ResumePlages plages={plages} fuseau={fiche.fuseau} />
          </p>
        </fieldset>
      </section>

      {/* self-end : la barre garde la hauteur de son contenu au lieu de s'étirer sur sa rangée de grille. */}
      <div className="sticky bottom-0 z-10 -mx-(--gouttiere) -mb-24 grid gap-2 self-end border-t border-filet bg-fond px-(--gouttiere) py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {fautifs.length > 0 ? (
          <Message ton="alerte" className="max-w-[44rem]">
            {fautifs.length} {fautifs.length > 1 ? 'champs à corriger' : 'champ à corriger'} :{' '}
            {fautifs.map((c, i) => (
              <span key={c.cle}>
                {i > 0 ? ', ' : ''}
                <a href={`#${c.id}`} onClick={allerAuChamp(c.id)} className="underline underline-offset-4">
                  {c.libelle}
                </a>
              </span>
            ))}
          </Message>
        ) : null}
        {etat?.conflit && etat.message ? (
          <MessageConflit
            message={etat.message}
            jeton={etat.conflit.jeton}
            onRecharger={recharger}
            rechargement={rechargement}
            desactive={enCours}
            className="max-w-[44rem]"
          />
        ) : etat && !etat.ok && etat.message ? (
          <Message ton="alerte" className="max-w-[44rem]">
            {etat.message}
          </Message>
        ) : null}
        <div className="flex max-w-[44rem] flex-wrap items-center justify-between gap-x-6 gap-y-1">
          <Action type="submit" ton="fort" touche="Ctrl Entrée" enCours={enCours} libelleEnCours="Enregistrement…" disabled={enCours} className="-ml-1.5">
            Enregistrer la fiche
          </Action>
          <p role="status" className="text-sm">
            {statut}
          </p>
        </div>
      </div>
    </form>
  );
}
