import { and, desc, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { comptesCampagne } from '@/components/format-appel';
import { db } from '@/db';
import { campagnes, prospects } from '@/db/schema';
import { autorisationsDe } from '@/lib/autorisations';
import { listerEntreprises, trouverEntreprise } from '@/lib/donnees';
import { ChoixEntreprise } from './choix-entreprise';
import { OngletsEntreprise } from './onglets-entreprise';

/**
 * En-tête commun à tous les onglets d'une entreprise (Prospects et Campagnes compris) : nom, sélecteur,
 * ligne d'état de préparation et onglets. N'impose aucune largeur : chaque page choisit la sienne.
 *
 * Ce layout lit la base sans cache et bloque la navigation qui y entre (aucun loading.tsx ne le couvre) :
 * ses lectures sont légères et parallèles. Un slug inconnu ne lève pas notFound() ici, sinon la 404 sortirait
 * du segment : l'en-tête s'efface et la page, qui lit la même entreprise, répond par [slug]/not-found.tsx.
 */
export default async function LayoutEntreprise({ params, children }: { params: Promise<{ slug: string }>; children: React.ReactNode }) {
  const { slug } = await params;
  const entreprise = await trouverEntreprise(slug);
  if (!entreprise) return <>{children}</>;

  const [liste, appelables, campagnesActives] = await Promise.all([
    listerEntreprises(),
    db
      .select({ telephone: prospects.telephone })
      .from(prospects)
      .where(eq(prospects.entrepriseId, entreprise.id))
      .then(async (lignes) => {
        const autorisations = await autorisationsDe(lignes.map((l) => l.telephone));
        return lignes.filter((l) => autorisations.get(l.telephone)?.autorise).length;
      }),
    db
      .select({ id: campagnes.id, statut: campagnes.statut, entrees: campagnes.entrees })
      .from(campagnes)
      .where(and(eq(campagnes.entrepriseId, entreprise.id), inArray(campagnes.statut, ['en-cours', 'en-pause'])))
      .orderBy(desc(campagnes.creeLe)),
  ]);

  const comptes = liste.find((e) => e.id === entreprise.id) ?? { nombreProspects: 0, nombreObjections: 0, nombreScripts: 0 };
  const autres = liste.filter((e) => e.id !== entreprise.id).map((e) => ({ slug: e.slug, nom: e.nom }));
  const base = `/entreprises/${slug}`;
  const campagne = campagnesActives.find((c) => c.statut === 'en-cours') ?? campagnesActives[0];

  const manque = (href: string, texte: string) => (
    <Link href={href} className="text-encre-2 underline decoration-souligne underline-offset-4 hover:text-encre">
      {texte}
    </Link>
  );
  const pluriel = (n: number, un: string, plusieurs: string) => (n > 1 ? plusieurs : un);

  const etat: { cle: string; contenu: React.ReactNode }[] = [
    { cle: 'offre', contenu: entreprise.offre.trim() ? 'Offre décrite' : manque(base, 'Offre à écrire') },
    {
      cle: 'scripts',
      contenu:
        comptes.nombreScripts > 0 ? (
          <>
            <span className="font-mono">{comptes.nombreScripts}</span> {pluriel(comptes.nombreScripts, 'script', 'scripts')}
          </>
        ) : (
          manque(`${base}/scripts`, 'Aucun script')
        ),
    },
    {
      cle: 'prospects',
      contenu:
        comptes.nombreProspects === 0 ? (
          manque(`${base}/prospects`, 'Aucun prospect')
        ) : appelables === 0 ? (
          manque(`${base}/prospects`, 'Aucun numéro autorisé')
        ) : (
          <>
            <span className="font-mono">{appelables}</span> {pluriel(appelables, 'appelable', 'appelables')} sur{' '}
            <span className="font-mono">{comptes.nombreProspects}</span>
          </>
        ),
    },
    {
      cle: 'objections',
      contenu:
        comptes.nombreObjections > 0 ? (
          <>
            <span className="font-mono">{comptes.nombreObjections}</span> {pluriel(comptes.nombreObjections, 'objection', 'objections')}
          </>
        ) : (
          manque(`${base}/objections`, 'Aucune objection')
        ),
    },
  ];
  if (campagne) {
    const { traites, total } = comptesCampagne(campagne.entrees);
    const enCours = campagne.statut === 'en-cours';
    etat.push({
      cle: 'campagne',
      contenu: (
        <Link
          href={`/campagnes/${campagne.id}`}
          className={`underline decoration-souligne underline-offset-4 hover:text-encre ${enCours ? 'text-antenne' : 'text-encre-2'}`}
        >
          {enCours ? 'Campagne en cours' : 'Campagne suspendue'} ·{' '}
          <span className="font-mono">
            {traites}/{total}
          </span>
        </Link>
      ),
    });
  }

  return (
    <>
      <div className="pt-8 max-sm:pt-6">
        <Link
          href="/entreprises"
          className="text-sm text-encre-3 decoration-souligne underline-offset-4 hover:text-encre-2 hover:underline"
        >
          Entreprises
        </Link>
        <div className="mt-1 flex items-center gap-1.5">
          <h1 className="min-w-0 text-xl font-semibold tracking-[-0.01em] text-balance break-words">{entreprise.nom}</h1>
          {autres.length > 0 ? <ChoixEntreprise slug={slug} autres={autres} /> : null}
        </div>
        <p className="mt-1.5 flex flex-wrap gap-x-2 text-sm text-encre-3">
          {etat.map((e, i) => (
            <span key={e.cle} className="whitespace-nowrap">
              {e.contenu}
              {i < etat.length - 1 ? (
                <span aria-hidden="true" className="ml-2 text-encre-3">
                  ·
                </span>
              ) : null}
            </span>
          ))}
        </p>
      </div>
      <OngletsEntreprise
        slug={slug}
        comptes={{ scripts: comptes.nombreScripts, objections: comptes.nombreObjections, prospects: comptes.nombreProspects }}
      />
      <div className="pt-6">{children}</div>
    </>
  );
}
