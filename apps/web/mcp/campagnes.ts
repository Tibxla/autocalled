import type { McpServer } from '@modelcontextprotocol/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { campagnes, entreprises, prospects } from '@/db/schema';
import { autorisationsDe } from '@/lib/autorisations';
import { PROSPECTS_ARCHIVES, ajouterALaCampagne, retirerProspect, sauterProspect, supprimerCampagnePrete, terminerCampagne } from '@/lib/campagnes';
import { numeroLisible } from '@/lib/format';
import { ajoutParMcp } from '@/lib/prospects';
import { champProspect } from './communs';
import { champ, confirmer, heureDeParis, refusDeConfirmation } from './confirmation';
import { numerosDuMcp } from './gardes-appel';
import { type Declarer, refus, reussite } from './outil';

/**
 * Les gestes sur la file d'une campagne, les mêmes que la régie de l'interface : sauter, retirer, ajouter, terminer,
 * et supprimer une campagne jamais lancée. Retirer et terminer sont des freins ; ajouter à une campagne téléphone en
 * cours fait sonner des téléphones sans autre geste, et demande donc la confirmation de l'opérateur.
 */

const ECRITURE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const champCampagne = z.uuid().describe('Identifiant de la campagne (donné par lister_campagnes).');

async function campagneEtEntreprise(campagneId: string) {
  const [c] = await db
    .select({ campagne: campagnes, entreprise: entreprises.nom })
    .from(campagnes)
    .innerJoin(entreprises, eq(entreprises.id, campagnes.entrepriseId))
    .where(eq(campagnes.id, campagneId));
  return c ?? null;
}

export function outilsDeCampagnes(declarer: Declarer, serveur: McpServer): void {
  declarer(
    'supprimer_campagne',
    {
      description: 'Supprime une campagne prête, jamais lancée (rien n’a été appelé ; elle se recrée par nouvelle_campagne). Une campagne lancée est de l’historique : terminer_campagne l’arrête.',
      entree: z.strictObject({ campagneId: champCampagne }),
      annotations: ECRITURE,
    },
    async ({ campagneId }) => {
      const r = await supprimerCampagnePrete(campagneId);
      return r.ok ? reussite({ campagneId, supprimee: true }) : refus(r.raison);
    },
  );

  declarer(
    'sauter_dans_la_file',
    {
      description: 'Renvoie un prospect encore à appeler en fin de file. N’appelle personne : une campagne en cours enchaîne sur le suivant comme d’habitude.',
      entree: z.strictObject({ campagneId: champCampagne, prospect: champProspect }),
      annotations: ECRITURE,
    },
    async ({ campagneId, prospect }) => {
      const r = await sauterProspect(campagneId, prospect);
      return r.ok ? reussite({ campagneId, prospect, reporte: true }) : refus(r.raison);
    },
  );

  declarer(
    'retirer_de_la_file',
    {
      description:
        'Retire un prospect encore à appeler de la file : il ne sera pas appelé dans cette campagne (la trace reste). Retirer le dernier termine la campagne, après l’appel en cours. C’est un frein : il ne demande pas de confirmation.',
      entree: z.strictObject({ campagneId: champCampagne, prospect: champProspect }),
      annotations: ECRITURE,
    },
    async ({ campagneId, prospect }) => {
      const r = await retirerProspect(campagneId, prospect, 'mcp');
      return r.ok ? reussite({ campagneId, prospect, retire: true, campagneTerminee: r.terminee }) : refus(r.raison);
    },
  );

  declarer(
    'terminer_campagne',
    {
      description:
        'Termine une campagne avant la fin : chaque prospect encore à appeler est retiré (trace gardée). Aucun appel n’est coupé : l’appel en cours va à son terme et rien ne s’enchaîne. C’est un frein : il ne demande pas de confirmation.',
      entree: z.strictObject({ campagneId: champCampagne }),
      annotations: ECRITURE,
    },
    async ({ campagneId }) => {
      const r = await terminerCampagne(campagneId, 'mcp');
      return r.ok ? reussite({ campagneId, fin: r.fin }) : refus(r.raison);
    },
  );

  declarer(
    'ajouter_a_la_campagne',
    {
      description:
        'Ajoute des prospects de l’entreprise en fin de file d’une campagne non terminée (non archivés, numéro autorisé à cet instant, script non archivé, aucun doublon ; tout ou rien). Sur une campagne téléphone en cours, ils seront appelés à la suite sans autre geste : l’opérateur confirme.',
      entree: z.strictObject({ campagneId: champCampagne, prospects: z.array(champProspect).min(1, 'Choisis au moins un prospect.').max(200) }),
      annotations: { ...ECRITURE, openWorldHint: true },
    },
    async ({ campagneId, prospects: demandes }, ctx) => {
      const c = await campagneEtEntreprise(campagneId);
      if (!c) return refus('Campagne introuvable.');
      const ids = [...new Set(demandes)];
      let confirmation: 'acceptee' | undefined;
      if (c.campagne.ligne === 'bluetooth' && c.campagne.statut === 'en-cours') {
        // Contrôlé ici pour ne rien demander à l'opérateur en vain ; ajouterALaCampagne revérifie tout sous verrou.
        const trouves = await db
          .select({ id: prospects.id, nom: prospects.nom, telephone: prospects.telephone, archiveLe: prospects.archiveLe })
          .from(prospects)
          .where(and(eq(prospects.entrepriseId, c.campagne.entrepriseId), inArray(prospects.id, ids)));
        const inconnus = ids.filter((id) => !trouves.some((p) => p.id === id));
        if (inconnus.length) return refus(`Prospect introuvable dans cette entreprise : ${inconnus.join(', ')}. Rien n’a été ajouté.`);
        const archives = trouves.filter((p) => p.archiveLe);
        if (archives.length) return refus(`${PROSPECTS_ARCHIVES} : ${archives.map((p) => p.nom).join(', ')}. Rien n’a été ajouté.`);
        const autorisations = await autorisationsDe(trouves.map((p) => p.telephone));
        const nonAutorises = trouves.filter((p) => !autorisations.get(p.telephone)?.autorise);
        if (nonAutorises.length) return refus(`Numéro non autorisé : ${nonAutorises.map((p) => p.nom).join(', ')}. Rien n’a été ajouté.`);
        const ordonnes = ids.map((id) => trouves.find((p) => p.id === id)!);
        const parMcp = await Promise.all(ordonnes.map((p) => ajoutParMcp(p.telephone)));
        const garde = await confirmer(
          serveur,
          ctx,
          `Ajouter à la campagne de ${champ(c.entreprise)}, en cours sur le téléphone passerelle, ${ordonnes.length} prospect${ordonnes.length > 1 ? 's' : ''} qui ${ordonnes.length > 1 ? 'seront appelés' : 'sera appelé'} à la suite sans autre geste : ${ordonnes
            .map((p) => `${numeroLisible(p.telephone)} (${champ(p.nom, 40)})`)
            .join(', ')}.${numerosDuMcp(ordonnes.map((p, i) => ({ ...p, ajout: parMcp[i] ?? null })))} Nous sommes ${heureDeParis()}.`,
          ['ajouter_a_la_campagne', campagneId, c.campagne.statut, ids, ordonnes.map((p) => p.telephone), parMcp.filter(Boolean).length],
        );
        if (garde.etat === 'a-demander') return garde.issue;
        if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
        confirmation = 'acceptee';
      }
      const r = await ajouterALaCampagne(campagneId, ids);
      return r.ok ? reussite({ campagneId, ajoutes: r.ajoutes }, { confirmation }) : refus(r.raison, confirmation);
    },
  );
}
