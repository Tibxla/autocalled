'use client';

import type { PlageHoraire } from '@autocalled/domain';
import { useActionState } from 'react';
import { Bouton, Champ, Message, Saisie, Selection, TitreSection, ZoneTexte } from '@/components/ui';
import { enregistrerFiche } from './actions';

const NOMS_JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/** Demi-heures de 7 h à 22 h : le même pas que les créneaux proposés au téléphone. */
const HEURES = Array.from({ length: 31 }, (_, i) => {
  const minutes = 7 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

function ChoixHeure({ name, defaut, libelle }: { name: string; defaut: string; libelle: string }) {
  return (
    <Selection name={name} defaultValue={defaut} aria-label={libelle} className="max-w-28 font-mono">
      {HEURES.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </Selection>
  );
}

interface Fiche {
  id: string;
  nom: string;
  offre: string;
  cible: string;
  arguments: string;
  prixConsigne: string;
  interdits: string;
  dureeRendezVousMinutes: number;
  plagesRendezVous: PlageHoraire[];
  delaiMinimumHeures: number;
  horizonJours: number;
  fuseau: string;
}

export function FormulaireFiche({ fiche }: { fiche: Fiche }) {
  const [etat, action, enCours] = useActionState(enregistrerFiche.bind(null, fiche.id), null);
  const e = etat?.erreurs ?? {};
  const plageDu = (jour: number) => fiche.plagesRendezVous.find((p) => p.jour === jour);

  return (
    <form action={action} className="grid gap-14">
      <section className="grid gap-6">
        <TitreSection>Ce que Mina dit de l’entreprise</TitreSection>
        <div className="grid max-w-[44rem] gap-6">
          <Champ libelle="Nom" htmlFor="nom" erreur={e.nom}>
            <Saisie id="nom" name="nom" defaultValue={fiche.nom} required aria-invalid={e.nom ? true : undefined} />
          </Champ>
          <Champ libelle="L’offre, en une phrase" htmlFor="offre" erreur={e.offre} aide="Ce que l’entreprise propose, dit simplement.">
            <ZoneTexte id="offre" name="offre" defaultValue={fiche.offre} />
          </Champ>
          <Champ libelle="Pour qui" htmlFor="cible" erreur={e.cible}>
            <ZoneTexte id="cible" name="cible" defaultValue={fiche.cible} />
          </Champ>
          <Champ
            libelle="Ce qui fait la différence"
            htmlFor="arguments"
            erreur={e.arguments}
            aide="Trois ou quatre arguments. Mina en choisit un selon ce que dit le prospect."
          >
            <ZoneTexte id="arguments" name="arguments" defaultValue={fiche.arguments} />
          </Champ>
          <Champ
            libelle="Consigne sur le prix"
            htmlFor="prixConsigne"
            erreur={e.prixConsigne}
            aide="Ce que Mina a le droit d’en dire au téléphone."
          >
            <ZoneTexte id="prixConsigne" name="prixConsigne" defaultValue={fiche.prixConsigne} />
          </Champ>
          <Champ libelle="À ne jamais dire ni promettre" htmlFor="interdits" erreur={e.interdits}>
            <ZoneTexte id="interdits" name="interdits" defaultValue={fiche.interdits} />
          </Champ>
        </div>
      </section>

      <section className="grid gap-6">
        <TitreSection>Règles de rendez-vous</TitreSection>
        <div className="grid max-w-[44rem] gap-6">
          <div className="grid gap-6 sm:grid-cols-3">
            <Champ libelle="Durée" htmlFor="dureeRendezVousMinutes" erreur={e.dureeRendezVousMinutes}>
              <Selection id="dureeRendezVousMinutes" name="dureeRendezVousMinutes" defaultValue={fiche.dureeRendezVousMinutes}>
                {[15, 20, 30, 45, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </Selection>
            </Champ>
            <Champ libelle="Pas avant" htmlFor="delaiMinimumHeures" erreur={e.delaiMinimumHeures} aide="heures après l’appel">
              <Saisie id="delaiMinimumHeures" name="delaiMinimumHeures" type="number" min={0} max={168} defaultValue={fiche.delaiMinimumHeures} />
            </Champ>
            <Champ libelle="Pas au-delà de" htmlFor="horizonJours" erreur={e.horizonJours} aide="jours après l’appel">
              <Saisie id="horizonJours" name="horizonJours" type="number" min={1} max={60} defaultValue={fiche.horizonJours} />
            </Champ>
          </div>

          <fieldset className="grid gap-3">
            <legend className="mb-3 text-sm font-medium">Plages autorisées</legend>
            <div className="grid divide-y divide-filet border-y border-filet">
              {NOMS_JOURS.map((nomJour, i) => {
                const jour = i + 1;
                const plage = plageDu(jour);
                return (
                  <div key={jour} className="grid grid-cols-[8rem_1fr] items-center gap-4 py-2.5 has-[input[type=checkbox]:not(:checked)]:text-encre-3">
                    <label className="flex items-center gap-2.5 text-sm">
                      <input type="checkbox" name={`jour-${jour}`} defaultChecked={Boolean(plage)} className="size-4 accent-[var(--encre)]" />
                      {nomJour}
                    </label>
                    <div className="flex items-center gap-2 text-sm">
                      <ChoixHeure name={`debut-${jour}`} defaut={plage?.debut ?? '14:00'} libelle={`${nomJour}, début`} />
                      <span aria-hidden="true">–</span>
                      <ChoixHeure name={`fin-${jour}`} defaut={plage?.fin ?? '18:00'} libelle={`${nomJour}, fin`} />
                    </div>
                  </div>
                );
              })}
            </div>
            {e.plages ? <p className="text-sm text-alerte">{e.plages}</p> : null}
            <p className="text-sm text-encre-3">Heures de {fiche.fuseau.replace('_', ' ')}.</p>
          </fieldset>
        </div>
      </section>

      <div className="sticky bottom-0 -mx-5 flex items-center gap-4 border-t border-filet bg-fond/92 px-5 py-4 backdrop-blur-sm sm:-mx-8 sm:px-8">
        <Bouton type="submit" disabled={enCours}>
          {enCours ? 'Enregistrement…' : 'Enregistrer la fiche'}
        </Bouton>
        {etat?.message ? <Message ton={etat.ok ? 'neutre' : 'alerte'}>{etat.message}</Message> : null}
        {etat?.erreurs ? <Message ton="alerte">Certains champs sont à corriger.</Message> : null}
      </div>
    </form>
  );
}
