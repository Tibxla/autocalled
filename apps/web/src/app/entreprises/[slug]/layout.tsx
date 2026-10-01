import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { comptesCampagne } from '@/components/format-appel';
import { LienTexte } from '@/components/ui';
import { db } from '@/db';
import { campagnes, prospects } from '@/db/schema';
import { appelabiliteDe } from '@/lib/appelables';
import { listerEntreprises } from '@/lib/donnees';
import { lireEntreprise } from '@/lib/pages';
import { ChoixEntreprise } from './choix-entreprise';
import { EtatEntreprise } from './etat-entreprise';
import { OngletsEntreprise } from './onglets-entreprise';

/**
 * En-tête commun à tous les onglets d'une entreprise (Prospects et Campagnes compris) : nom, sélecteur,
 * ligne d'état de préparation et onglets. N'impose aucune largeur : chaque page choisit la sienne.
 *
 * Ce layout lit la base sans cache de données et bloque la navigation qui y entre (aucun loading.tsx ne le
 * couvre) : ses lectures sont légères et parallèles. L'entreprise est lue une fois pour le layout et la page
 * (`lireEntreprise`, cache de la requête). Un slug inconnu ne lève pas notFound() ici, sinon la 404 sortirait
 * du segment : l'en-tête s'efface et la page, qui lit la même entreprise, répond par [slug]/not-found.tsx.
 * Sous 640 px, la ligne d'état ne paraît en entier que sur la Fiche (EtatEntreprise) : ailleurs, le lien de la
 * campagne active reste seul, et l'onglet commence plus haut.
 */
export default async function LayoutEntreprise({ params, children }: { params: Promise<{ slug: string }>; children: React.ReactNode }) {
  const { slug } = await params;
  const entreprise = await lireEntreprise(slug);
  if (!entreprise) return <>{children}</>;

  const [liste, appelables, campagnesActives] = await Promise.all([
    listerEntreprises(),
    db
      .select({ telephone: prospects.telephone })
      .from(prospects)
      .where(and(eq(prospects.entrepriseId, entreprise.id), isNull(prospects.archiveLe)))
      .then(async (lignes) => {
        const verifies = await appelabiliteDe(lignes.map((l) => l.telephone));
        return lignes.filter((l) => verifies.get(l.telephone)?.appelable).length;
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
    <LienTexte href={href} className="text-encre-2 underline hover:text-encre">
      {texte}
    </LienTexte>
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
          manque(`${base}/prospects`, 'Aucun prospect à appeler')
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
    const { traites, total, enAppel } = comptesCampagne(campagne.entrees);
    const enCours = campagne.statut === 'en-cours';
    // L'antenne seulement quand un appel de la campagne est en ligne, pas entre deux appels.
    const vivante = enCours && enAppel > 0;
    etat.push({
      cle: 'campagne',
      contenu: (
        <LienTexte
          href={`/campagnes/${campagne.id}`}
          className={`underline hover:text-encre ${vivante ? 'text-antenne' : enCours ? 'text-encre' : 'text-encre-2'}`}
        >
          {enCours ? 'Campagne en cours' : 'Campagne suspendue'} ·{' '}
          <span className="font-mono">
            {traites}/{total}
          </span>
        </LienTexte>
      ),
    });
  }

  return (
    <>
      <div className="pt-8 max-sm:pt-4">
        <LienTexte isole href="/entreprises" className="text-sm text-encre-3 hover:text-encre-2">
          Entreprises
        </LienTexte>
        <div className="relative mt-1 flex items-center gap-1.5">
          <h1 className="min-w-0 text-xl font-semibold tracking-[-0.01em] text-balance break-words">{entreprise.nom}</h1>
          {autres.length > 0 ? <ChoixEntreprise slug={slug} autres={autres} /> : null}
        </div>
        <EtatEntreprise base={base} elements={etat} />
      </div>
      <OngletsEntreprise
        slug={slug}
        comptes={{ scripts: comptes.nombreScripts, objections: comptes.nombreObjections, prospects: comptes.nombreProspects }}
      />
      <div className="pt-6">{children}</div>
    </>
  );
}
