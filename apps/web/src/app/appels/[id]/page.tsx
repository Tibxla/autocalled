import { type IssueSysteme, LIBELLES_ISSUES } from '@autocalled/domain';
import { and, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Message, TitreSection } from '@/components/ui';
import { db } from '@/db';
import { appels, entreprises, issuesPersonnalisees, objections, prospects, versionsScript } from '@/db/schema';
import { Actualisation } from './actualisation';
import { BoutonRelancer } from './bouton-relancer';
import { LecteurAppel } from './lecteur-appel';

export const metadata: Metadata = { title: 'Appel' };

const dateLongue = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' });

const LIGNES: Record<string, string> = {
  navigateur: 'Ligne navigateur (test)',
  simulation: 'Appel simulé : un modèle joue le prospect',
  bluetooth: 'Téléphone passerelle',
  twilio: 'Twilio',
};

export default async function PageAppel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [appel] = await db.select().from(appels).where(eq(appels.id, id));
  if (!appel) notFound();

  const [[entreprise], [prospect], [version], listeObjections, personnalisees] = await Promise.all([
    db.select().from(entreprises).where(eq(entreprises.id, appel.entrepriseId)),
    db
      .select()
      .from(prospects)
      .where(and(eq(prospects.entrepriseId, appel.entrepriseId), eq(prospects.id, appel.prospectId))),
    db.select().from(versionsScript).where(eq(versionsScript.id, appel.versionScriptId)),
    db.select().from(objections).where(eq(objections.entrepriseId, appel.entrepriseId)),
    db.select().from(issuesPersonnalisees).where(eq(issuesPersonnalisees.entrepriseId, appel.entrepriseId)),
  ]);
  if (!entreprise) notFound();

  const bilan = appel.bilan;
  const libelleIssue = (cle: string) =>
    cle.startsWith('perso:')
      ? (personnalisees.find((p) => `perso:${p.id}` === cle)?.libelle ?? cle)
      : (LIBELLES_ISSUES[cle as IssueSysteme] ?? cle);
  const etapes = version?.etapes ?? [];
  const enTraitement = appel.statut === 'en-cours' || appel.statut === 'traitement';

  return (
    <div className="grid gap-10 pt-10">
      {enTraitement ? <Actualisation /> : null}
      <div className="grid gap-1">
        <p className="text-sm text-encre-3">
          <Link href={`/entreprises/${entreprise.slug}`} className="hover:text-encre">
            {entreprise.nom}
          </Link>
          {' · '}
          <Link href={`/entreprises/${entreprise.slug}/prospects/${appel.prospectId}`} className="hover:text-encre">
            {prospect?.nom ?? appel.prospectId}
          </Link>
        </p>
        <h1 className="text-xl font-semibold tracking-[-0.02em]">Appel du {dateLongue.format(appel.debutLe)}</h1>
        <p className="text-sm text-encre-2">
          {LIGNES[appel.ligne]}
          {appel.dureeSecondes ? (
            <>
              {' · '}
              <span className="font-mono">
                {Math.floor(appel.dureeSecondes / 60)}:{String(appel.dureeSecondes % 60).padStart(2, '0')}
              </span>
            </>
          ) : null}
          {appel.versionAgent ? (
            <>
              {' · agent '}
              <span className="font-mono">{appel.versionAgent.slice(-6)}</span>
            </>
          ) : null}
        </p>
      </div>

      {appel.statut === 'en-cours' ? (
        <div className="grid justify-items-start gap-3">
          <Message ton="neutre">Appel en cours ou interrompu sans avoir été clos.</Message>
          <BoutonRelancer appelId={appel.id} libelle="Récupérer l’appel" />
        </div>
      ) : null}
      {appel.statut === 'traitement' ? (
        <Message ton="neutre">Rapatriement de la conversation et analyse en cours. La page se mettra à jour toute seule.</Message>
      ) : null}
      {appel.statut === 'echec' ? (
        <div className="grid justify-items-start gap-3">
          <Message ton="alerte">L’analyse a échoué : {appel.erreur}</Message>
          <BoutonRelancer appelId={appel.id} libelle="Relancer l’analyse" />
        </div>
      ) : null}

      {bilan ? (
        <section className="grid gap-6">
          <TitreSection action={<BoutonRelancer appelId={appel.id} libelle="Réanalyser" />}>Bilan</TitreSection>
          <dl className="grid gap-x-10 gap-y-6 sm:grid-cols-[14rem_1fr]">
            <dt className="text-sm text-encre-3">Issue</dt>
            <dd className="grid gap-1">
              <span className="text-lg font-semibold">{libelleIssue(bilan.issue)}</span>
              {bilan.rappel ? <span className="text-encre-2">Rappel convenu : {bilan.rappel}</span> : null}
            </dd>
            <dt className="text-sm text-encre-3">Étape atteinte</dt>
            <dd>
              {bilan.etapeAtteinte === 0 ? (
                'Aucune'
              ) : (
                <>
                  <span className="font-mono">
                    {bilan.etapeAtteinte}/{etapes.length}
                  </span>{' '}
                  <span className="text-encre-2">{etapes[bilan.etapeAtteinte - 1]?.intention}</span>
                </>
              )}
            </dd>
            <dt className="text-sm text-encre-3">Résumé</dt>
            <dd className="max-w-[68ch]">{bilan.resume}</dd>
            <dt className="text-sm text-encre-3">Ce qui a marché</dt>
            <dd>
              <ul className="grid max-w-[68ch] gap-1">
                {bilan.pointsForts.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </dd>
            <dt className="text-sm text-encre-3">Ce qui a moins marché</dt>
            <dd>
              <ul className="grid max-w-[68ch] gap-1">
                {bilan.pointsFaibles.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </dd>
          </dl>
          <p className="text-xs text-encre-3">
            Analyse : <span className="font-mono">{appel.versionAnalyseur}</span>. Chaque objection cite la phrase exacte du prospect ; un bilan
            qui invente une citation est refusé.
          </p>
        </section>
      ) : null}

      {appel.transcription?.length ? (
        <section className="grid gap-6">
          <TitreSection>Conversation</TitreSection>
          <LecteurAppel
            appelId={appel.id}
            audio={Boolean(appel.audio)}
            transcription={appel.transcription}
            objections={(bilan?.objections ?? []).map((o) => ({
              libelle: o.objectionId ? (listeObjections.find((x) => x.id === o.objectionId)?.libelle ?? o.libelle) : o.libelle,
              levee: o.levee,
              tempsBloquant: o.tempsBloquant,
              citation: o.citation,
              repertoriee: o.objectionId !== null,
            }))}
          />
        </section>
      ) : null}
    </div>
  );
}
