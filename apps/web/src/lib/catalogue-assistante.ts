import 'server-only';
import { z } from 'zod';
import { BORNES } from './reglages-assistante';

export interface ChoixAssistante { id: string; nom: string }
export interface CatalogueAssistante {
  voix: ChoixAssistante[];
  modelesVoix: ChoixAssistante[];
  modelesLangage: ChoixAssistante[];
  indisponibles: string[];
}
interface Fournisseur { cle?: string; fetch?: typeof fetch; websocket?: (url: string) => WebSocket }
const API = 'https://api.elevenlabs.io';

async function demander(chemin: string, fournisseur: Fournisseur, init: RequestInit = {}) {
  const cle = fournisseur.cle ?? process.env.ELEVENLABS_API_KEY;
  if (!cle) throw new Error('ElevenLabs indisponible.');
  const r = await (fournisseur.fetch ?? fetch)(`${API}${chemin}`, {
    ...init,
    headers: { 'xi-api-key': cle, 'content-type': 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error('ElevenLabs indisponible.');
  return r;
}

const nom = z.string().min(1).max(200);
const voixSchema = z.object({ voices: z.array(z.object({ voice_id: BORNES.voiceId, name: nom, labels: z.record(z.string(), z.string()).optional() })), has_more: z.boolean(), next_page_token: z.string().nullable().optional() });
const modelesSchema = z.array(z.object({ model_id: z.string(), name: nom, can_do_text_to_speech: z.boolean() }));
const llmsSchema = z.object({ llms: z.array(z.unknown()) });
const llmSchema = z.object({ llm: BORNES.llm, name: z.string().nullish() });
// Modèles Agents documentés : https://elevenlabs.io/docs/overview/models (octobre 2026).
const MODELES_APPEL = new Set(['eleven_v4_turbo', 'eleven_v3_conversational', 'eleven_flash_v2_5', 'eleven_flash_v2', 'eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_turbo_v2']);
const trier = (choix: ChoixAssistante[]) => [...new Map(choix.map((c) => [c.id, c])).values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

/** Catalogues officiels, filtrés selon le compte ; seuls identifiants et libellés arrivent au navigateur. */
export async function lireCatalogueAssistante(fournisseur: Fournisseur = {}): Promise<CatalogueAssistante> {
  const resultats = await Promise.allSettled([
    (async () => {
      const choix: ChoixAssistante[] = [];
      let page: string | undefined;
      for (let n = 0; n < 20; n++) {
        const d = voixSchema.parse(await (await demander(`/v2/voices?page_size=100${page ? `&next_page_token=${encodeURIComponent(page)}` : ''}`, fournisseur)).json());
        choix.push(...d.voices.map((v) => ({ id: v.voice_id, nom: `${v.name}${v.labels?.language ? ` · ${v.labels.language}` : ''}` })));
        if (!d.has_more) return trier(choix);
        if (!d.next_page_token || d.next_page_token === page) throw new Error('Catalogue incomplet.');
        page = d.next_page_token;
      }
      throw new Error('Catalogue incomplet.');
    })(),
    (async () => trier(modelesSchema.parse(await (await demander('/v1/models', fournisseur)).json()).filter((m) => m.can_do_text_to_speech && MODELES_APPEL.has(m.model_id)).map((m) => ({ id: m.model_id, nom: m.name }))))(),
    (async () => trier(llmsSchema.parse(await (await demander('/v1/convai/llm/list', fournisseur)).json()).llms.flatMap((brut) => { const m = llmSchema.safeParse(brut); return m.success ? [{ id: m.data.llm, nom: m.data.name?.slice(0, 200) || m.data.llm }] : []; })))(),
  ]);
  const titres = ['Voix', 'Modèles de voix', 'Modèles de langage'];
  return {
    voix: resultats[0].status === 'fulfilled' ? resultats[0].value : [],
    modelesVoix: resultats[1].status === 'fulfilled' ? resultats[1].value : [],
    modelesLangage: resultats[2].status === 'fulfilled' ? resultats[2].value : [],
    indisponibles: resultats.flatMap((r, i) => r.status === 'rejected' ? [titres[i]!] : []),
  };
}

export const TEXTE_APERCU = 'Bonjour, merci de prendre un moment pour échanger. Je vous propose de faire le point tranquillement, puis de voir ensemble ce qui vous conviendrait le mieux. Qu’en pensez-vous ?';
export const apercuVoixSchema = z.strictObject({
  voiceId: BORNES.voiceId,
  modele: BORNES.modeleVoix.max(60),
  stabilite: BORNES.stabilite,
  similarite: BORNES.similarite,
  vitesse: BORNES.vitesse,
});

/** Synthèse neutre à la demande : aucune configuration, conversation ou donnée prospect n’est enregistrée. */
export async function genererApercuVoix(saisie: unknown, fournisseur: Fournisseur = {}): Promise<ArrayBuffer> {
  const e = apercuVoixSchema.parse(saisie);
  if (e.modele === 'eleven_v4_turbo' || e.modele === 'eleven_v3_conversational') return apercuDialogue(e, fournisseur);
  const r = await demander(`/v1/text-to-speech/${e.voiceId}?output_format=mp3_44100_128`, fournisseur, {
    method: 'POST',
    body: JSON.stringify({ text: TEXTE_APERCU, model_id: e.modele, voice_settings: { stability: e.stabilite, similarity_boost: e.similarite, speed: e.vitesse } }),
  });
  const audio = await r.arrayBuffer();
  if (!audio.byteLength || audio.byteLength > 5_000_000) throw new Error('Aperçu indisponible.');
  return audio;
}


/** Les modèles de conversation v3/v4 utilisent le protocole dialogue, distinct du POST TTS. */
function apercuDialogue(e: z.infer<typeof apercuVoixSchema>, fournisseur: Fournisseur): Promise<ArrayBuffer> {
  const cle = fournisseur.cle ?? process.env.ELEVENLABS_API_KEY;
  if (!cle) return Promise.reject(new Error('ElevenLabs indisponible.'));
  return new Promise((resolve, reject) => {
    const socket = (fournisseur.websocket ?? ((url) => new WebSocket(url)))(`wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=${encodeURIComponent(e.modele)}&output_format=mp3_44100_128`);
    const morceaux: Buffer[] = [];
    let taille = 0;
    let termine = false;
    const delai = setTimeout(() => finir(false), 20_000);
    function finir(succes: boolean) {
      if (termine) return;
      termine = true;
      clearTimeout(delai);
      try { socket.close(); } catch { /* Le socket peut déjà être fermé. */ }
      if (succes && taille) resolve(Uint8Array.from(Buffer.concat(morceaux)).buffer);
      else reject(new Error('Aperçu indisponible.'));
    }
    socket.addEventListener('open', () => {
      if (termine) return;
      try {
        socket.send(JSON.stringify({ voices: [e.voiceId], xi_api_key: cle, voice_settings: { stability: e.stabilite, similarity_boost: e.similarite, speed: e.vitesse } }));
        socket.send(JSON.stringify({ inputs: [{ text: TEXTE_APERCU, voice_id: e.voiceId }] }));
        socket.send(JSON.stringify({ close_socket: true }));
      } catch { finir(false); }
    });
    socket.addEventListener('message', (evenement) => {
      if (termine) return;
      try {
        if (typeof evenement.data !== 'string' || evenement.data.length > 7_000_000) return finir(false);
        const message = JSON.parse(evenement.data) as { audio?: unknown; is_final?: unknown; error?: unknown };
        if (message.error) return finir(false);
        if (message.audio !== undefined && message.audio !== null) {
          if (typeof message.audio !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.audio)) return finir(false);
          const morceau = Buffer.from(message.audio, 'base64');
          taille += morceau.byteLength;
          if (taille > 5_000_000) return finir(false);
          morceaux.push(morceau);
        }
        if (message.is_final === true) finir(true);
      } catch { finir(false); }
    });
    socket.addEventListener('close', () => finir(false));
    socket.addEventListener('error', () => finir(false));
  });
}
