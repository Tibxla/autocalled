import Link from 'next/link';
import { heure, jourCourt } from '@/components/format-appel';
import { EtatVide, LienAction } from '@/components/ui';
import { BoutonRecreer } from './boutons-agenda';

/**
 * Les rendez-vous pris par Mina pendant ses appels, à venir puis passés, avec l'état de leur inscription
 * dans Google Agenda. Sans directive : rendu côté serveur, seul « Réessayer » est un composant client.
 */

export type LigneRendezVous = {
  rdv: {
    id: string;
    debut: Date;
    email: string | null;
    lienVisio: string | null;
    statut: 'a-creer' | 'cree' | 'echec';
    erreur: string | null;
    creeLe: Date;
  };
  prospect: string | null;
  appelId: string;
};

/** Au-delà, une inscription « en cours » est sans doute restée en plan : « Réessayer » apparaît. */
const INSCRIPTION_LENTE_MIN = 15;

function depuis(minutes: number): string {
  if (minutes < 1) return 'moins d’une minute';
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 48) return `${heures} h`;
  return `${Math.floor(heures / 24)} jours`;
}

export function RendezVousMina({
  rdvs,
  maintenant,
  limite,
  sansReservation = 0,
}: {
  rdvs: LigneRendezVous[];
  maintenant: Date;
  limite: number;
  /** Appels réels à l'issue Rendez-vous pris sans aucune réservation dans l'agenda. */
  sansReservation?: number;
}) {
  const ecart =
    sansReservation > 0 ? (
      <p className="flex flex-wrap items-center gap-x-3 text-sm text-encre-2">
        <span>
          <span className="font-mono">{sansReservation}</span>{' '}
          {sansReservation > 1 ? 'appels ont l’issue Rendez-vous pris' : 'appel a l’issue Rendez-vous pris'} sans réservation dans l’agenda.
        </span>
        <LienAction ton="discret" href="/appels?issue=rendez-vous-pris" className="-my-1.5">
          Voir ces appels
        </LienAction>
      </p>
    ) : null;
  if (rdvs.length === 0) {
    return (
      <div className="grid gap-3">
        <EtatVide titre="Aucun rendez-vous réservé dans l’agenda pour l’instant.">
          Quand un prospect accepte un créneau pendant un appel, le rendez-vous apparaît ici et part dans l’agenda, avec l’invitation à son
          adresse.
        </EtatVide>
        {ecart}
      </div>
    );
  }
  // La lecture arrive du plus tardif au plus ancien : les prochains d'abord pour « À venir ».
  const aVenir = rdvs.filter((r) => r.rdv.debut.getTime() >= maintenant.getTime()).reverse();
  const passes = rdvs.filter((r) => r.rdv.debut.getTime() < maintenant.getTime());
  return (
    <div className="grid gap-8">
      <Groupe titre="À venir" lignes={aVenir} maintenant={maintenant} vide="Aucun rendez-vous à venir." />
      {passes.length ? <Groupe titre="Passés" lignes={passes} maintenant={maintenant} /> : null}
      {rdvs.length >= limite ? <p className="text-sm text-encre-3">Les {limite} rendez-vous les plus récents.</p> : null}
      {ecart}
    </div>
  );
}

function Groupe({ titre, lignes, maintenant, vide }: { titre: string; lignes: LigneRendezVous[]; maintenant: Date; vide?: string }) {
  return (
    <div className="grid gap-1">
      <h3 className="text-md font-semibold">
        {titre}
        <span className="ml-2 font-mono font-normal text-encre-3">{lignes.length}</span>
      </h3>
      {lignes.length === 0 ? (
        <p className="border-t border-filet py-2.5 text-sm text-encre-3">{vide}</p>
      ) : (
        <ul className="border-t border-filet">
          {lignes.map((l) => (
            <Ligne key={l.rdv.id} ligne={l} maintenant={maintenant} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Ligne({ ligne: { rdv, prospect, appelId }, maintenant }: { ligne: LigneRendezVous; maintenant: Date }) {
  const attente = Math.max(0, Math.floor((maintenant.getTime() - rdv.creeLe.getTime()) / 60_000));
  const lente = rdv.statut === 'a-creer' && attente >= INSCRIPTION_LENTE_MIN;
  return (
    <li className="grid gap-x-4 gap-y-0.5 border-b border-filet py-2 sm:min-h-[38px] sm:grid-cols-[8.5rem_minmax(0,1fr)_auto] sm:items-baseline">
      <time dateTime={rdv.debut.toISOString()} className="font-mono text-xs text-encre-2">
        {jourCourt(rdv.debut)} {heure(rdv.debut)}
      </time>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-3">
        <Link href={`/appels/${appelId}`} className="min-w-0 truncate decoration-souligne underline-offset-4 hover:underline">
          {prospect ?? 'Prospect sans nom'}
        </Link>
        {rdv.email ? <span className="min-w-0 truncate font-mono text-xs text-encre-3">{rdv.email}</span> : null}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-4 text-sm sm:justify-end">
        {rdv.lienVisio ? (
          <a
            href={rdv.lienVisio}
            target="_blank"
            rel="noopener noreferrer"
            className="text-encre-2 decoration-souligne underline-offset-4 hover:text-encre hover:underline"
          >
            Ouvrir la visio
          </a>
        ) : null}
        {rdv.statut === 'cree' ? (
          <span className="text-encre-3">dans l’agenda</span>
        ) : rdv.statut === 'a-creer' ? (
          <span className="text-encre-2">inscription en cours depuis {depuis(attente)}</span>
        ) : (
          <span className="text-alerte">échec</span>
        )}
      </span>
      {rdv.statut === 'echec' || lente ? (
        <span className="flex flex-wrap items-baseline gap-x-3 text-sm sm:col-span-2 sm:col-start-2">
          {rdv.erreur ? <span className="min-w-0 text-alerte">{rdv.erreur}</span> : null}
          {lente && !rdv.erreur ? <span className="text-encre-3">L’inscription tarde : relance-la.</span> : null}
          <BoutonRecreer rendezVousId={rdv.id} />
        </span>
      ) : null}
    </li>
  );
}
