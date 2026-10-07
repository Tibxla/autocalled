import { afterEach, describe, expect, it, vi } from 'vitest';
import { lireCatalogueAssistante, genererApercuVoix, TEXTE_APERCU } from './catalogue-assistante';

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('choix des voix et modèles', () => {
  it('liste les choix actuels du fournisseur et garde les autres catalogues quand l’un échoue', async () => {
    const fournisseur = vi.fn(async (url: string | URL | Request) => {
      const chemin = String(url);
      if (chemin.includes('/v2/voices')) return Response.json({ voices: [{ voice_id: 'VoixFictive001', name: 'Voix fictive', labels: { language: 'fr' }, sharing: { whitelisted_emails: ['secret@example.com'] } }], has_more: false });
      if (chemin.endsWith('/v1/models')) return Response.json([{ model_id: 'eleven_flash_v2_5', name: 'Modèle fictif', can_do_text_to_speech: true }, { model_id: 'autre_fictif', name: 'Conversion', can_do_text_to_speech: false }]);
      return new Response('détail privé', { status: 503 });
    });
    const catalogue = await lireCatalogueAssistante({ cle: 'cle-fictive', fetch: fournisseur });
    expect(catalogue.voix).toEqual([{ id: 'VoixFictive001', nom: 'Voix fictive · fr' }]);
    expect(catalogue.modelesVoix).toEqual([{ id: 'eleven_flash_v2_5', nom: 'Modèle fictif' }]);
    expect(catalogue.modelesLangage).toEqual([]);
    expect(catalogue.indisponibles).toEqual(['Modèles de langage']);
    expect(JSON.stringify(catalogue)).not.toContain('secret');
    expect(JSON.stringify(catalogue)).not.toContain('détail privé');
  });
});

describe('aperçu de la voix', () => {
  it('synthétise seulement le texte fictif fixe avec les réglages choisis, sans donnée de prospect', async () => {
    const fournisseur = vi.fn(async () => new Response(new Uint8Array([73, 68, 51]), { headers: { 'content-type': 'audio/mpeg' } }));
    const audio = await genererApercuVoix({ voiceId: 'VoixFictive001', modele: 'eleven_fictif', stabilite: 0.35, similarite: 0.75, vitesse: 1.1 }, { cle: 'cle-fictive', fetch: fournisseur });
    expect(new Uint8Array(audio)).toEqual(new Uint8Array([73, 68, 51]));
    const [url, options] = fournisseur.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain('output_format=mp3_44100_128');
    expect(JSON.parse(String(options.body))).toEqual({ text: TEXTE_APERCU, model_id: 'eleven_fictif', voice_settings: { stability: 0.35, similarity_boost: 0.75, speed: 1.1 } });
  });
});


describe('catalogue paginé et absence de fournisseur', () => {
  it('inclut les voix des pages suivantes et les modèles de langage officiels', async () => {
    const fournisseur = vi.fn(async (url: string | URL | Request) => {
      const chemin = String(url);
      if (chemin.includes('/v2/voices')) return Response.json(chemin.includes('next_page_token=page%2F2')
        ? { voices: [{ voice_id: 'VoixFictive002', name: 'Seconde voix' }], has_more: false }
        : { voices: [{ voice_id: 'VoixFictive001', name: 'Première voix' }], has_more: true, next_page_token: 'page/2' });
      if (chemin.endsWith('/v1/models')) return Response.json([]);
      return Response.json({ llms: [{ llm: 'modele-fictif', supports_parallel_tool_calls: true }] });
    });
    const r = await lireCatalogueAssistante({ cle: 'cle-fictive', fetch: fournisseur });
    expect(r.voix.map((v) => v.id)).toEqual(['VoixFictive001', 'VoixFictive002']);
    expect(r.modelesLangage).toEqual([{ id: 'modele-fictif', nom: 'modele-fictif' }]);
    expect(r.indisponibles).toEqual([]);
  });
  it('reste modifiable en saisie libre sans clé et ne tente aucune requête', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    const fournisseur = vi.fn();
    expect(await lireCatalogueAssistante({ fetch: fournisseur })).toEqual({ voix: [], modelesVoix: [], modelesLangage: [], indisponibles: ['Voix', 'Modèles de voix', 'Modèles de langage'] });
    expect(fournisseur).not.toHaveBeenCalled();
  });
  it('refuse des paramètres hors bornes avant de solliciter le fournisseur', async () => {
    const fournisseur = vi.fn();
    await expect(genererApercuVoix({ voiceId: 'VoixFictive001', modele: 'eleven_fictif', stabilite: -1, similarite: 0.75, vitesse: 1 }, { cle: 'cle-fictive', fetch: fournisseur })).rejects.toThrow();
    expect(fournisseur).not.toHaveBeenCalled();
  });
});

describe('modèles utilisables par une assistante', () => {
  it('garde les modèles Agents et les LLM admissibles même si un choix fournisseur est inéligible', async () => {
    const fournisseur = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/v2/voices')) return Response.json({ voices: [], has_more: false });
      if (String(url).endsWith('/v1/models')) return Response.json([
        { model_id: 'eleven_v4_turbo', name: 'Eleven v4 Turbo', can_do_text_to_speech: true },
        { model_id: 'eleven_v3_conversational', name: 'Eleven v3 Conversational', can_do_text_to_speech: true },
        { model_id: 'eleven_v4', name: 'Eleven v4 narration', can_do_text_to_speech: true },
        { model_id: 'eleven_v3', name: 'Eleven v3 narration', can_do_text_to_speech: true },
      ]);
      return Response.json({ llms: [{ llm: 'modele-fictif' }, { llm: 'identifiant/non-gere' }] });
    });
    const r = await lireCatalogueAssistante({ cle: 'cle-fictive', fetch: fournisseur });
    expect(r.modelesVoix.map((m) => m.id)).toEqual(['eleven_v3_conversational', 'eleven_v4_turbo']);
    expect(r.modelesLangage).toEqual([{ id: 'modele-fictif', nom: 'modele-fictif' }]);
    expect(r.indisponibles).toEqual([]);
  });
});

class SocketFictif extends EventTarget {
  envoyes: unknown[] = [];
  fermee = false;
  send(texte: string) { this.envoyes.push(JSON.parse(texte)); }
  close() { this.fermee = true; }
  ouvrir() { this.dispatchEvent(new Event('open')); }
  recevoir(donnees: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(donnees) })); }
}

describe('aperçu des modèles de conversation', () => {
  it('synthétise v4 Turbo par le protocole dialogue et rassemble tout le MP3 jusqu’à la fin', async () => {
    const socket = new SocketFictif();
    const ouvrirSocket = vi.fn(() => socket as unknown as WebSocket);
    const fournisseur = vi.fn();
    const audio = genererApercuVoix({ voiceId: 'VoixFictive001', modele: 'eleven_v4_turbo', stabilite: 0.35, similarite: 0.75, vitesse: 1 }, { cle: 'cle-fictive', fetch: fournisseur, websocket: ouvrirSocket });
    socket.ouvrir();
    expect(ouvrirSocket).toHaveBeenCalledWith('wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v4_turbo&output_format=mp3_44100_128');
    expect(socket.envoyes).toEqual([
      { voices: ['VoixFictive001'], xi_api_key: 'cle-fictive', voice_settings: { stability: 0.35, similarity_boost: 0.75, speed: 1 } },
      { inputs: [{ text: TEXTE_APERCU, voice_id: 'VoixFictive001' }] },
      { close_socket: true },
    ]);
    socket.recevoir({ audio: Buffer.from([73, 68]).toString('base64') });
    socket.recevoir({ is_final_audio_for_turn: true });
    socket.recevoir({ audio: Buffer.from([51]).toString('base64') });
    socket.recevoir({ is_final: true });
    expect(new Uint8Array(await audio)).toEqual(new Uint8Array([73, 68, 51]));
    expect(socket.fermee).toBe(true);
    expect(fournisseur).not.toHaveBeenCalled();
  });
});


describe('interruption d’un aperçu dialogue', () => {
  it('refuse une erreur fournisseur v3 sans révéler son contenu', async () => {
    const socket = new SocketFictif();
    const resultat = genererApercuVoix({ voiceId: 'VoixFictive001', modele: 'eleven_v3_conversational', stabilite: 0.35, similarite: 0.75, vitesse: 1 }, { cle: 'cle-fictive', websocket: () => socket as unknown as WebSocket });
    socket.ouvrir();
    socket.recevoir({ error: 'clé ou diagnostic privé' });
    await expect(resultat).rejects.toThrow('Aperçu indisponible.');
    expect(socket.fermee).toBe(true);
  });
  it('ferme un fournisseur muet et ne transmet rien si l’ouverture arrive après le délai', async () => {
    vi.useFakeTimers();
    const socket = new SocketFictif();
    const resultat = genererApercuVoix({ voiceId: 'VoixFictive001', modele: 'eleven_v4_turbo', stabilite: 0.35, similarite: 0.75, vitesse: 1 }, { cle: 'cle-fictive', websocket: () => socket as unknown as WebSocket });
    const refus = expect(resultat).rejects.toThrow('Aperçu indisponible.');
    await vi.advanceTimersByTimeAsync(20_000);
    await refus;
    socket.ouvrir();
    expect(socket.envoyes).toEqual([]);
    expect(socket.fermee).toBe(true);
  });
  it('refuse un MP3 tronqué quand le fournisseur ferme avant le signal de fin', async () => {
    const socket = new SocketFictif();
    const resultat = genererApercuVoix({ voiceId: 'VoixFictive001', modele: 'eleven_v4_turbo', stabilite: 0.35, similarite: 0.75, vitesse: 1 }, { cle: 'cle-fictive', websocket: () => socket as unknown as WebSocket });
    socket.ouvrir();
    socket.recevoir({ audio: Buffer.from([73, 68]).toString('base64') });
    socket.dispatchEvent(new Event('close'));
    await expect(resultat).rejects.toThrow('Aperçu indisponible.');
  });
});
