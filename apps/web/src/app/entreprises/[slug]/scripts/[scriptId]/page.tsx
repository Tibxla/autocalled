import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FUSEAU } from '@/components/format-appel';
import { Page } from '@/components/ui';
import { db } from '@/db';
import { campagnes, prospects, scripts, versionsScript, type Etape } from '@/db/schema';
import { analyseEntreprise } from '@/lib/lecture';
import { entrepriseParSlug } from '@/lib/pages';
import { usageDuScript } from '@/lib/versions';
import { ApercuMina } from '../../apercu-mina';
import { ActionsScript } from './actions-script';
import { EspaceVersion } from './espace-version';

export const metadata: Metadata = { title: 'Script' };

const JOUR_MOIS = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: FUSEAU });

function LectureVersion({ etapes }: { etapes: Etape[] }) {
  return (
    <ol aria-label="Étapes" className="border-t border-filet">
      {etapes.map((etape, i) => (
        <li key={i} className="grid gap-1.5 border-b border-filet py-4 sm:grid-cols-[2rem_minmax(0,1fr)]">
          <span className="font-mono text-sm text-encre-3">{i + 1}</span>
          <div className="grid gap-1.5">
            <p className="text-base">{etape.intention}</p>
            {etape.exemples.map((ex, j) => (
              <p key={j} className="text-md text-encre-2">
                « {ex} »
              </p>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

const egales = (a: Etape, b: Etape) => a.intention === b.intention && a.exemples.length === b.exemples.length && a.exemples.every((x, i) => x === b.exemples[i]);

function ColonneEtape({ titre, etape }: { titre: string; etape: Etape | undefined }) {
  return (
    <div className="grid content-start gap-1 rounded-md bg-surface px-3 py-2.5">
      <p className="font-mono text-xs text-encre-3">{titre}</p>
      {etape ? (
        <>
          <p className="text-md">{etape.intention}</p>
          {etape.exemples.map((ex, j) => (
            <p key={j} className="text-md text-encre-2">
              « {ex} »
            </p>
          ))}
        </>
      ) : (
        <p className="text-md text-encre-3">Pas d’étape à ce rang.</p>
      )}
    </div>
  );
}

/** Étape par étape, au même rang : ajoutée, retirée, modifiée (les deux textes côte à côte dès lg) ou inchangée. */
function Comparaison({ ancienne, recente }: { ancienne: { numero: number; etapes: Etape[] }; recente: { numero: number; etapes: Etape[] } }) {
  const rangs = Math.max(ancienne.etapes.length, recente.etapes.length);
  const lignes = Array.from({ length: rangs }, (_, i) => {
    const a = ancienne.etapes[i];
    const b = recente.etapes[i];
    const statut = !a ? `ajoutée dans la v${recente.numero}` : !b ? `retirée dans la v${recente.numero}` : egales(a, b) ? 'inchangée' : 'modifiée';
    return { i, a, b, statut, inchangee: Boolean(a && b && egales(a, b)) };
  });
  const changees = lignes.filter((l) => !l.inchangee).length;
  return (
    <section aria-labelledby="titre-comparaison" className="grid gap-3">
      <h3 id="titre-comparaison" className="text-md font-semibold">
        <span className="font-mono">v{ancienne.numero}</span> et <span className="font-mono">v{recente.numero}</span>
        <span className="ml-2.5 font-normal text-encre-3">
          {changees === 0 ? 'aucune différence' : `${changees} ${changees > 1 ? 'étapes diffèrent' : 'étape diffère'}`}
        </span>
      </h3>
      <ol className="border-t border-filet">
        {lignes.map((l) => (
          <li key={l.i} className="grid gap-2 border-b border-filet py-3">
            <p className="flex items-baseline gap-3 text-sm">
              <span className="font-mono text-encre-3">{l.i + 1}</span>
              <span className={l.inchangee ? 'text-encre-3' : 'font-medium text-encre'}>Étape {l.statut}</span>
            </p>
            {l.inchangee ? (
              <p className="pl-7 text-md text-encre-3">{l.a!.intention}</p>
            ) : (
              <div className="grid gap-2 lg:grid-cols-2">
                <ColonneEtape titre={`v${ancienne.numero}`} etape={l.a} />
                <ColonneEtape titre={`v${recente.numero}`} etape={l.b} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default async function PageScript({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; scriptId: string }>;
  searchParams: Promise<{ version?: string; comparer?: string }>;
}) {
  const { slug, scriptId } = await params;
  const { version, comparer } = await searchParams;
  const entreprise = await entrepriseParSlug(slug);
  if (!/^[0-9a-f-]{36}$/.test(scriptId)) notFound();
  const [script] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.entrepriseId, entreprise.id)));
  if (!script) notFound();

  const versions = await db.select().from(versionsScript).where(eq(versionsScript.scriptId, script.id)).orderBy(desc(versionsScript.numero));
  const derniere = versions[0];
  if (!derniere) notFound();
  const affichee = versions.find((v) => String(v.numero) === version) ?? derniere;
  const cible = comparer ? versions.find((v) => String(v.numero) === comparer && v.id !== affichee.id) : undefined;
  const base = `/entreprises/${slug}/scripts/${script.id}`;
  const lienVersion = (n: number) => (n === derniere.numero ? base : `${base}?version=${n}`);

  const [analyse, servies, listeProspects, usage] = await Promise.all([
    analyseEntreprise(entreprise.id, false),
    db
      .select({ versionScriptId: campagnes.versionScriptId, statut: campagnes.statut })
      .from(campagnes)
      .where(
        and(
          inArray(
            campagnes.versionScriptId,
            versions.map((v) => v.id),
          ),
          inArray(campagnes.statut, ['en-cours', 'en-pause']),
        ),
      ),
    db
      .select({ id: prospects.id, nom: prospects.nom })
      .from(prospects)
      .where(and(eq(prospects.entrepriseId, entreprise.id), isNull(prospects.archiveLe)))
      .orderBy(asc(prospects.nom), asc(prospects.id)),
    usageDuScript(script.id),
  ]);
  const chiffres = new Map(analyse.parVersion.map((v) => [v.versionScriptId, v]));
  const numeroDe = new Map(versions.map((v) => [v.id, v.numero]));
  const gardes = [
    ...new Map(
      servies.map((c) => {
        const cle = `${c.statut}-${c.versionScriptId}`;
        return [cle, { statut: c.statut, numero: numeroDe.get(c.versionScriptId) ?? 0 }] as const;
      }),
    ).values(),
  ].sort((a, b) => (a.statut === b.statut ? b.numero - a.numero : a.statut === 'en-cours' ? -1 : 1));

  return (
    <Page largeur="lecture">
      <div className="grid max-w-[56rem] grid-cols-[minmax(0,1fr)] gap-6">
        <div className="grid gap-1">
          <Link
            href={`/entreprises/${slug}/scripts`}
            className="justify-self-start text-sm text-encre-3 decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline"
          >
            Scripts
          </Link>
          <h2 className="text-lg font-semibold text-balance">
            {script.nom} <span className="ml-1 font-mono text-md font-normal text-encre-3">v{affichee.numero}</span>
          </h2>
          <ActionsScript entrepriseId={entreprise.id} scriptId={script.id} nom={script.nom} archive={script.archive} usage={usage} />
        </div>

        <nav aria-label="Versions du script" className="border-b border-filet pb-2">
          <ol className="flex flex-wrap gap-x-6 gap-y-2">
            {versions.map((v) => {
              const c = chiffres.get(v.id);
              const actuelle = v.id === affichee.id;
              return (
                <li key={v.id}>
                  <Link
                    href={lienVersion(v.numero)}
                    aria-current={actuelle ? 'page' : undefined}
                    className={`group grid gap-0.5 rounded-[4px] py-1 ${actuelle ? '' : 'hover:text-encre-2'}`}
                  >
                    <span
                      className={`justify-self-start font-mono text-md ${
                        actuelle ? 'font-semibold text-encre shadow-[inset_0_-1.5px_0_var(--encre)]' : 'text-encre-3 decoration-souligne underline-offset-4 group-hover:underline'
                      }`}
                    >
                      v{v.numero}
                    </span>
                    <span className="grid text-xs text-encre-3">
                      <span>
                        <span className="font-mono">{c?.conversations ?? 0}</span> {(c?.conversations ?? 0) > 1 ? 'appels aboutis' : 'appel abouti'} ·{' '}
                        <span className="font-mono">{c?.rendezVous ?? 0}</span> rendez-vous
                      </span>
                      <time dateTime={v.creeLe.toISOString()} className="font-mono">
                        {JOUR_MOIS.format(v.creeLe)}
                      </time>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        {gardes.length > 0 ? (
          <div className="grid gap-0.5 text-sm text-encre-2">
            {gardes.map((g) => (
              <p key={`${g.statut}-${g.numero}`}>
                <span className="text-encre">{g.statut === 'en-cours' ? 'La campagne en cours' : 'La campagne suspendue'}</span>{' '}
                garde la <span className="font-mono">v{g.numero}</span> : une nouvelle version ne la change pas.
              </p>
            ))}
          </div>
        ) : null}

        <EspaceVersion
          entrepriseId={entreprise.id}
          scriptId={script.id}
          base={base}
          etapes={affichee.etapes}
          numeroAffiche={affichee.numero}
          numeroDerniere={derniere.numero}
          lienComparer={affichee.id !== derniere.id && !cible ? `${base}?version=${affichee.numero}&comparer=${derniere.numero}` : null}
          lienFermerComparaison={cible ? lienVersion(affichee.numero) : null}
        >
          {cible ? (
            <Comparaison
              ancienne={cible.numero < affichee.numero ? cible : affichee}
              recente={cible.numero < affichee.numero ? affichee : cible}
            />
          ) : (
            <LectureVersion etapes={affichee.etapes} />
          )}
        </EspaceVersion>

        <ApercuMina
          entrepriseId={entreprise.id}
          prospects={listeProspects}
          versionFixe={affichee.id}
          numeroVersion={affichee.numero}
        />
      </div>
    </Page>
  );
}
