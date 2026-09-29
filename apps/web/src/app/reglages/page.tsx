import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { heure, jourCourt } from '@/components/format-appel';
import { EnTetePage, LigneDefinition, Message, Page, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { appels, rendezVous } from '@/db/schema';
import { calendrierConfigure, etatAgenda } from '@/lib/agenda';
import { derniereVersionAssistante } from '@/lib/assistante';
import { clientGoogle, connexion } from '@/lib/google';
import { journalMcpRecent, rendezVousRecents } from '@/lib/lecture';
import { assistantePourLaPage } from '@/lib/pages';
import { BoutonDeconnecter } from './bouton-deconnecter';
import { BoutonRelire } from './boutons-agenda';
import { JournalClaudeCode } from './journal-claude-code';
import { MessageGoogle } from './message-google';
import { RendezVousMina } from './rendez-vous-mina';

export const metadata: Metadata = { title: 'Réglages' };

/** La copie de l'agenda est relue avant les appels quand elle a plus de dix minutes (lib/agenda.ts). */
const FRAICHEUR_MINUTES = 10;
/** Limite par défaut de rendezVousRecents : au-delà, la liste le dit. */
const RENDEZ_VOUS_LUS = 20;

const JOUR_MOIS = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Europe/Paris',
});

function ilYA(minutes: number): string {
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 48) return `il y a ${heures} h`;
  return `il y a ${Math.floor(heures / 24)} jours`;
}

/** D'où vient la dernière configuration ElevenLabs consignée (versions_assistante). */
const ORIGINE_CONFIGURATION = {
  mcp: 'poussée par Claude Code',
  cli: 'poussée en ligne de commande',
  distante: 'rapatriée du tableau de bord ElevenLabs',
} as const;

const SECTION = 'grid scroll-mt-[calc(var(--hauteur-barre)+16px)] gap-5';

/**
 * Appels réels dont l'issue dit Rendez-vous pris sans aucune réservation liée dans l'agenda : Appels les compte
 * parmi les rendez-vous, cette page ne les montrerait pas. Même issue système que le filtre d'Appels.
 */
async function rendezVousSansReservation(): Promise<number> {
  const [ligne] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appels)
    .leftJoin(rendezVous, eq(rendezVous.appelId, appels.id))
    .where(
      and(
        isNull(rendezVous.appelId),
        ne(appels.ligne, 'simulation'),
        eq(appels.issueSysteme, 'rendez-vous-pris'),
      ),
    );
  return Number(ligne?.n ?? 0);
}

export default async function PageReglages({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google } = await searchParams;
  const [client, api, etat, rdvs, journal, sansReservation, assistante, configuration] = await Promise.all([
    clientGoogle(),
    connexion(),
    etatAgenda(),
    rendezVousRecents(),
    journalMcpRecent(100),
    rendezVousSansReservation(),
    assistantePourLaPage(),
    derniereVersionAssistante(),
  ]);
  const { nom } = assistante;
  const maintenant = new Date();
  const calendrier = calendrierConfigure();
  const age = etat ? Math.max(0, Math.floor((maintenant.getTime() - etat.synchroniseLe.getTime()) / 60_000)) : null;
  const plages = etat?.occupations.length ?? 0;

  return (
    <Page largeur="lecture">
      <EnTetePage titre="Réglages" sousTitre={`${nom}, l’agenda qu’elle lit, les rendez-vous qu’elle a pris, et ce que Claude Code a fait.`} />
      <div className="grid max-w-[48rem] gap-12">
        <nav aria-label="Sections de la page" className="-mt-2 flex flex-wrap gap-x-[22px] gap-y-1 text-md">
          <Ancre href="#assistante">Assistante</Ancre>
          <Ancre href="#agenda">Agenda</Ancre>
          <Ancre href="#rendez-vous" compte={rdvs.length}>
            Rendez-vous
          </Ancre>
          <Ancre href="#claude-code" compte={journal.length}>
            Claude Code
          </Ancre>
        </nav>

        <section id="assistante" aria-labelledby="titre-assistante" className={SECTION}>
          <TitreSection id="titre-assistante">Assistante</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            Son nom et sa première phrase valent dès l’appel suivant. Son prompt, sa voix et son tour de parole partent chez ElevenLabs par
            une poussée. Tout se règle depuis Claude Code, qui demande ton accord avant que rien ne change pour les prospects.
          </p>
          <dl className="border-t border-filet">
            <LigneDefinition intitule="Nom">{nom}</LigneDefinition>
            <LigneDefinition intitule="Premier message">
              « {assistante.premierMessage} »
              <span className="block text-sm text-encre-3">Ce qu’elle dit quand le prospect se tait au décroché.</span>
            </LigneDefinition>
            <LigneDefinition intitule="Dernière modification">
              {assistante.modifieLe ? (
                <>
                  <time dateTime={assistante.modifieLe.toISOString()} className="font-mono text-sm">
                    {jourCourt(assistante.modifieLe)} {heure(assistante.modifieLe)}
                  </time>
                  {assistante.modifiePar ? (
                    <span className="text-encre-3"> · {assistante.modifiePar === 'mcp' ? 'par Claude Code' : 'dans l’interface'}</span>
                  ) : null}
                </>
              ) : (
                <span className="text-encre-2">valeurs par défaut</span>
              )}
            </LigneDefinition>
            <LigneDefinition intitule="Configuration ElevenLabs">
              {configuration ? (
                <>
                  <span className="font-mono text-sm">{configuration.versionId.slice(-8)}</span>
                  <span className="text-encre-3"> · {ORIGINE_CONFIGURATION[configuration.origine]}</span>
                  <span className="block text-sm text-encre-3">
                    Consignée le{' '}
                    <time dateTime={configuration.consigneLe.toISOString()} className="font-mono">
                      {jourCourt(configuration.consigneLe)} {heure(configuration.consigneLe)}
                    </time>
                    .
                  </span>
                </>
              ) : (
                <span className="text-encre-2">
                  aucune consignée
                  <span className="block text-sm text-encre-3">Elle le sera à la première poussée par Claude Code.</span>
                </span>
              )}
            </LigneDefinition>
          </dl>
        </section>

        <section id="agenda" aria-labelledby="titre-agenda" className={SECTION}>
          <TitreSection id="titre-agenda">Agenda</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            {nom} propose des créneaux libres sur l’ensemble de tes calendriers. L’agenda est relu avant les appels (toutes les dix minutes
            au plus) ; un rendez-vous réservé pendant un appel est inscrit dans Google juste après.
          </p>
          <dl className="border-t border-filet">
            <LigneDefinition intitule="Source">
              {api ? (
                'API Google Agenda'
              ) : (
                <>
                  Connecteur Google Agenda de claude.ai, lu par <span className="font-mono text-sm">claude -p</span>{' '}
                  <span className="text-encre-3">(environ 20 s)</span>
                </>
              )}
            </LigneDefinition>
            <LigneDefinition intitule="Rendez-vous créés dans">
              {api ? (
                'le calendrier choisi à la connexion de l’API'
              ) : calendrier ? (
                <>
                  <span className="font-mono text-sm">{calendrier}</span>
                  <span className="block text-sm text-encre-3">Les invitations partent à ce nom.</span>
                </>
              ) : (
                <>
                  le calendrier « Autocalled » s’il existe, sinon le principal
                  <span className="block text-sm text-encre-3">
                    Pour en choisir un : <span className="font-mono">AGENDA_CALENDRIER</span> dans <span className="font-mono">.env</span>.
                  </span>
                </>
              )}
            </LigneDefinition>
            <LigneDefinition intitule="Dernière lecture">
              {etat && age !== null ? (
                <>
                  <time dateTime={etat.synchroniseLe.toISOString()} className="font-mono text-sm">
                    {jourCourt(etat.synchroniseLe)} {heure(etat.synchroniseLe)}
                  </time>
                  <span className="text-encre-3"> · {ilYA(age)}</span>
                  {age > FRAICHEUR_MINUTES ? (
                    <span className="block text-sm text-encre-3">Sera relue au prochain appel ou à l’ouverture d’une campagne.</span>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="text-encre-2">jamais</span>
                  <span className="block text-sm text-encre-3">
                    Elle se fera au prochain appel, ou maintenant avec le bouton ci-dessous.
                  </span>
                </>
              )}
            </LigneDefinition>
            {etat ? (
              <LigneDefinition intitule="Plages occupées">
                <span className="font-mono">{plages}</span> {plages > 1 ? 'plages occupées' : 'plage occupée'} jusqu’au{' '}
                <span className="font-mono">{JOUR_MOIS.format(etat.fenetreFin)}</span>
              </LigneDefinition>
            ) : null}
          </dl>
          {etat?.erreur ? (
            <Message ton="alerte" titre="La dernière lecture a échoué.">
              {etat.erreur} La copie affichée date de la lecture précédente.
            </Message>
          ) : null}
          <BoutonRelire />

          <div className="grid gap-3 pt-2">
            <h3 className="text-md font-semibold">API Google Agenda</h3>
            <p className="max-w-[62ch] text-sm text-encre-2">
              Plus rapide que le connecteur, mais demande un client OAuth Google. Une fois connectée, elle remplace le connecteur.
            </p>
            <MessageGoogle google={google} />
            {!client ? (
              <p className="text-sm text-encre-3">
                Non configurée : <span className="font-mono">GOOGLE_CLIENT_ID</span>,{' '}
                <span className="font-mono">GOOGLE_CLIENT_SECRET</span> et <span className="font-mono">ORIGINE_APP</span> manquent dans{' '}
                <span className="font-mono">.env</span>.
              </p>
            ) : api ? (
              <div className="grid gap-1">
                <p>
                  Connectée{api.email ? ' en tant que ' : '.'}
                  {api.email ? <span className="font-mono text-sm">{api.email}</span> : null}
                </p>
                <BoutonDeconnecter />
              </div>
            ) : (
              // Lien simple, jamais un <Link> : un préchargement ouvrirait la connexion OAuth.
              <a
                href="/google/connexion"
                className="group -mx-1.5 inline-flex h-9 items-center justify-self-start rounded-[4px] px-1.5 text-md font-medium text-encre-2 transition-colors duration-150 hover:text-encre pointer-coarse:h-11"
              >
                <span className="decoration-souligne decoration-1 underline-offset-4 group-hover:underline">
                  Connecter l’API Google Agenda
                </span>
              </a>
            )}
          </div>
        </section>

        <section id="rendez-vous" aria-labelledby="titre-rendez-vous" className={SECTION}>
          <TitreSection id="titre-rendez-vous">Rendez-vous pris par {nom}</TitreSection>
          <RendezVousMina rdvs={rdvs} maintenant={maintenant} limite={RENDEZ_VOUS_LUS} sansReservation={sansReservation} />
        </section>

        <section id="claude-code" aria-labelledby="titre-claude-code" className={SECTION}>
          <TitreSection id="titre-claude-code">Claude Code</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            Outils du serveur MCP d’Autocalled (<span className="font-mono">.mcp.json</span>) appelés par Claude Code. Les gestes qui font
            sonner le téléphone ou écrivent à un prospect attendent ton accord dans Claude Code.
          </p>
          <JournalClaudeCode lignes={journal} />
        </section>
      </div>
    </Page>
  );
}

function Ancre({ href, compte, children }: { href: string; compte?: number; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-baseline gap-1.5 rounded-[4px] py-1 whitespace-nowrap text-encre-3 decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline pointer-coarse:py-2.5"
    >
      {children}
      {compte !== undefined ? <span className="font-mono text-encre-3">{compte}</span> : null}
    </a>
  );
}
