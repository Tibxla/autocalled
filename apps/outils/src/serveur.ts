/**
 * Serveur des outils d'agenda appelés par ElevenLabs pendant un appel (ADR 0002). Il tourne sur son
 * propre port, seul exposé à Internet par Tailscale Funnel ; l'interface de l'opérateur reste sur le
 * tailnet (ADR 0006). Chaque requête doit porter le secret partagé.
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { creerEvenement, creneauParle, dechiffrer, jetonAcces, listerCalendriers, occupations } from '@autocalled/agenda';
import { type PlageHoraire, type ReglesRendezVous, estReservable, proposerCreneaux } from '@autocalled/domain';
import postgres from 'postgres';

const exiger = (nom: string) => {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`variable d'environnement manquante : ${nom}`);
  return valeur;
};

const sql = postgres(exiger('DATABASE_URL'), { max: 3 });
const SECRET = Buffer.from(exiger('OUTILS_WEBHOOK_SECRET'));
const PORT = Number(process.env.PORT_OUTILS ?? 3021);

function autorise(requete: IncomingMessage): boolean {
  const recu = Buffer.from((requete.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  return recu.length === SECRET.length && timingSafeEqual(recu, SECRET);
}

async function corps(requete: IncomingMessage): Promise<Record<string, unknown>> {
  let texte = '';
  for await (const morceau of requete) {
    texte += morceau;
    if (texte.length > 16_384) throw new Error('corps trop long');
  }
  const brut = JSON.parse(texte || '{}') as Record<string, unknown>;
  // ElevenLabs envoie les paramètres à plat ; certaines versions les emballent dans `parameters`.
  return { ...brut, ...((brut.parameters as Record<string, unknown> | undefined) ?? {}) };
}

interface Contexte {
  appelId: string;
  prospect: { nom: string; societe: string | null; role: string | null; telephone: string; contexte: string };
  entreprise: string;
  regles: ReglesRendezVous;
}

async function contexte(conversationId: unknown): Promise<Contexte | null> {
  if (typeof conversationId !== 'string' || !conversationId) return null;
  const [ligne] = await sql`
    select a.id as appel_id, p.nom, p.societe, p.role, p.telephone, p.contexte, e.nom as entreprise,
           e.duree_rendez_vous_minutes, e.plages_rendez_vous, e.delai_minimum_heures, e.horizon_jours, e.fuseau
    from appels a
    join prospects p on p.entreprise_id = a.entreprise_id and p.id = a.prospect_id
    join entreprises e on e.id = a.entreprise_id
    where a.conversation_id = ${conversationId}`;
  if (!ligne) return null;
  return {
    appelId: ligne.appel_id,
    prospect: { nom: ligne.nom, societe: ligne.societe, role: ligne.role, telephone: ligne.telephone, contexte: ligne.contexte },
    entreprise: ligne.entreprise,
    regles: {
      dureeMinutes: ligne.duree_rendez_vous_minutes,
      plages: ligne.plages_rendez_vous as PlageHoraire[],
      delaiMinimumHeures: ligne.delai_minimum_heures,
      horizonJours: ligne.horizon_jours,
      fuseau: ligne.fuseau,
    },
  };
}

async function agenda() {
  const [ligne] = await sql`select jeton_chiffre, calendrier_id from connexion_google limit 1`;
  if (!ligne || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
  const acces = await jetonAcces(
    { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
    dechiffrer(ligne.jeton_chiffre, exiger('CLE_CHIFFREMENT')),
  );
  return { acces, calendrierId: ligne.calendrier_id as string };
}

async function occupe(acces: string, regles: ReglesRendezVous, maintenant: Date) {
  const calendriers = (await listerCalendriers(acces)).map((c) => c.id);
  const fin = new Date(maintenant.getTime() + (regles.horizonJours + 1) * 86_400_000);
  return occupations(acces, calendriers, maintenant, fin);
}

const SANS_AGENDA =
  "L'agenda n'est pas connecté. Demande au prospect le jour et le moment qui l'arrangent, et dis-lui qu'on lui confirme le créneau.";

async function proposer(parametres: Record<string, unknown>) {
  const c = await contexte(parametres.conversation_id);
  if (!c) return "Appel inconnu : propose au prospect qu'on le recontacte pour fixer un moment.";
  const a = await agenda();
  if (!a) return SANS_AGENDA;
  const maintenant = new Date();
  const creneaux = proposerCreneaux(c.regles, await occupe(a.acces, c.regles, maintenant), maintenant);
  if (creneaux.length === 0) return "Aucun créneau libre dans les prochains jours : propose qu'on le rappelle pour convenir d'un moment.";
  return {
    consigne: 'Propose ces créneaux à l’oral, un ou deux à la fois. Pour réserver, passe la valeur debut exacte à reserver_creneau.',
    creneaux: creneaux.map((x) => ({ debut: x.debut.toISOString(), libelle: creneauParle(x.debut, c.regles.fuseau) })),
  };
}

async function reserver(parametres: Record<string, unknown>) {
  const c = await contexte(parametres.conversation_id);
  if (!c) return { reserve: false, raison: 'Appel inconnu.' };
  const [deja] = await sql`select debut from rendez_vous where appel_id = ${c.appelId}`;
  if (deja) return { reserve: true, libelle: creneauParle(deja.debut, c.regles.fuseau), note: 'Déjà réservé pendant cet appel.' };

  const a = await agenda();
  if (!a) return { reserve: false, raison: SANS_AGENDA };
  const debut = new Date(String(parametres.debut ?? ''));
  if (Number.isNaN(debut.getTime())) return { reserve: false, raison: 'Créneau illisible : utilise la valeur debut renvoyée par proposer_creneaux.' };
  const fin = new Date(debut.getTime() + c.regles.dureeMinutes * 60_000);
  const maintenant = new Date();
  const occupations = await occupe(a.acces, c.regles, maintenant);
  if (!estReservable({ debut, fin }, c.regles, occupations, maintenant)) {
    const alternatives = proposerCreneaux(c.regles, occupations, maintenant).map((x) => ({ debut: x.debut.toISOString(), libelle: creneauParle(x.debut, c.regles.fuseau) }));
    return { reserve: false, raison: "Ce créneau vient d'être pris ou n'est pas autorisé.", alternatives };
  }

  const p = c.prospect;
  const evenementId = await creerEvenement(a.acces, a.calendrierId, {
    debut,
    fin,
    titre: `Premier échange · ${p.nom}${p.societe ? ` (${p.societe})` : ''} · ${c.entreprise}`,
    description: [
      `${p.nom}${p.role ? `, ${p.role}` : ''}${p.societe ? ` chez ${p.societe}` : ''}`,
      `Téléphone : ${p.telephone}`,
      '',
      p.contexte,
      '',
      `Appel : ${process.env.ORIGINE_APP ?? ''}/appels/${c.appelId}`,
    ].join('\n'),
  });
  await sql`insert into rendez_vous (appel_id, debut, fin, evenement_id) values (${c.appelId}, ${debut}, ${fin}, ${evenementId})`;
  return { reserve: true, libelle: creneauParle(debut, c.regles.fuseau) };
}

const ROUTES: Record<string, (p: Record<string, unknown>) => Promise<unknown>> = {
  '/outils/proposer-creneaux': proposer,
  '/outils/reserver-creneau': reserver,
};

createServer(async (requete, reponse) => {
  const envoyer = (statut: number, donnees: unknown) => {
    reponse.writeHead(statut, { 'content-type': 'application/json; charset=utf-8' });
    reponse.end(JSON.stringify(donnees));
  };
  const route = ROUTES[requete.url ?? ''];
  if (requete.method !== 'POST' || !route) return envoyer(404, { erreur: 'introuvable' });
  if (!autorise(requete)) return envoyer(401, { erreur: 'non autorisé' });
  try {
    envoyer(200, { result: await route(await corps(requete)) });
  } catch (erreur) {
    console.error(requete.url, (erreur as Error).message);
    envoyer(200, { result: "Problème technique avec l'agenda : demande au prospect le moment qui l'arrange et dis-lui qu'on lui confirme." });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`outils d'agenda sur 127.0.0.1:${PORT}`));
