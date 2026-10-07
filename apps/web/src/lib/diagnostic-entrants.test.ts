import { describe, expect, it } from 'vitest';
import { expliquerDernierEntrant, expliquerLigneEntrante } from './diagnostic-entrants';

describe('diagnostic des appels entrants', () => {
  it('explique le blocage D-Bus sans recopier le journal ni une donnée personnelle', () => {
    const diagnostic = expliquerDernierEntrant(
      { statut: 'termine', conversationId: null },
      "20:03:39 + 15.25s décroché impossible : la boucle D-Bus ne répond pas\nprospect fictif +33639980001",
    );
    expect(diagnostic).toMatchObject({ alerte: true, texte: expect.stringContaining('téléphone n’a pas répondu') });
    expect(JSON.stringify(diagnostic)).not.toContain('+33639980001');
    expect(JSON.stringify(diagnostic)).not.toContain('prospect fictif');
  });

  it('signale un canal son absent et ne confond pas une conversation ouverte avec un son entendu', () => {
    expect(expliquerDernierEntrant({ statut: 'echec', conversationId: null }, "20:03:39 + 15.25s bilan : {'raison': 'canal son absent'}")).toMatchObject({ alerte: true, texte: expect.stringContaining('canal son') });
    expect(expliquerDernierEntrant({ statut: 'termine', conversationId: 'conv-fictive' }, '')).toMatchObject({ alerte: false, texte: expect.stringContaining('ne confirme pas') });
    expect(expliquerDernierEntrant({ statut: 'termine', conversationId: null }, '')).toMatchObject({ alerte: true, texte: expect.stringContaining('ne permet pas de préciser') });
  });

  it('une autre erreur du journal ne devient pas la cause du décroché', () => {
    expect(expliquerDernierEntrant({ statut: 'termine', conversationId: null }, '20:03:39 + 15.25s lecture des volumes : erreur D-Bus')).toMatchObject({ texte: expect.stringContaining('ne permet pas de préciser') });
  });

  it('distingue une panne de pont, un téléphone déconnecté et une ligne occupée', () => {
    expect(expliquerLigneEntrante({ ok: false, raison: 'erreur brute privée' })).toEqual({ alerte: true, texte: 'Le pont ne répond pas : l’assistante ne peut pas décrocher.' });
    expect(expliquerLigneEntrante({ ok: true, corps: {} }).texte).toContain('illisible');
    expect(expliquerLigneEntrante({ ok: true, corps: { connecte: false } })).toMatchObject({ alerte: true });
    expect(expliquerLigneEntrante({ ok: true, corps: { connecte: true, appelEnCours: true } }).texte).toContain('occupée');
    expect(expliquerLigneEntrante({ ok: true, corps: { connecte: true } }).texte).toContain('disponible');
  });
});
