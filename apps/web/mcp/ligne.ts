import { TransitionInvalide } from '@autocalled/domain';
import type { McpServer } from '@modelcontextprotocol/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { appels, campagnes, entreprises, prospects, rendezVous } from '@/db/schema';
import { creerEvenementDuRendezVous, etatAgenda, synchroniserAgenda } from '@/lib/agenda';
import { appelerParTelephone, enregistrerAppelSimule, preparerAppel, preparerReanalyse, reanalyser, simulerAppel } from '@/lib/appels';
import { appelabiliteDe } from '@/lib/appelables';
import { appelerSuivantTelephone, demarrerCampagne } from '@/lib/campagnes';
import { trouverEntreprise, trouverProspect } from '@/lib/donnees';
import { numeroLisible } from '@/lib/format';
import { commanderPont, type ReglagesLigne, reconnecterTelephone, refusDuPont, reglagesDuPont } from '@/lib/pont';
import { champEntreprise, champProspect, champVersion, entrepriseInconnue, prospectInconnu, SCRIPT_ARCHIVE, versionDeLEntreprise, vueAppel } from './communs';
import { champ, confirmer, heureDeParis, refusDeConfirmation } from './confirmation';
import { attentionMcp, ecrituresDuMcp } from './gardes-appel';
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
        'Appelle un prospect avec la version d’un script non archivé. Ligne bluetooth : le téléphone passerelle compose le vrai numéro, après confirmation de l’opérateur ; l’outil rend la main dès que ça sonne (suivre avec lire_appel). Ligne simulation : un modèle joue le prospect, sans téléphone ; l’outil attend le bilan (une à trois minutes). Le numéro doit être appelable (valide, et pas celui d’une personne effacée). La ligne navigateur (micro de l’opérateur) se lance dans l’interface.',
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
      if (version.archive) return refus(SCRIPT_ARCHIVE);
      // Contrôlé ici pour ne rien demander à l'opérateur en vain, puis de nouveau au dernier moment.
      const preparation = await preparerAppel(e.id, p.id, version.id);
      if (!preparation.ok) return refus(preparation.raison);

      if (ligne === 'simulation') {
        const appel = await enregistrerAppelSimule(e.id, p.id, version.id);
        if (!appel.ok) return refus(appel.raison);
        await simulerAppel(appel.appelId, appel.variables);
        const vue = await vueAppel(appel.appelId);
        return reussite(vue?.donnees ?? { appelId: appel.appelId }, { complement: vue?.complement });
      }

      const plafond = await refusDuPont();
      if (plafond) return refus(plafond);
      const [reglages, ecritures] = await Promise.all([reglagesDuPont(), ecrituresDuMcp(e.id, version.id)]);
      // Le numéro d'abord : c'est lui qui porte la décision, et les noms viennent d'une fiche.
      const garde = await confirmer(
        serveur,
        ctx,
        `Appeler maintenant le ${numeroLisible(preparation.numero)}, depuis le téléphone passerelle : ${champ(p.nom)}${p.societe ? ` (${champ(p.societe)})` : ''}, pour ${champ(e.nom)}, avec le script « ${champ(version.libelle, 90)} ».${attentionMcp(ecritures)} Nous sommes ${heureDeParis()}.${reglages ? ` Garde-fous de la ligne : ${plafonds(reglages)}.` : ''}`,
        ['lancer_appel', e.id, p.id, version.id, preparation.numero, ecritures],
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
        'Lance (ou reprend) une campagne prête ou en pause. Une campagne prête dont le script a été archivé ne se lance plus ; une campagne en pause garde sa version et se reprend. Ligne bluetooth : après confirmation de l’opérateur, le premier appel part, puis l’application enchaîne les suivants un à un. Ligne simulation : les appels simulés s’enchaînent dans un processus détaché (dix à trente minutes ; suivre avec lire_campagne). Une campagne sur la ligne navigateur se déroule dans l’interface.',
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
      const version = await versionDeLEntreprise(campagne.entrepriseId, campagne.versionScriptId);
      // Archiver un script le sort des lancements : une campagne prête ne part plus. Une campagne en pause, déjà
      // lancée, garde sa version et se reprend.
      if (campagne.statut === 'prete' && version?.archive) return refus(SCRIPT_ARCHIVE);
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
        .select({ id: prospects.id, nom: prospects.nom, telephone: prospects.telephone })
        .from(prospects)
        .where(eq(prospects.entrepriseId, campagne.entrepriseId));
      const fiches = aAppeler.map((x) => telephones.find((p) => p.id === x.prospectId));
      const numeros = fiches.map((p) => p?.telephone ?? '');
      const verifies = await appelabiliteDe(numeros.filter(Boolean));
      const appelables = numeros.filter((n) => verifies.get(n)?.appelable).length;
      const aComposer = fiches.filter((p): p is NonNullable<typeof p> => Boolean(p && verifies.get(p.telephone)?.appelable));
      const [reglages, ecritures] = await Promise.all([reglagesDuPont(), ecrituresDuMcp(campagne.entrepriseId, campagne.versionScriptId)]);
      const nommes = aComposer.slice(0, 20).map((p) => champ(p.nom, 40));
      const garde = await confirmer(
        serveur,
        ctx,
        `${campagne.statut === 'prete' ? 'Lancer' : 'Reprendre'} la campagne de ${champ(c.entreprise)} sur le téléphone passerelle : ${aAppeler.length} prospect${aAppeler.length > 1 ? 's' : ''} à appeler l’un après l’autre, dont ${appelables} au numéro appelable à cet instant (les autres seront sautés), avec le script « ${champ(version?.libelle ?? '?', 90)} ».${
          nommes.length ? ` À appeler : ${nommes.join(', ')}${aComposer.length > nommes.length ? ` et ${aComposer.length - nommes.length} autres` : ''}.` : ''
        }${attentionMcp(ecritures)} Nous sommes ${heureDeParis()}.${reglages ? ` Garde-fous : ${plafonds(reglages)} ; plafond atteint, la campagne se met en pause.` : ''}`,
        // Les numéros entrent dans la clé : un numéro changé entre la question et la réponse fait reposer la question.
        ['lancer_campagne', campagneId, campagne.statut, aAppeler.map((x) => x.prospectId), numeros, appelables, ecritures],
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
        const garde = await confirmer(
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
      description:
        'Recalcule le bilan d’un appel (nouvelle version de l’analyseur, ou analyse en échec) et le renvoie comme lire_appel : le texte du bilan et les citations à part, balisés données non fiables. Passe par claude -p : une à deux minutes.',
      entree: z.strictObject({ appelId: z.uuid() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async ({ appelId }) => {
      if (!(await db.$count(appels, eq(appels.id, appelId)))) return refus('Appel inconnu.');
      // Pose `traitement` avant le travail : pas de double relance ; une analyse bloquée depuis longtemps se relance.
      const pret = await preparerReanalyse(appelId);
      if (!pret.ok) return refus(pret.raison);
      await reanalyser(appelId);
      const vue = await vueAppel(appelId);
      return reussite(vue?.donnees, { complement: vue?.complement });
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
        'Recrée dans Google Agenda l’événement d’un rendez-vous dont l’inscription a échoué ; si le prospect a donné son adresse, Google lui envoie l’invitation. Seul un échec se recrée : un rendez-vous « à créer » peut être en cours de création, et un doublon partirait au prospect. Demande la confirmation de l’opérateur.',
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
      const garde = await confirmer(
        serveur,
        ctx,
        `Créer dans Google Agenda la visio de ${champ(r.prospect)} (${champ(r.entreprise)}) du ${quand}${r.rdv.email ? `, et envoyer l’invitation à ${r.rdv.email}` : ', sans invité : aucun e-mail ne part'}.`,
        ['recreer_evenement', rendezVousId, r.rdv.debut.toISOString(), r.rdv.email],
      );
      if (garde.etat === 'a-demander') return garde.issue;
      if (garde.etat !== 'acceptee') return refusDeConfirmation(garde);
      await creerEvenementDuRendezVous(rendezVousId);
      const [apres] = await db.select().from(rendezVous).where(eq(rendezVous.id, rendezVousId));
      return apres?.statut === 'cree'
        ? reussite({ rendezVousId, statut: apres.statut, lienVisio: apres.lienVisio }, { confirmation: 'acceptee' })
        : refus(`L’inscription a encore échoué : ${apres?.erreur ?? 'erreur inconnue'}`, 'acceptee');
    },
  );

  declarer(
    'reconnecter_telephone',
    {
      description:
        'Relance la liaison Bluetooth du téléphone passerelle (liaison figée, téléphone revenu à portée). Ne compose rien ; refusé pendant un appel. Appairer ou oublier un téléphone se fait dans l’interface, téléphone en main.',
      entree: z.strictObject({}),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async () => {
      const r = await reconnecterTelephone();
      return r.ok ? reussite({ reconnexion: 'demandée', suivi: 'etat_ligne dit si le téléphone est de nouveau connecté.' }) : refus(r.raison);
    },
  );
}
