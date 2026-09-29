/**
 * Accueil : la régie de la journée.
 *
 * THÈSE : l'accueil est la régie de la journée, avec l'appel en cours en sous-titre, la journée en frise et
 * les appels en liste filtrable. Il refuse le tableau de bord à cartes et chiffres-clés.
 * MONDE : graphite chaud #121110, texte #f2f0eb, rouge antenne #ff6a4d pour ce qui vit et rien d'autre,
 * brique pour les erreurs. Chivo et Chivo Mono. Filets d'un pixel, actions en texte précédées de leur
 * touche, filtres en texte souligné, recherche sur filet bas, coins de 6 px au plus.
 * RÉCIT : l'opérateur voit l'appel en cours, situe la journée et retrouve n'importe quel appel en deux
 * gestes ; le spectateur, par-dessus son épaule, lit la phrase de Mina. Sans appel, la bande dit une seule
 * situation (ligne coupée, plafond, bilan qui tombe, campagne entre deux appels, suspendue ou prête, ligne
 * libre) et propose le geste suivant, dans la même forme que la bande vivante.
 * PREMIER ÉCRAN : barre de 64 px ; bande de l'appel en cours (identité à gauche, chrono et actions à droite,
 * phrase de Mina centrée en 34 px, piste de 40 px) ; frise de 9 h à 19 h dont la hauteur des traits suit
 * l'étape atteinte du script (blanc : rendez-vous pris) ; tableau des appels du jour, 38 px par ligne.
 * FORME : esquisse G du canevas, choisie par l'opérateur parmi une vingtaine ; pas de tirage concept-seed.
 *
 * RAPPELS : sous la bande, « À rappeler aujourd'hui » liste les rappels convenus datés du jour et en retard ;
 * chaque ligne ouvre la fiche du prospect, d'où l'appel part. Sans rappel, rien ne s'affiche.
 *
 * Données : la page lit les appels, les campagnes et les rappels du jour elle-même, HORS de la frontière de la bande :
 * une ligne muette (jusqu'à 15 s) ne bloque jamais la frise ni le tableau.
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';
import type { IdentiteAppel } from '@/components/bande-appel';
import { Page } from '@/components/ui';
import {
  appelsDuJour,
  appelsTelephoneRecents,
  appelVivant,
  campagnesDuJour,
  etatLigneServeur,
  premiereUtilisation,
  rechercherDansLaJournee,
  type AppelDuJour,
  type CampagneJour,
} from '@/lib/accueil';
import { rappelsDuJour } from '@/lib/rappels';
import { BandeAccueil } from './_accueil/bande-accueil';
import { FrontiereLigne } from './_accueil/frontiere-ligne';
import { RappelsDuJour } from './_accueil/rappels-du-jour';
import { Journee } from './_accueil/journee';
import { campagneTelephoneEnCours, situationAccueil } from './_accueil/situation';
import { SqueletteBande } from './_accueil/squelette-bande';
import { SuiviAccueil } from './_accueil/suivi-accueil';

export const metadata: Metadata = { title: 'Régie de la journée' };

type Parametres = { q?: string | string[]; issue?: string | string[]; simules?: string | string[] };
const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Accueil({ searchParams }: { searchParams: Promise<Parametres> }) {
  const p = await searchParams;
  const q = un(p.q)?.trim() ?? '';
  const [journee, campagnes, resultats, rappels] = await Promise.all([
    appelsDuJour(),
    campagnesDuJour(),
    q.length >= 3 ? rechercherDansLaJournee(q) : null,
    rappelsDuJour(),
  ]);

  return (
    <Page>
      <h1 className="sr-only">Régie de la journée</h1>
      <div className="pt-[18px]">
        <FrontiereLigne>
          <Suspense fallback={<SqueletteBande />}>
            <BandeServeur appels={journee.appels} campagnes={campagnes} maintenant={journee.maintenant} />
          </Suspense>
        </FrontiereLigne>
      </div>
      <RappelsDuJour rappels={rappels.rappels} sansDate={rappels.sansDate} maintenant={journee.maintenant} />
      <Journee
        appels={journee.appels}
        campagnes={campagnes}
        maintenant={journee.maintenant}
        filtres={{ issue: un(p.issue) ?? null, simules: un(p.simules) ?? null }}
        recherche={resultats ? { q, resultats } : null}
        texteInitial={q}
      />
      <SuiviAccueil appels={journee.appels} />
    </Page>
  );
}

/** La bande du haut : lit la ligne (le pont peut mettre 15 s) et l'appel en cours, puis choisit la situation. */
async function BandeServeur({ appels, campagnes, maintenant }: { appels: AppelDuJour[]; campagnes: CampagneJour[]; maintenant: string }) {
  const [ligne, recents, comptes] = await Promise.all([etatLigneServeur(), appelsTelephoneRecents(), premiereUtilisation()]);
  const vivant = ligne.joignable && ligne.appelId ? await appelVivant(ligne.appelId) : null;
  const situation = situationAccueil({
    ligne,
    appelVivant: vivant,
    appels,
    campagnes,
    premiereUtilisation: comptes.entreprises === 0,
    maintenant: Date.parse(maintenant),
  });

  // Appel téléphone en analyse : même identité que pendant l'appel (version, numéro masqué), la bande ne bouge pas.
  let identiteFin: IdentiteAppel | null = null;
  if (situation.type === 'fin-appel' && situation.appel.statut === 'traitement' && situation.appel.ligne === 'bluetooth') {
    const a = await appelVivant(situation.appel.id);
    if (a) {
      identiteFin = {
        prospect: a.prospect,
        societe: a.societe,
        entreprise: a.entreprise,
        version: a.version,
        numeroMasque: a.numeroMasque,
        lien: `/appels/${a.id}?depuis=%2F`,
      };
    }
  }

  return (
    <BandeAccueil
      situation={situation}
      identiteFin={identiteFin}
      ligne={ligne}
      telephoneRecents={recents}
      campagneTelephone={campagneTelephoneEnCours(campagnes)}
    />
  );
}
