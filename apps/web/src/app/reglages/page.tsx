import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { heure, jourCourt } from '@/components/format-appel';
import { EnTetePage, LIEN_TEXTE, LienAction, LigneDefinition, Message, Page, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { appels, entreprises, prospects, rendezVous } from '@/db/schema';
import { calendrierConfigure, etatAgenda } from '@/lib/agenda';
import { derniereVersionAssistante } from '@/lib/assistante';
import { ORIGINE_VERSION } from '@/lib/vue-assistante';
import { clientGoogle, connexion } from '@/lib/google';
import { journalMcpRecent, rendezVousRecents } from '@/lib/lecture';
import { assistantePourLaPage } from '@/lib/pages';
import { BoutonDeconnecter } from './bouton-deconnecter';
import { BoutonRelire, LienConnecterGoogle } from './boutons-agenda';
import { JournalDesGestes, type LigneJournal } from './journal-des-gestes';
import { MessageGoogle } from './message-google';
import { RendezVousMina } from './rendez-vous-mina';
import { SectionEntrants } from './section-entrants';
import { FormulaireRappels } from './formulaire-rappels';
import { lireReglagesRappels } from '@/lib/reglages-rappels';

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


const SECTION = 'grid scroll-mt-[calc(var(--hauteur-barre)+16px)] gap-5';

/**
 * Lien vers une section de la page : un lien texte, pas un filtre ; 44 px de haut et souligné au doigt, deux
 * rangées au plus sous 640 px.
 */
function Ancre({ href, compte, children }: { href: string; compte?: number; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={`inline-flex items-baseline gap-1.5 rounded-[4px] py-1 whitespace-nowrap text-encre-3 hover:text-encre-2 pointer-coarse:min-h-11 pointer-coarse:items-center pointer-coarse:py-0 ${LIEN_TEXTE}`}
    >
      {children}
      {compte !== undefined ? <span className="font-mono text-encre-3">{compte}</span> : null}
    </a>
  );
}

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

/** Les noms des entreprises et des prospects cités par slug ou identifiant dans les arguments du journal. */
async function nommer(journal: Omit<LigneJournal, 'noms'>[]): Promise<LigneJournal[]> {
  const texte = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const slugs = [...new Set(journal.map((l) => texte(l.arguments.entreprise)).filter((v): v is string => v !== null))];
  if (slugs.length === 0) return journal;
  const ids = [...new Set(journal.map((l) => texte(l.arguments.prospect)).filter((v): v is string => v !== null))];
  const [listeEntreprises, listeProspects] = await Promise.all([
    db.select({ slug: entreprises.slug, nom: entreprises.nom }).from(entreprises).where(inArray(entreprises.slug, slugs)),
    ids.length
      ? db
          .select({ id: prospects.id, nom: prospects.nom, slug: entreprises.slug })
          .from(prospects)
          .innerJoin(entreprises, eq(entreprises.id, prospects.entrepriseId))
          .where(and(inArray(entreprises.slug, slugs), inArray(prospects.id, ids)))
      : Promise.resolve([]),
  ]);
  const entreprise = new Map(listeEntreprises.map((e) => [e.slug, e.nom]));
  const prospect = new Map(listeProspects.map((p) => [`${p.slug}/${p.id}`, p.nom]));
  return journal.map((l) => {
    const slug = texte(l.arguments.entreprise);
    const id = texte(l.arguments.prospect);
    const nomEntreprise = slug ? entreprise.get(slug) : undefined;
    const nomProspect = slug && id ? prospect.get(`${slug}/${id}`) : undefined;
    return { ...l, noms: { ...(nomEntreprise ? { entreprise: nomEntreprise } : {}), ...(nomProspect ? { prospect: nomProspect } : {}) } };
  });
}

export default async function PageReglages({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google } = await searchParams;
  const [client, api, etat, rdvs, journal, sansReservation, assistante, configuration, rappels] = await Promise.all([
    clientGoogle(),
    connexion(),
    etatAgenda(),
    rendezVousRecents(),
    journalMcpRecent(100).then(nommer),
    rendezVousSansReservation(),
    assistantePourLaPage(),
    derniereVersionAssistante(),
    lireReglagesRappels(),
  ]);
  const { nom } = assistante;
  const maintenant = new Date();
  const calendrier = calendrierConfigure();
  const age = etat ? Math.max(0, Math.floor((maintenant.getTime() - etat.synchroniseLe.getTime()) / 60_000)) : null;
  const plages = etat?.occupations.length ?? 0;

  return (
    <Page largeur="lecture">
      <EnTetePage titre="Réglages" sousTitre={`${nom}, l’agenda qu’elle lit, les rendez-vous qu’elle a pris, et le journal de ce que Claude Code et l’interface ont fait.`} />
      <div className="grid max-w-[48rem] gap-12">
        <nav aria-label="Sections de la page" className="-mt-2 flex flex-wrap gap-x-[22px] gap-y-1 text-md pointer-coarse:gap-y-0">
          <Ancre href="#assistante">Assistante</Ancre>
          <Ancre href="#appels-entrants">Appels entrants</Ancre>
          <Ancre href="#rappels">Rappels</Ancre>
          <Ancre href="#agenda">Agenda</Ancre>
          <Ancre href="#rendez-vous" compte={rdvs.length}>
            Rendez-vous
          </Ancre>
          <Ancre href="#journal" compte={journal.length}>
            Journal
          </Ancre>
        </nav>

        <section id="assistante" aria-labelledby="titre-assistante" className={SECTION}>
          <TitreSection id="titre-assistante">Assistante</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            Son nom et son premier message valent dès l’appel suivant. Son prompt, sa voix et son tour de parole partent chez ElevenLabs par
            une poussée. Tout se règle sur la page Assistante ou par Claude Code, avec ton accord avant que quoi que ce soit change pour les
            prospects.
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
            <LigneDefinition intitule="Configuration">
              {configuration ? (
                <>
                  <span className="font-mono text-sm">{configuration.versionId.slice(-8)}</span>
                  <span className="text-encre-3"> · {ORIGINE_VERSION[configuration.origine] ?? configuration.origine}</span>
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
                  <span className="block text-sm text-encre-3">Elle le sera à la première poussée, depuis la page Assistante ou par Claude Code.</span>
                </span>
              )}
            </LigneDefinition>
          </dl>
          {/* L’action de la section : la page où se modifient le prompt et les réglages de l’assistante. */}
          <div className="-mx-1.5 grid justify-items-start gap-1 pointer-coarse:mx-0">
            <LienAction href="/assistante" ton="fort" className="max-sm:h-auto max-sm:min-h-11 max-sm:py-2 max-sm:whitespace-normal">
              Voir et régler l’assistante
            </LienAction>
            <p className="px-1.5 text-sm text-encre-3 pointer-coarse:px-0">
              Prompt complet, nom, premier message, modèles, voix et réglages, poussée vers ElevenLabs et historique.
            </p>
          </div>
        </section>

        <SectionEntrants nom={nom} />

        <section id="rappels" aria-labelledby="titre-rappels" className={SECTION}>
          <TitreSection id="titre-rappels">Rappels convenus</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">Les rappels datés sont composés à partir de l’heure convenue, au prochain réveil dans les jours et horaires autorisés. Le réveil passe toutes les cinq minutes ; une ligne occupée ou un plafond atteint fait attendre.</p>
          <FormulaireRappels {...rappels} />
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
                  Google Agenda, lu par Claude Code <span className="text-encre-3">(environ 20 s)</span>
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
              {/* L'erreur brute, close par un point, puis l'explication. */}
              {etat.erreur.trim()}
              {/[.!?…]$/.test(etat.erreur.trim()) ? '' : '.'} La copie affichée date de la lecture précédente.
            </Message>
          ) : null}
          {/* Une seule action forte dans l'agenda : la connexion de l'API quand elle est proposée, sinon la relecture. */}
          <BoutonRelire ton={client && !api ? 'normal' : 'fort'} />

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
              <LienConnecterGoogle />
            )}
          </div>
        </section>

        <section id="rendez-vous" aria-labelledby="titre-rendez-vous" className={SECTION}>
          <TitreSection id="titre-rendez-vous">Rendez-vous pris par {nom}</TitreSection>
          <RendezVousMina rdvs={rdvs} maintenant={maintenant} limite={RENDEZ_VOUS_LUS} sansReservation={sansReservation} />
        </section>

        <section id="journal" aria-labelledby="titre-journal" className={SECTION}>
          <TitreSection id="titre-journal">Journal des gestes</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            Les outils du serveur MCP d’Autocalled (<span className="font-mono">.mcp.json</span>) appelés par Claude Code, et tes gestes sur la
            page Assistante. Les gestes qui font sonner le téléphone, effacent une personne, invitent un prospect, desserrent un garde-fou ou
            changent ce que dit l’assistante attendent ton accord, dans Claude Code ou dans la page ; la question lue reste au journal.
          </p>
          <JournalDesGestes lignes={journal} />
        </section>
      </div>
    </Page>
  );
}
