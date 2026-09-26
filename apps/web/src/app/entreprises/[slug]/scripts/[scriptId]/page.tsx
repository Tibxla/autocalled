import { and, desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TitreSection } from '@/components/ui';
import { db } from '@/db';
import { scripts, versionsScript } from '@/db/schema';
import { entrepriseParSlug } from '@/lib/donnees';
import { EditeurVersion } from './editeur-version';

export const metadata: Metadata = { title: 'Script' };

const dateCourte = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

export default async function PageScript({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; scriptId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { slug, scriptId } = await params;
  const { version } = await searchParams;
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
  const base = `/entreprises/${slug}/scripts/${script.id}`;

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_14rem]">
      <div className="grid content-start gap-8">
        <div className="grid gap-1">
          <Link href={`/entreprises/${slug}/scripts`} className="text-sm text-encre-3 hover:text-encre">
            Scripts
          </Link>
          <h2 className="text-lg font-semibold">
            {script.nom} <span className="font-mono text-base font-normal text-encre-3">v{affichee.numero}</span>
          </h2>
        </div>

        {affichee.numero === derniere.numero ? (
          <>
          <p className="text-sm text-encre-2">
            La <span className="font-mono">v{derniere.numero}</span> est figée : tes modifications créeront la{' '}
            <span className="font-mono">v{derniere.numero + 1}</span>.
          </p>
          <EditeurVersion
            key={derniere.id}
            entrepriseId={entreprise.id}
            scriptId={script.id}
            etapes={derniere.etapes}
            prochainNumero={derniere.numero + 1}
          />
          </>
        ) : (
          <section className="grid gap-4">
            <p className="text-sm text-encre-2">Version figée, en lecture seule.</p>
            <ol className="border-y border-filet">
              {affichee.etapes.map((etape, i) => (
                <li key={i} className="grid gap-2 border-b border-filet py-4 last:border-b-0 sm:grid-cols-[2rem_1fr]">
                  <span className="font-mono text-sm text-encre-3">{i + 1}</span>
                  <div className="grid gap-1.5">
                    <p>{etape.intention}</p>
                    {etape.exemples.map((ex, j) => (
                      <p key={j} className="text-sm text-encre-2">
                        « {ex} »
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      <aside className="grid content-start gap-3">
        <TitreSection>Versions</TitreSection>
        <ol className="grid gap-0.5">
          {versions.map((v) => (
            <li key={v.id}>
              <Link
                href={v.numero === derniere.numero ? base : `${base}?version=${v.numero}`}
                aria-current={v.id === affichee.id ? 'page' : undefined}
                className="flex items-baseline justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm text-encre-2 hover:bg-survol aria-[current=page]:bg-survol aria-[current=page]:text-encre"
              >
                <span className="font-mono">v{v.numero}</span>
                <span className="font-mono text-xs text-encre-3">{dateCourte.format(v.creeLe)}</span>
              </Link>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
