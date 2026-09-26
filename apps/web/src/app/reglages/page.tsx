import { desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EnTetePage, Message, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { appels, prospects, rendezVous } from '@/db/schema';
import { etatAgenda } from '@/lib/agenda';
import { clientGoogle, connexion } from '@/lib/google';
import { BoutonDeconnecter } from './bouton-deconnecter';
import { BoutonRecreer, BoutonRelire } from './boutons-agenda';

export const metadata: Metadata = { title: 'Réglages' };

const date = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

const MESSAGES: Record<string, string> = {
  connecte: 'L’API Google Agenda est connectée.',
  refuse: 'La connexion a été refusée : le jeton de sécurité ne correspondait pas. Recommence.',
  annule: 'Connexion annulée côté Google.',
};

export default async function PageReglages({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google } = await searchParams;
  const [client, api, etat, rdvs] = await Promise.all([
    clientGoogle(),
    connexion(),
    etatAgenda(),
    db
      .select({ rdv: rendezVous, prospect: prospects.nom, appelId: appels.id })
      .from(rendezVous)
      .innerJoin(appels, eq(appels.id, rendezVous.appelId))
      .leftJoin(prospects, eq(prospects.id, appels.prospectId))
      .orderBy(desc(rendezVous.debut))
      .limit(20),
  ]);

  return (
    <>
      <EnTetePage titre="Réglages" />
      <div className="grid max-w-[48rem] gap-14">
        <section className="grid gap-5">
          <TitreSection>Agenda</TitreSection>
          <p className="max-w-[62ch] text-encre-2">
            Mina propose des créneaux libres sur l’ensemble de tes calendriers. L’agenda est relu avant les appels (toutes les dix minutes au
            plus) ; un rendez-vous réservé pendant un appel est inscrit dans Google juste après.
          </p>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-[12rem_1fr]">
            <dt className="text-sm text-encre-3">Source</dt>
            <dd>{api ? 'API Google Agenda' : 'Connecteur Google Agenda de Claude (MCP)'}</dd>
            <dt className="text-sm text-encre-3">Dernière lecture</dt>
            <dd>
              {etat ? (
                <>
                  <span className="font-mono">{date.format(etat.synchroniseLe)}</span>
                  <span className="text-encre-3"> · {etat.occupations.length} plages occupées sur les trois semaines à venir</span>
                </>
              ) : (
                <span className="text-encre-3">jamais</span>
              )}
            </dd>
          </dl>
          {etat?.erreur ? <Message ton="alerte">Dernière lecture en échec : {etat.erreur}</Message> : null}
          <BoutonRelire />
        </section>

        <section className="grid gap-3">
          <TitreSection>Rendez-vous pris par Mina</TitreSection>
          {rdvs.length === 0 ? (
            <p className="text-sm text-encre-3">Aucun pour l’instant.</p>
          ) : (
            <ul>
              {rdvs.map(({ rdv, prospect, appelId }) => (
                <li key={rdv.id} className="grid grid-cols-[8.5rem_minmax(0,1fr)_auto] items-baseline gap-4 border-b border-filet py-3">
                  <span className="font-mono text-sm">{date.format(rdv.debut)}</span>
                  <Link href={`/appels/${appelId}`} className="truncate hover:underline">
                    {prospect ?? 'Prospect'}
                  </Link>
                  <span className="text-sm text-encre-3">
                    {rdv.statut === 'cree' ? 'Dans l’agenda' : rdv.statut === 'a-creer' ? 'Inscription…' : <BoutonRecreer rendezVousId={rdv.id} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-4">
          <TitreSection>API Google (facultatif)</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            Plus rapide que le connecteur, mais demande un client OAuth Google. Une fois connectée, elle remplace le connecteur.
          </p>
          {google && MESSAGES[google] ? <Message ton={google === 'connecte' ? 'neutre' : 'alerte'}>{MESSAGES[google]}</Message> : null}
          {!client ? (
            <p className="text-sm text-encre-3">Non configurée (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET et ORIGINE_APP dans .env).</p>
          ) : api ? (
            <div className="grid gap-2">
              <p className="text-sm">Connectée{api.email ? ` en tant que ${api.email}` : ''}.</p>
              <BoutonDeconnecter />
            </div>
          ) : (
            <a href="/google/connexion" className="text-sm underline decoration-filet-fort underline-offset-4 hover:decoration-encre-3">
              Connecter l’API Google Agenda
            </a>
          )}
        </section>
      </div>
    </>
  );
}
