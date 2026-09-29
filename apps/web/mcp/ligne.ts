import { TransitionInvalide } from '@autocalled/domain';
import type { McpServer } from '@modelcontextprotocol/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { appels, campagnes, entreprises, prospects, rendezVous } from '@/db/schema';
import { creerEvenementDuRendezVous, etatAgenda, synchroniserAgenda } from '@/lib/agenda';
import { appelerParTelephone, enregistrerAppelSimule, preparerAppel, reanalyser, simulerAppel } from '@/lib/appels';
import { autorisationsDe } from '@/lib/autorisations';
import { appelerSuivantTelephone, demarrerCampagne } from '@/lib/campagnes';
import { trouverEntreprise, trouverProspect } from '@/lib/donnees';
import { numeroLisible } from '@/lib/format';
import { commanderPont, type ReglagesLigne, refusDuPont, reglagesDuPont } from '@/lib/pont';
import { champEntreprise, champProspect, champVersion, entrepriseInconnue, prospectInconnu, versionDeLEntreprise, vueAppel } from './communs';
import { confirmer, heureDeParis, refusDeConfirmation } from './confirmation';
import { type Declarer, refus, reussite } from './outil';
import { type Detacher, detacherTache } from './tache';

/**
 * La ligne réelle : appels, campagnes, réglages du pont, analyse et agenda. Ce qui fait sonner le téléphone
 * ou écrit à un prospect passe par `confirmer` ; les freins (raccrocher, suspendre, baisser un plafond) jamais.
 */

const plafonds = (r: ReglagesLigne) => `${r.appelsParHeure} appels par heure et ${r.appelsParJour} par jour, ${r.pauseEntreAppelsS} s de pause entre deux appels de campagne`;

export function outilsDeLigne(declarer: Declarer, serveur: McpServer, detacher: Detacher = detacherTache): void {
  declarer(
    'lancer_appel',
    {
      description:
        'Appelle un prospect. Ligne bluetooth : le téléphone passerelle compose le vrai numéro, après confirmation de l’opérateur ; l’outil rend la main dès que ça sonne (suivre avec lire_appel). Ligne simulation : un modèle joue le prospect, sans téléphone ; l’outil attend le bilan (une à trois minutes). Le numéro doit être autorisé.',
      entree: z.strictObject({ entreprise: champEntreprise, prospect: champProspect, versionScriptId: champVersion, ligne: z.enum(['bluetooth', 'simulation']) }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ entreprise: slug, prospect: id, versionScriptId, ligne }, ctx) => {
      const e = await trouverEntreprise(slug);
      if (!e) return refus(entrepriseInconnue(slug));
      const p = await trouverProspect(e.id, id);
      if (!p) return refus(prospectInconnu(id));
      const version = await versionDeLEntreprise(e.id, versionScriptId);
      if (!version) return refus('Cette version de script n’appartient pas à cette entreprise.');
      // Contrôlé ici pour ne rien demander à l'opérateur en vain, puis de nouveau au dernier moment.
      const preparation = await preparerAppel(e.id, p.id, version.id);
      if (!preparation.ok) return refus(preparation.raison);

      if (ligne === 'simulation') {
        const appel = await enregistrerAppelSimule(e.id, p.id, version.id);
        if (!appel.ok) return refus(appel.raison);
        await simulerAppel(appel.appelId, appel.variables);
        return reussite((await vueAppel(appel.appelId))?.donnees ?? { appelId: appel.appelId });
      }

      const plafond = await refusDuPont();
      if (plafond) return refus(plafond);
      const reglages = await reglagesDuPont();
      const garde = confirmer(
        serveur,
        ctx,
        `Appeler maintenant ${p.nom}${p.societe ? ` (${p.societe})` : ''} au ${numeroLisible(preparation.numero)}, pour ${e.nom}, avec le script « ${version.libelle} », depuis le téléphone passerelle. Nous sommes ${heureDeParis()}.${reglages ? ` Garde-fous de la ligne : ${plafonds(reglages)}.` : ''}`,
        ['lancer_appel', e.id, p.id, version.id, preparation.numero],
      );
      if (garde.etat === 'a-demander') return garde.issue;
      if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
      const r = await appelerParTelephone(e.id, p.id, version.id);
      return r.ok
        ? reussite({ appelId: r.appelId, statut: 'en-cours', suivi: 'lire_appel donne le bilan une fois l’appel fini ; raccrocher_appel l’arrête.' }, { confirmation: 'acceptee' })
        : refus(r.raison, 'acceptee');
    },
  );

  declarer(
    'raccrocher_appel',
    {
      description: 'Raccroche un appel en cours sur le téléphone passerelle. C’est un frein : il ne demande pas de confirmation.',
      entree: z.strictObject({ appelId: z.uuid() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ appelId }) => {
      const [a] = await db.select({ ligne: appels.ligne }).from(appels).where(eq(appels.id, appelId));
      if (!a) return refus('Appel inconnu.');
      if (a.ligne !== 'bluetooth') return refus('Seul un appel sur le téléphone passerelle se raccroche d’ici.');
      const r = await commanderPont(`/appels/${appelId}/raccrocher`, {});
      return r.ok ? reussite({ appelId, raccroche: true }) : refus(r.raison);
    },
  );

  declarer(
    'lancer_campagne',
    {
      description:
        'Lance (ou reprend) une campagne prête ou en pause. Ligne bluetooth : après confirmation de l’opérateur, le premier appel part, puis l’application enchaîne les suivants un à un. Ligne simulation : les appels simulés s’enchaînent dans un processus détaché (dix à trente minutes ; suivre avec lire_campagne). Une campagne sur la ligne navigateur se déroule dans l’interface.',
      entree: z.strictObject({ campagneId: z.uuid() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ campagneId }, ctx) => {
      const [c] = await db
        .select({ campagne: campagnes, entreprise: entreprises.nom })
        .from(campagnes)
        .innerJoin(entreprises, eq(entreprises.id, campagnes.entrepriseId))
        .where(eq(campagnes.id, campagneId));
      if (!c) return refus('Campagne inconnue.');
      const { campagne } = c;
      if (campagne.statut !== 'prete' && campagne.statut !== 'en-pause') {
        return refus(`Cette campagne est ${campagne.statut === 'en-cours' ? 'déjà en cours' : 'terminée'} : seule une campagne prête ou en pause se lance.`);
      }
      if (campagne.ligne === 'simulation') {
        try {
          await demarrerCampagne(campagneId);
        } catch (erreur) {
          if (erreur instanceof TransitionInvalide) return refus(erreur.message);
          throw erreur;
        }
        // Elle dure plus longtemps qu'une session : un processus à part la mène à son terme.
        detacher('derouler-simulation', campagneId);
        return reussite({ campagneId, statut: 'en-cours', suivi: 'lire_campagne montre l’avancement ; suspendre_campagne l’arrête après l’appel en cours.' });
      }
      if (campagne.ligne !== 'bluetooth') {
        return refus('Cette campagne se déroule dans le navigateur de l’opérateur : lance-la depuis l’interface (page de la campagne).');
      }

      const plafond = await refusDuPont();
      if (plafond) return refus(plafond);
      const aAppeler = campagne.entrees.filter((x) => x.etat === 'a-appeler');
      const telephones = await db
        .select({ id: prospects.id, telephone: prospects.telephone })
        .from(prospects)
        .where(eq(prospects.entrepriseId, campagne.entrepriseId));
      const numeros = aAppeler.map((x) => telephones.find((p) => p.id === x.prospectId)?.telephone ?? '');
      const autorisations = await autorisationsDe(numeros.filter(Boolean));
      const autorises = numeros.filter((n) => autorisations.get(n)?.autorise).length;
      const [version, reglages] = await Promise.all([versionDeLEntreprise(campagne.entrepriseId, campagne.versionScriptId), reglagesDuPont()]);
      const garde = confirmer(
        serveur,
        ctx,
        `${campagne.statut === 'prete' ? 'Lancer' : 'Reprendre'} la campagne de ${c.entreprise} sur le téléphone passerelle : ${aAppeler.length} prospect${aAppeler.length > 1 ? 's' : ''} à appeler l’un après l’autre, dont ${autorises} au numéro autorisé à cet instant (les autres seront sautés), avec le script « ${version?.libelle ?? '?'} ». Nous sommes ${heureDeParis()}.${reglages ? ` Garde-fous : ${plafonds(reglages)} ; plafond atteint, la campagne se met en pause.` : ''}`,
        ['lancer_campagne', campagneId, campagne.statut, aAppeler.map((x) => x.prospectId), autorises],
      );
      if (garde.etat === 'a-demander') return garde.issue;
      if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);

      try {
        await demarrerCampagne(campagneId);
      } catch (erreur) {
        if (erreur instanceof TransitionInvalide) return refus(erreur.message, 'acceptee');
        throw erreur;
      }
      await appelerSuivantTelephone(campagneId);
      const [apres] = await db.select().from(campagnes).where(eq(campagnes.id, campagneId));
      const ouvert = apres?.entrees.find((x) => x.etat === 'en-appel');
      return reussite(
        { campagneId, statut: apres?.statut, appelEnCours: ouvert && 'appelId' in ouvert ? { prospect: ouvert.prospectId, appelId: ouvert.appelId } : null },
        { confirmation: 'acceptee' },
      );
    },
  );

  declarer(
    'regler_ligne',
    {
      description:
        'Règle les garde-fous du téléphone passerelle : plafonds d’appels par heure et par jour, pause entre deux appels de campagne. Les valeurs absentes restent. Resserrer se fait sans confirmation ; desserrer (plafond plus haut, pause plus courte) demande celle de l’opérateur.',
      entree: z
        .strictObject({
          appelsParHeure: z.int().min(1).max(60).optional(),
          appelsParJour: z.int().min(1).max(500).optional(),
          pauseEntreAppelsS: z.int().min(5).max(600).optional(),
        })
        .refine((r) => Object.values(r).some((v) => v !== undefined), 'Donne au moins un réglage.'),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    },
    async (saisie, ctx) => {
      const actuels = await reglagesDuPont();
      if (!actuels) return refus('Le pont Bluetooth ne répond pas : le service autocalled-pont tourne-t-il ?');
      const nouveaux: ReglagesLigne = {
        appelsParHeure: saisie.appelsParHeure ?? actuels.appelsParHeure,
        appelsParJour: saisie.appelsParJour ?? actuels.appelsParJour,
        pauseEntreAppelsS: saisie.pauseEntreAppelsS ?? actuels.pauseEntreAppelsS,
      };
      const desserres = [
        nouveaux.appelsParHeure > actuels.appelsParHeure && `appels par heure ${actuels.appelsParHeure} → ${nouveaux.appelsParHeure}`,
        nouveaux.appelsParJour > actuels.appelsParJour && `appels par jour ${actuels.appelsParJour} → ${nouveaux.appelsParJour}`,
        nouveaux.pauseEntreAppelsS < actuels.pauseEntreAppelsS && `pause entre appels ${actuels.pauseEntreAppelsS} s → ${nouveaux.pauseEntreAppelsS} s`,
      ].filter(Boolean);
      let confirmation: 'acceptee' | undefined;
      if (desserres.length) {
        const garde = confirmer(
          serveur,
          ctx,
          `Desserrer les garde-fous du téléphone passerelle : ${desserres.join(', ')}. Ils évitent les rafales d’appels qui font signaler un numéro comme démarchage.`,
          ['regler_ligne', actuels, nouveaux],
        );
        if (garde.etat === 'a-demander') return garde.issue;
        if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
        confirmation = 'acceptee';
      }
      const r = await commanderPont('/reglages', nouveaux);
      return r.ok ? reussite(r.corps, { confirmation }) : refus(r.raison, confirmation);
    },
  );

  declarer(
    'relancer_analyse',
    {
      description: 'Recalcule le bilan d’un appel (nouvelle version de l’analyseur, ou analyse en échec) et le renvoie. Passe par claude -p : une à deux minutes.',
      entree: z.strictObject({ appelId: z.uuid() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async ({ appelId }) => {
      const [a] = await db
        .select({ statut: appels.statut, ligne: appels.ligne, conversationId: appels.conversationId, transcription: appels.transcription })
        .from(appels)
        .where(eq(appels.id, appelId));
      if (!a) return refus('Appel inconnu.');
      if (a.statut === 'traitement') return refus('Le bilan de cet appel est déjà en cours de calcul.');
      if (a.statut === 'en-cours' && a.ligne === 'bluetooth') return refus('L’appel est en cours : son bilan sera calculé à la fin.');
      if (!a.transcription && !a.conversationId) return refus('Cet appel n’a ni transcription ni conversation à rapatrier.');
      await reanalyser(appelId);
      return reussite((await vueAppel(appelId))?.donnees);
    },
  );

  declarer(
    'relire_agenda',
    {
      description: 'Relit l’agenda de l’opérateur et remplace la copie des plages occupées (une vingtaine de secondes par le connecteur Google de Claude). En cas d’échec, l’ancienne copie reste.',
      entree: z.strictObject({}),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async () => {
      await synchroniserAgenda();
      const etat = await etatAgenda();
      return etat
        ? reussite({ source: etat.source, synchroniseLe: etat.synchroniseLe, fenetreFin: etat.fenetreFin, plagesOccupees: etat.occupations.length, erreur: etat.erreur })
        : refus('L’agenda n’a pas pu être lu.');
    },
  );

  declarer(
    'recreer_evenement',
    {
      description:
        'Recrée dans Google Agenda l’événement d’un rendez-vous dont la création a échoué ; si le prospect a donné son adresse, Google lui envoie l’invitation. Demande la confirmation de l’opérateur.',
      entree: z.strictObject({ rendezVousId: z.uuid() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ rendezVousId }, ctx) => {
      const [r] = await db
        .select({ rdv: rendezVous, prospect: prospects.nom, entreprise: entreprises.nom, fuseau: entreprises.fuseau })
        .from(rendezVous)
        .innerJoin(appels, eq(appels.id, rendezVous.appelId))
        .innerJoin(entreprises, eq(entreprises.id, appels.entrepriseId))
        .innerJoin(prospects, and(eq(prospects.entrepriseId, appels.entrepriseId), eq(prospects.id, appels.prospectId)))
        .where(eq(rendezVous.id, rendezVousId));
      if (!r) return refus('Rendez-vous inconnu.');
      // Comme le bouton de Réglages : seul un échec se recrée (« à créer » peut être en cours, un doublon partirait).
      if (r.rdv.statut !== 'echec') {
        return refus(r.rdv.statut === 'cree' ? 'L’événement de ce rendez-vous est déjà dans l’agenda.' : 'L’événement de ce rendez-vous est en cours de création.');
      }
      const quand = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: r.fuseau }).format(r.rdv.debut);
      const garde = confirmer(
        serveur,
        ctx,
        `Créer dans Google Agenda la visio de ${r.prospect} (${r.entreprise}) du ${quand}${r.rdv.email ? `, et envoyer l’invitation à ${r.rdv.email}` : ', sans invité : aucun e-mail ne part'}.`,
        ['recreer_evenement', rendezVousId, r.rdv.debut.toISOString(), r.rdv.email],
      );
      if (garde.etat === 'a-demander') return garde.issue;
      if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
      await creerEvenementDuRendezVous(rendezVousId);
      const [apres] = await db.select().from(rendezVous).where(eq(rendezVous.id, rendezVousId));
      return apres?.statut === 'cree'
        ? reussite({ rendezVousId, statut: apres.statut, lienVisio: apres.lienVisio }, { confirmation: 'acceptee' })
        : refus(`La création a encore échoué : ${apres?.erreur ?? 'erreur inconnue'}`, 'acceptee');
    },
  );
}
