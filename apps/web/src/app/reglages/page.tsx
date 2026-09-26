import type { Metadata } from 'next';
import { EnTetePage, Message, TitreSection } from '@/components/ui';
import { clientGoogle, connexion } from '@/lib/google';
import { BoutonDeconnecter } from './bouton-deconnecter';

export const metadata: Metadata = { title: 'Réglages' };

const MESSAGES: Record<string, string> = {
  connecte: 'Google Agenda est connecté.',
  refuse: 'La connexion a été refusée : le jeton de sécurité ne correspondait pas. Recommence.',
  annule: 'Connexion annulée côté Google.',
};

export default async function PageReglages({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google } = await searchParams;
  const [client, actuelle] = [clientGoogle(), await connexion()];

  return (
    <>
      <EnTetePage titre="Réglages" />
      <section className="grid max-w-[44rem] gap-5">
        <TitreSection>Google Agenda</TitreSection>
        {google && MESSAGES[google] ? <Message ton={google === 'connecte' ? 'neutre' : 'alerte'}>{MESSAGES[google]}</Message> : null}
        <p className="max-w-[62ch] text-encre-2">
          Mina lit tes disponibilités sur tous tes calendriers, et réserve les rendez-vous dans un calendrier dédié, « Autocalled », que
          l’application crée elle-même. Elle n’a accès ni au contenu de tes autres événements ni à ton adresse de messagerie.
        </p>
        {!client ? (
          <Message ton="alerte">
            Il manque le client OAuth Google : renseigne GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET et ORIGINE_APP dans le fichier .env.
          </Message>
        ) : actuelle ? (
          <div className="grid gap-2">
            <p>
              Connecté{actuelle.email ? (
                <>
                  {' '}
                  en tant que <span className="font-mono text-sm">{actuelle.email}</span>
                </>
              ) : null}
              .
            </p>
            <BoutonDeconnecter />
          </div>
        ) : (
          <a
            href="/google/connexion"
            className="inline-flex h-9 items-center justify-self-start rounded-md bg-encre px-3.5 text-sm font-medium text-fond shadow-[0_1px_2px_rgb(0_0_0/0.12)] transition-colors duration-150 hover:bg-encre/88"
          >
            Connecter Google Agenda
          </a>
        )}
      </section>
    </>
  );
}
