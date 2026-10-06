'use client';

import type { FicheProspect } from '@autocalled/domain';
import { MOTS_MAX_CONTEXTE } from '@autocalled/domain';
import { useState } from 'react';
import { BarreActions } from '@/components/barre-actions';
import { ChampConnu, MessageConflit, useRechargement } from '@/components/conflit';
import { Action, Champ, Compteur, LienAction, Message, Saisie, ZoneTexte } from '@/components/ui';
import { useFormulaire } from '@/components/use-formulaire';
import type { EtatFormulaire } from '@/lib/formulaire';
import { enregistrerProspect } from '../../actions';

type Prospect = Omit<FicheProspect, 'telephone'> & { telephone: string; entrepriseId: string; majLe: Date };
type Proprietes = { prospect: Prospect; retour: string; files: string[] };

export function FormulaireProspect(props: Proprietes) {
  const { cle, recharger, enCours } = useRechargement();
  return <Formulaire key={cle} {...props} recharger={recharger} rechargement={enCours} />;
}

function Formulaire({ prospect, retour, files, recharger, rechargement }: Proprietes & { recharger: () => void; rechargement: boolean }) {
  const { etat, enCours, modifie, proprietes } = useFormulaire<EtatFormulaire>(
    enregistrerProspect.bind(null, prospect.entrepriseId, prospect.id), null, { avertirSiQuitte: true },
  );
  const erreurs = etat?.erreurs ?? {};
  const [mots, setMots] = useState(prospect.contexte.split(/\s+/).filter(Boolean).length);
  const messages = etat?.conflit && etat.message ? (
    <MessageConflit message={etat.message} jeton={etat.conflit.jeton} onRecharger={recharger} rechargement={rechargement} desactive={enCours} />
  ) : etat?.message && !etat.ok ? <Message ton="alerte">{etat.message}</Message> : null;

  return (
    <form {...proprietes} className="grid gap-8">
      <ChampConnu valeur={prospect.majLe.toISOString()} />
      <fieldset disabled={enCours || rechargement} className="grid max-w-[44rem] gap-6">
        {files.length ? <Message ton="alerte">Ce prospect attend dans {files.join(', ')}. Les changements seront utilisés dès son prochain appel, y compris le nouveau numéro.</Message> : null}
        <Champ libelle="Nom" htmlFor="nom" erreur={erreurs.nom}>
          <Saisie id="nom" name="nom" defaultValue={prospect.nom} required maxLength={120} autoComplete="off" />
        </Champ>
        <div className="grid gap-6 sm:grid-cols-2">
          <Champ libelle="Société" htmlFor="societe" erreur={erreurs.societe}>
            <Saisie id="societe" name="societe" defaultValue={prospect.societe ?? ''} maxLength={120} autoComplete="off" />
          </Champ>
          <Champ libelle="Rôle" htmlFor="role" erreur={erreurs.role}>
            <Saisie id="role" name="role" defaultValue={prospect.role ?? ''} maxLength={120} autoComplete="off" />
          </Champ>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <Champ libelle="Téléphone" htmlFor="telephone" erreur={erreurs.telephone}>
            <Saisie id="telephone" name="telephone" type="tel" defaultValue={prospect.telephone} required maxLength={40} autoComplete="off" className="font-mono" />
          </Champ>
          <Champ libelle="E-mail" htmlFor="email" erreur={erreurs.email}>
            <Saisie id="email" name="email" type="email" defaultValue={prospect.email ?? ''} maxLength={200} autoComplete="off" />
          </Champ>
        </div>
        <Champ libelle="Contexte" htmlFor="contexte" erreur={erreurs.contexte} complement={<Compteur valeur={mots} max={MOTS_MAX_CONTEXTE} />}>
          <ZoneTexte id="contexte" name="contexte" defaultValue={prospect.contexte} maxLength={32 * 1024} rows={8} onInput={(e) => setMots(e.currentTarget.value.split(/\s+/).filter(Boolean).length)} />
        </Champ>
      </fieldset>
      <BarreActions messages={messages} statut={modifie ? 'Modifications non enregistrées' : etat?.ok ? etat.message : null} className="[&>div]:max-w-[44rem]">
        <Action type="submit" ton="fort" enCours={enCours} libelleEnCours="Enregistrement…" disabled={enCours || rechargement}>Enregistrer la fiche</Action>
        <LienAction href={retour} ton="discret">Revenir au prospect</LienAction>
      </BarreActions>
    </form>
  );
}
