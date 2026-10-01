import type { Metadata } from 'next';
import { heure, jourCourt } from '@/components/format-appel';
import { REFUS_NUMERO } from '@/components/refus-numero';
import { EnTetePage, EtatVide, LIEN_TEXTE, LienAction, LigneDefinition, Message, Page, TitreSection } from '@/components/ui';
import { ceQueVoitLAssistante } from '@/lib/ce-que-voit-l-assistante';
import { derniersGestesAssistante, lireEditionAssistante } from '@/lib/edition-assistante';
import { lireFichiersAssistante } from '@/lib/fichiers-assistante';
import { assistantePourLaPage } from '@/lib/pages';
import {
  CE_QUI_EST_MODIFIABLE,
  configurationATelecharger,
  connaissancesDe,
  GROUPES_VARIABLES,
  LIBELLES_ETAT,
  ORIGINE_VERSION,
  outilsDe,
  resoudre,
  resumeConfiguration,
  segmenter,
} from '@/lib/vue-assistante';
import { BlocRepliable, LienTelechargement, TexteAvecVariables, TexteResolu } from './blocs';
import { ChoixApercu } from './choix-apercu';
import { FormulaireIdentite } from './formulaire-identite';
import { FormulaireReglages } from './formulaire-reglages';
import { Historique } from './historique';
import { ListeDuJournal } from '../reglages/journal-des-gestes';
import { Poussee } from './poussee';

export const metadata: Metadata = { title: 'Assistante' };

const SECTION = 'grid min-w-0 scroll-mt-[calc(var(--hauteur-barre)+16px)] gap-5';

const NOMBRE = new Intl.NumberFormat('fr-FR');

/** L'ancre de chaque section où un élément se modifie (CE_QUI_EST_MODIFIABLE). */
const SECTIONS: Record<string, string> = { Identité: 'identite', Réglages: 'reglages', Poussée: 'poussee', Historique: 'historique' };

type Parametres = { entreprise?: string; version?: string; prospect?: string };

/**
 * L'assistante telle qu'elle est configurée, et où elle se règle : son identité (base), son prompt et sa configuration
 * ElevenLabs (fichiers de agent/), ses outils, ce qu'elle reçoit pour un appel choisi. Décision de l'opérateur du
 * 30/09/2026 : la page modifie tout ce que modifient les outils MCP de Claude Code, par les mêmes fonctions
 * (lib/edition-assistante.ts, actions de ./actions.ts), sauf le prompt, qui reste en lecture et se modifie par Claude
 * Code. L'affichage ne joint pas ElevenLabs : seules la préparation d'une poussée, la poussée et le rapatriement le font.
 */
export default async function PageAssistante({ searchParams }: { searchParams: Promise<Parametres> }) {
  const choix = await searchParams;
  const [assistante, fichiers, edition, gestes, vue] = await Promise.all([
    assistantePourLaPage(),
    lireFichiersAssistante(),
    lireEditionAssistante(),
    derniersGestesAssistante(),
    ceQueVoitLAssistante({ entreprise: choix.entreprise, version: choix.version, prospect: choix.prospect }),
  ]);
  const { nom } = assistante;
  const variablesDuPrompt = [...new Set(segmenter(fichiers.prompt).flatMap((s) => (s.type === 'variable' ? [s.nom] : [])))];
  const outils = outilsDe(fichiers.configuration);
  const connaissances = connaissancesDe(fichiers.configuration);
  const telechargeable = configurationATelecharger(fichiers.configurationBrute, fichiers.configuration);
  const { synchro } = fichiers;
  const consignee = edition.historique[0] ?? null;
  const apercu = vue.apercu;
  const lienVue = new URLSearchParams({
    ...(vue.entreprise ? { entreprise: vue.entreprise.slug } : {}),
    ...(apercu?.version ? { version: apercu.version.id } : {}),
    ...(apercu?.prospect ? { prospect: apercu.prospect.id } : {}),
  });

  return (
    <Page largeur="lecture">
      <EnTetePage
        titre="Assistante"
        sousTitre={`Ce que ${nom} dit, reçoit et sait faire à chaque appel, et où cela se règle. Tout se modifie ici, sauf le prompt, qui passe par Claude Code.`}
      />
      <div className="grid max-w-[56rem] min-w-0 gap-12">
        <nav aria-label="Sections de la page" className="-mt-2 flex flex-wrap gap-x-[22px] gap-y-1 text-md pointer-coarse:gap-y-0">
          <Ancre href="#identite">Identité</Ancre>
          <Ancre href="#prompt">Prompt</Ancre>
          <Ancre href="#reglages">Réglages</Ancre>
          <Ancre href="#poussee">Poussée</Ancre>
          <Ancre href="#historique" compte={edition.historique.length}>
            Historique
          </Ancre>
          <Ancre href="#gestes">Derniers gestes</Ancre>
          <Ancre href="#configuration">Configuration</Ancre>
          <Ancre href="#outils" compte={outils.length}>
            Outils
          </Ancre>
          <Ancre href="#vue">Ce qu’elle voit</Ancre>
          <Ancre href="#connaissances">Connaissances</Ancre>
          <Ancre href="#modifier">Par où</Ancre>
        </nav>

        <section id="identite" aria-labelledby="titre-identite" className={SECTION}>
          <TitreSection id="titre-identite">Identité</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            Enregistrés en base, envoyés avec chaque appel : ils valent dès l’appel suivant, sans poussée vers ElevenLabs. L’enregistrement
            demande ta confirmation, comme dans Claude Code.
          </p>
          <FormulaireIdentite nom={nom} premierMessage={assistante.premierMessage} connu={assistante.modifieLe?.toISOString() ?? null} />
          <dl className="border-t border-filet">
            <LigneDefinition intitule="Premier message">
              <span className="break-words">
                « <TexteAvecVariables texte={assistante.premierMessage} /> »
              </span>
              <span className="block text-sm text-encre-3">Tel qu’enregistré, variables en évidence ; le pont les remplace à chaque appel.</span>
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
                <span className="text-encre-2">jamais : valeurs par défaut</span>
              )}
            </LigneDefinition>
          </dl>
        </section>

        <section id="prompt" aria-labelledby="titre-prompt" className={SECTION}>
          <TitreSection id="titre-prompt">Prompt système</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            <span className="font-mono">agent/prompt.md</span>, <span className="font-mono">{NOMBRE.format(fichiers.prompt.length)}</span> caractères. Il part
            chez ElevenLabs par une poussée ; au début de chaque appel, ElevenLabs y remplace les{' '}
            <span className="rounded-[2px] bg-filet-2 px-0.5 font-mono text-[0.9em] text-encre">{'{{variables}}'}</span> par les valeurs que l’application
            lui transmet (voir Ce qu’elle voit).
          </p>
          <p className="text-sm text-encre-3">
            <span className="font-mono">{variablesDuPrompt.length}</span> variables :{' '}
            <span className="font-mono break-words text-encre-2">{variablesDuPrompt.join(' · ')}</span>
          </p>
          <Message ton="neutre">
            Le prompt se modifie par Claude Code (<span className="font-mono">modifier_prompt_assistante</span>), puis se pousse ici ou par Claude
            Code.
          </Message>
          <div className="grid justify-items-start gap-2">
            <LienTelechargement href="/assistante/telecharger/prompt">Télécharger le prompt (.md)</LienTelechargement>
            <BlocRepliable resume={`Lire le prompt (${NOMBRE.format(fichiers.prompt.length)} caractères)`}>
              <TexteAvecVariables texte={fichiers.prompt} />
            </BlocRepliable>
          </div>
        </section>

        <section id="reglages" aria-labelledby="titre-reglages" className={SECTION}>
          <TitreSection id="titre-reglages">Réglages</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            La liste fermée des réglages ElevenLabs, écrite dans <span className="font-mono">agent/mina.config.json</span> avec les mêmes bornes
            que Claude Code. Rien ne change pour les appels avant la poussée ; les fichiers modifiés se relisent et se commitent.
          </p>
          <FormulaireReglages reglages={edition.reglages} empreinte={edition.empreinteLocale} />
        </section>

        <section id="poussee" aria-labelledby="titre-poussee" className={SECTION}>
          <TitreSection id="titre-poussee">Poussée vers ElevenLabs</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            La poussée envoie le prompt et les réglages de agent/ : ils servent dès le prochain appel. Tu confirmes sur la différence rédigée par
            le serveur ; rien ne part pendant un appel.
          </p>
          <dl className="border-t border-filet">
            <LigneDefinition intitule="Fichiers de agent/">
              {synchro.modificationsLocalesNonPoussees ? (
                <>
                  modifications non poussées
                  <span className="block text-sm text-encre-3">
                    Ils diffèrent de la dernière configuration poussée ou rapatriée : les appels utilisent l’ancienne jusqu’à la poussée.
                  </span>
                </>
              ) : (
                'identiques à la dernière poussée ou au dernier rapatriement'
              )}
            </LigneDefinition>
            <LigneDefinition intitule="Verrou">
              {synchro.verrou?.versionId ? (
                <span className="font-mono text-sm break-all">{synchro.verrou.versionId}</span>
              ) : (
                <span className="text-encre-2">{synchro.verrou ? 'sans version' : 'aucun : jamais poussée ni rapatriée depuis cette copie'}</span>
              )}
              <span className="block text-sm text-encre-3">
                Empreinte locale <span className="font-mono break-all">{synchro.empreinteLocale.slice(0, 12)}</span>
              </span>
            </LigneDefinition>
            <LigneDefinition intitule="Dernière consignée">
              {consignee ? (
                <>
                  <span className="font-mono text-sm break-all">{consignee.versionId}</span>
                  <span className="block text-sm text-encre-3">
                    {ORIGINE_VERSION[consignee.origine] ?? consignee.origine}, le{' '}
                    <time dateTime={consignee.consigneLe.toISOString()} className="font-mono">
                      {jourCourt(consignee.consigneLe)} {heure(consignee.consigneLe)}
                    </time>
                    {synchro.verrou?.versionId && synchro.verrou.versionId !== consignee.versionId ? ' ; le verrou porte une autre version.' : '.'}
                  </span>
                </>
              ) : (
                <span className="text-encre-2">aucune</span>
              )}
            </LigneDefinition>
            <LigneDefinition intitule="Version distante">
              <span className="text-encre-2">lue au moment de pousser</span>
              <span className="block text-sm text-encre-3">
                L’affichage ne joint pas ElevenLabs : « Pousser vers ElevenLabs » la lit et montre la différence avant toute confirmation.
              </span>
            </LigneDefinition>
          </dl>

          <Poussee />
        </section>

        <section id="historique" aria-labelledby="titre-historique" className={SECTION}>
          <TitreSection id="titre-historique" compte={edition.historique.length}>
            Historique
          </TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            Les configurations consignées à chaque poussée ou rapatriement, avec les appels réels passés avec chacune. Restaurer réécrit agent/
            depuis l’une d’elles ; elle ne sert aux appels qu’après une poussée.
          </p>
          {edition.historique.length === 0 ? (
            <EtatVide titre="Aucune version consignée">La première le sera à la première poussée ou au premier rapatriement.</EtatVide>
          ) : (
            <Historique
              versions={edition.historique.map((v) => ({
                versionId: v.versionId,
                consigneLe: v.consigneLe.toISOString(),
                origine: v.origine,
                appels: v.appels,
                estLeVerrou: v.estLeVerrou,
              }))}
            />
          )}
        </section>

        <section id="gestes" aria-labelledby="titre-gestes" className={SECTION}>
          <TitreSection id="titre-gestes">Derniers gestes</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            Les cinq derniers changements de l’assistante, faits ici ou par Claude Code, et leur résultat. La question lue avant chaque
            geste confirmé, les lectures et tous les autres gestes sont au journal complet, dans Réglages.
          </p>
          {gestes.length === 0 ? (
            <EtatVide titre="Aucun geste sur l’assistante pour l’instant">Chaque enregistrement, poussée, rapatriement ou restauration laissera ici sa ligne.</EtatVide>
          ) : (
            <ListeDuJournal lignes={gestes} />
          )}
          <LienAction href="/reglages#journal" ton="normal" className="-mx-1.5 justify-self-start pointer-coarse:mx-0">
            Journal complet
          </LienAction>
        </section>

        <section id="configuration" aria-labelledby="titre-configuration" className={SECTION}>
          <TitreSection id="titre-configuration">Configuration ElevenLabs</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            <span className="font-mono">agent/mina.config.json</span> en lecture : les champs que le dépôt gère, réglables ou non. Le reste de
            l’agent reste chez ElevenLabs.
          </p>
          {resumeConfiguration(fichiers.configuration).map((groupe) => (
            <div key={groupe.titre} className="grid min-w-0 gap-2">
              <h3 className="text-md font-semibold">{groupe.titre}</h3>
              <dl className="border-t border-filet">
                {groupe.lignes.map((l) => (
                  <LigneDefinition key={l.intitule} intitule={l.intitule}>
                    <span className="break-words">{l.valeur}</span>
                    {l.detail ? <span className="block text-sm text-encre-3">{l.detail}</span> : null}
                  </LigneDefinition>
                ))}
              </dl>
            </div>
          ))}

          {telechargeable.masques.length ? (
            <Message ton="neutre">
              Le téléchargement masque {telechargeable.masques.length > 1 ? 'des clés qui ressemblent' : 'une clé qui ressemble'} à un secret :{' '}
              <span className="font-mono">{telechargeable.masques.join(', ')}</span>.
            </Message>
          ) : null}
          <div className="grid justify-items-start gap-2">
            <LienTelechargement href="/assistante/telecharger/configuration">Télécharger la configuration (.json)</LienTelechargement>
            <BlocRepliable resume="Lire mina.config.json">
              <span className="font-mono text-sm">{telechargeable.texte}</span>
            </BlocRepliable>
          </div>
        </section>

        <section id="outils" aria-labelledby="titre-outils" className={SECTION}>
          <TitreSection id="titre-outils" compte={outils.length}>
            Outils
          </TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            Ce que {nom} peut déclencher pendant un appel. Les outils client passent par le pont et l’application, les outils système sont gérés
            par ElevenLabs.
          </p>
          <div className="border-t border-filet">
            {outils.map((o) => (
              <div key={o.nom} className="grid min-w-0 gap-1.5 border-b border-filet py-3">
                <h3 className="font-mono text-md break-all text-encre">{o.nom}</h3>
                <p className="text-sm text-encre-3">
                  {o.type === 'client' ? 'Outil client' : o.type === 'system' ? 'Outil système' : `Outil ${o.type}`}, exécuté par {o.executePar}
                  {o.reponseAttendue === false ? ', sans réponse attendue' : ''}
                </p>
                {o.description ? <p className="max-w-[68ch] text-encre-2">{o.description}</p> : null}
                {o.quand ? (
                  <p className="max-w-[68ch]">
                    <span className="text-encre-3">Quand elle s’en sert : </span>
                    {o.quand}
                  </p>
                ) : null}
                {o.parametres.length ? (
                  <ul className="grid gap-1 pt-0.5 text-sm">
                    {o.parametres.map((p) => (
                      <li key={p.nom} className="max-w-[68ch] break-words">
                        <span className="font-mono text-encre">{p.nom}</span>
                        <span className="text-encre-3">
                          {' '}
                          ({p.type}
                          {p.requis ? ', requis' : ''})
                        </span>
                        {p.description ? <span className="text-encre-2"> : {p.description}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section id="vue" aria-labelledby="titre-vue" className={SECTION}>
          <TitreSection id="titre-vue">Ce qu’elle voit pour parler</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            Le prompt et le premier message tels que {nom} les reçoit pour un appel, calculés par le même code que l’appel réel, d’après ce qui est
            enregistré. Rien n’est appelé ni journalisé ; le choix se garde dans le lien.
          </p>
          {vue.entreprises.length === 0 ? (
            <EtatVide titre="Aucune entreprise">Crée une entreprise pour voir ce que l’assistante recevrait en l’appelant.</EtatVide>
          ) : (
            <>
              <ChoixApercu
                entreprises={vue.entreprises}
                versions={vue.versions}
                prospects={vue.prospects}
                choix={{ entreprise: vue.entreprise?.slug ?? '', version: apercu?.version?.id ?? '', prospect: apercu?.prospect?.id ?? '' }}
              />
              {vue.erreur ? <Message ton="alerte">{vue.erreur}</Message> : null}
            </>
          )}

          {apercu && vue.vue ? (
            <>
              <p className="max-w-[62ch] text-sm text-encre-3">
                {apercu.version ? (
                  <>
                    Avec <span className="text-encre-2">{apercu.version.script}</span> <span className="font-mono">v{apercu.version.numero}</span>
                  </>
                ) : (
                  `Aucun script : ${nom} recevrait l’étape par défaut`
                )}
                {apercu.prospect ? (
                  <>
                    , pour <span className="text-encre-2">{apercu.prospect.nom}</span>.
                  </>
                ) : (
                  ', sans prospect : ses variables dépendront de sa fiche.'
                )}
                {apercu.prospect?.refus ? (
                  <span className="text-encre-2"> Numéro {REFUS_NUMERO[apercu.prospect.refus]} : cet appel serait refusé.</span>
                ) : null}
              </p>
              <LienTelechargement href={`/assistante/telecharger/vue?${lienVue.toString()}`}>Télécharger ce que voit {nom} (.md)</LienTelechargement>
              <dl className="border-t border-filet">
                <LigneDefinition intitule="Premier message">
                  <span className="break-words">« {apercu.premierMessage} »</span>
                  <span className="block text-sm text-encre-3">Tel que le pont le transmet, si le prospect se tait au décroché.</span>
                </LigneDefinition>
                <LigneDefinition intitule="Mots-clés de la reconnaissance vocale">
                  <span className="break-words text-encre-2">{apercu.motsCles.length ? apercu.motsCles.join(' · ') : 'aucun'}</span>
                </LigneDefinition>
              </dl>
              <BlocRepliable resume="Lire le prompt résolu">
                <TexteResolu segments={resoudre(fichiers.prompt, vue.vue.variables, vue.etats)} />
              </BlocRepliable>

              <div className="grid min-w-0 gap-2">
                <h3 className="text-md font-semibold">Variables transmises</h3>
                <dl className="border-t border-filet">
                  {GROUPES_VARIABLES.map((g) => (
                    <div key={g.titre} className="border-b border-filet py-2">
                      <dt className="pb-1 text-sm font-medium text-encre">{g.titre}</dt>
                      <dd>
                        <dl>
                          {g.cles.map(([cle, libelle]) => {
                            const etat = vue.etats[cle] ?? 'valeur';
                            const valeur = vue.vue?.variables[cle] ?? '';
                            return (
                              <div key={cle} className="grid min-w-0 gap-0.5 py-1.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                                <dt className="grid content-start text-sm text-encre-3">
                                  <span>{libelle}</span>
                                  <span className="font-mono text-xs break-all">{cle}</span>
                                </dt>
                                <dd className="min-w-0 text-md break-words whitespace-pre-line">
                                  {etat === 'selon-la-fiche' || etat === 'vide' ? (
                                    <span className="text-encre-3">{LIBELLES_ETAT[etat]}</span>
                                  ) : (
                                    <>
                                      <span className={etat === 'par-defaut' ? 'text-encre-2' : 'text-encre'}>{valeur}</span>
                                      {etat === 'par-defaut' ? <span className="block text-sm text-encre-3">{LIBELLES_ETAT['par-defaut']}</span> : null}
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
                </dl>
              </div>
            </>
          ) : null}
        </section>

        <section id="connaissances" aria-labelledby="titre-connaissances" className={SECTION}>
          <TitreSection id="titre-connaissances">Connaissances</TitreSection>
          {connaissances.length === 0 ? (
            <p className="max-w-[62ch] text-encre-2">
              Aucun fichier de base de connaissances n’est chargé chez ElevenLabs : <span className="font-mono">mina.config.json</span> n’en déclare
              aucun. Tout ce que {nom} sait lui arrive par le prompt et les variables de chaque appel.
              <span className="block pt-1 text-sm text-encre-3">
                Le dépôt ne gère pas ce champ : une connaissance ajoutée dans le tableau de bord ElevenLabs changerait la version distante, et{' '}
                <span className="font-mono">pnpm agent status</span> le signalerait.
              </span>
            </p>
          ) : (
            <Message ton="neutre" titre="Des connaissances sont déclarées dans mina.config.json.">
              <span className="font-mono">{connaissances.map((c) => c.chemin).join(', ')}</span>
            </Message>
          )}
        </section>

        <section id="modifier" aria-labelledby="titre-modifier" className={SECTION}>
          <TitreSection id="titre-modifier">Ce qui se modifie, et par où</TitreSection>
          <p className="max-w-[62ch] text-sm text-encre-2">
            Cette page fait ce que font les outils du serveur MCP de Claude Code, par les mêmes fonctions, sauf le prompt. Ici comme dans Claude
            Code, ton accord est demandé avant que les prospects entendent la différence.
          </p>
          <dl className="border-t border-filet">
            {CE_QUI_EST_MODIFIABLE.map((e) => (
              <div key={e.element} className="grid min-w-0 gap-1 border-b border-filet py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                <dt className="grid content-start">
                  <span>{e.element}</span>
                  <span className="text-sm text-encre-3">{e.modifiable ? 'modifiable' : 'lecture seule'}</span>
                </dt>
                <dd className="grid min-w-0 gap-0.5">
                  {e.ici ? (
                    <p>
                      <span className="text-encre-3">Ici : </span>
                      <a href={`#${SECTIONS[e.ici] ?? ''}`} className={`${LIEN_TEXTE} rounded-[4px] pointer-coarse:py-[15px]`}>
                        section {e.ici}
                      </a>
                    </p>
                  ) : null}
                  {e.claudeCode.length ? (
                    <p className="break-words">
                      <span className="text-encre-3">Par Claude Code : </span>
                      {e.claudeCode.map((outil, i) => (
                        <span key={outil}>
                          {i > 0 ? ', puis ' : ''}
                          <span className="font-mono text-sm">{outil}</span>
                        </span>
                      ))}
                    </p>
                  ) : null}
                  <p className="max-w-[62ch] text-sm text-encre-2">{e.effet}</p>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Page>
  );
}

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
