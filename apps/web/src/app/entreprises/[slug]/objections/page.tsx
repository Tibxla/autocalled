import { asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { db } from '@/db';
import { objections } from '@/db/schema';
import { analyseEntreprise } from '@/lib/lecture';
import { assistantePourLaPage, entrepriseParSlug } from '@/lib/pages';
import { ListeObjections, type ChiffresObjection } from './liste-objections';

export const metadata: Metadata = { title: 'Objections' };

export default async function PageObjections({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ objection?: string }>;
}) {
  const { slug } = await params;
  const { objection: demandee } = await searchParams;
  const entreprise = await entrepriseParSlug(slug);
  const { nom } = await assistantePourLaPage();
  const [liste, analyse] = await Promise.all([
    db
      .select({
        id: objections.id,
        libelle: objections.libelle,
        creuser: objections.creuser,
        reformuler: objections.reformuler,
        argumenter: objections.argumenter,
        controler: objections.controler,
        archivee: objections.archivee,
        modifieLe: objections.modifieLe,
      })
      .from(objections)
      .where(eq(objections.entrepriseId, entreprise.id))
      .orderBy(asc(objections.ordre), asc(objections.id)),
    // Les appels réels seulement : un appel simulé ne dit pas ce qu'un vrai prospect objecte.
    analyseEntreprise(entreprise.id, false),
  ]);

  const chiffres: Record<string, ChiffresObjection> = {};
  for (const o of analyse.parObjection) {
    if (o.objectionId) chiffres[o.objectionId] = { apparitions: o.apparitions, levees: o.levees, temps: o.tempsBloquantPrincipal };
  }
  const versClient = (o: (typeof liste)[number]) => ({
    id: o.id,
    libelle: o.libelle,
    creuser: o.creuser,
    reformuler: o.reformuler,
    argumenter: o.argumenter,
    controler: o.controler,
    modifieLe: o.modifieLe.toISOString(),
  });

  return (
    <Page largeur="lecture">
      <div className="grid max-w-[52rem] grid-cols-[minmax(0,1fr)] gap-6">
        {/* Sous 640 px, la première phrase seule. */}
        <p className="max-w-[62ch] text-sm text-encre-3">
          {nom} traite chaque objection en quatre temps : creuser, reformuler, argumenter, contrôler (CRAC).{' '}
          <span className="max-sm:hidden">Les bilans disent à quel temps une objection a coincé.</span>
        </p>
        <ListeObjections
          entrepriseId={entreprise.id}
          actives={liste.filter((o) => !o.archivee).map(versClient)}
          archivees={liste.filter((o) => o.archivee).map(versClient)}
          chiffres={chiffres}
          ouverteInitiale={demandee ?? null}
        />
      </div>
    </Page>
  );
}
