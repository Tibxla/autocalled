import { describe, expect, it } from 'vitest';
import { echecDuTelephone, reconnexionAccueil, reconnexionAppel, reconnexionFiche, reconnexionRegie, reconnexionTelephone } from './reconnexion';

const libre = { joignable: true as const, connecte: true, appelEnCours: false, appelId: null };

describe('echecDuTelephone', () => {
  it('reconnaît les échecs dus au téléphone', () => {
    expect(echecDuTelephone('Le téléphone passerelle n’a pas composé, même après reconnexion : vérifie qu’il est allumé et à portée (page Téléphone).')).toBe(true);
    expect(echecDuTelephone('Le téléphone passerelle n’a pas ouvert le canal son, même après reconnexion.')).toBe(true);
    expect(echecDuTelephone('Composition impossible : aucun téléphone passerelle en ligne : est-il connecté en Bluetooth ?')).toBe(true);
    expect(echecDuTelephone('Suspendue après un échec : Composition impossible : la boucle D-Bus ne répond pas')).toBe(true);
  });

  it('ignore ce que la reconnexion ne règle pas', () => {
    expect(echecDuTelephone('Le pont Bluetooth ne répond pas : le service autocalled-pont tourne-t-il ?')).toBe(false);
    expect(echecDuTelephone('Plafond de 15 appels par heure atteint. Prochain appel possible dans 12 min.')).toBe(false);
    expect(echecDuTelephone('Un appel est déjà en ligne sur le téléphone.')).toBe(false);
    expect(echecDuTelephone('Numéro invalide.')).toBe(false);
    expect(echecDuTelephone(null)).toBe(false);
    expect(echecDuTelephone('')).toBe(false);
  });
});

describe('reconnexionTelephone (page Téléphone)', () => {
  it('téléphone appairé sans appel : connecté comme déconnecté', () => {
    expect(reconnexionTelephone({ adresse: '12:34:56:78:9A:BC', appelEnCours: false })).toBe(true);
  });

  it('ni sans téléphone appairé, ni pendant un appel, ni sans relevé', () => {
    expect(reconnexionTelephone({ appelEnCours: false })).toBe(false);
    expect(reconnexionTelephone({ adresse: '12:34:56:78:9A:BC', appelEnCours: true })).toBe(false);
    expect(reconnexionTelephone(null)).toBe(false);
  });
});

describe('reconnexionAccueil (bande « Ligne libre »)', () => {
  it('discrète sur une ligne libre dite connectée (liaison figée)', () => {
    expect(reconnexionAccueil(libre)).toBe('discret');
  });

  it('normale téléphone déconnecté ou après un échec du téléphone', () => {
    expect(reconnexionAccueil({ ...libre, connecte: false })).toBe('normal');
    expect(reconnexionAccueil(libre, 'Le téléphone passerelle n’a pas composé, même après reconnexion.')).toBe('normal');
    expect(reconnexionAccueil(libre, 'Numéro invalide.')).toBe('discret');
  });

  it('jamais ligne injoignable ni pendant un appel', () => {
    expect(reconnexionAccueil({ joignable: false })).toBeNull();
    expect(reconnexionAccueil({ ...libre, appelEnCours: true })).toBeNull();
    expect(reconnexionAccueil({ ...libre, appelId: '00000000-0000-4000-8000-000000000000' })).toBeNull();
  });
});

describe('reconnexionRegie', () => {
  it('téléphone déconnecté, ou suspendue après un échec du téléphone', () => {
    expect(reconnexionRegie({ etat: 'deconnecte' }, null)).toBe(true);
    expect(reconnexionRegie({ etat: 'joignable' }, 'Suspendue après un échec : Le téléphone passerelle n’a pas composé.')).toBe(true);
    expect(reconnexionRegie({ etat: 'inconnu' }, 'Suspendue après un échec : Composition impossible : x')).toBe(true);
  });

  it('pas pour une ligne injoignable, un plafond ou un échec étranger au téléphone', () => {
    expect(reconnexionRegie({ etat: 'injoignable' }, 'Suspendue après un échec : Composition impossible : x')).toBe(false);
    expect(reconnexionRegie({ etat: 'joignable' }, 'Plafond de 15 appels par heure atteint.')).toBe(false);
    expect(reconnexionRegie({ etat: 'joignable' }, null)).toBe(false);
    expect(reconnexionRegie(null, null)).toBe(false);
  });
});

describe('reconnexionFiche', () => {
  it('ligne bloquée pour téléphone déconnecté, ou appel refusé faute de téléphone', () => {
    expect(reconnexionFiche('déconnecté', null)).toBe(true);
    expect(reconnexionFiche(null, 'Composition impossible : aucun téléphone passerelle en ligne')).toBe(true);
  });

  it('pas pour une ligne injoignable, occupée ou plafonnée', () => {
    expect(reconnexionFiche('injoignable', null)).toBe(false);
    expect(reconnexionFiche('en appel', null)).toBe(false);
    expect(reconnexionFiche('plafond atteint', 'Plafond de 15 appels par heure atteint.')).toBe(false);
  });
});

describe('reconnexionAppel (fiche d’appel)', () => {
  const echec = { ligne: 'bluetooth', statut: 'echec', conversation: false, erreur: 'Le téléphone passerelle n’a pas composé, même après reconnexion.' };

  it('appel téléphone en échec faute de téléphone, ligne libre, déconnectée ou d’état inconnu', () => {
    expect(reconnexionAppel(echec, 'libre')).toBe(true);
    expect(reconnexionAppel(echec, 'deconnecte')).toBe(true);
    expect(reconnexionAppel(echec, 'inconnu')).toBe(true);
    expect(reconnexionAppel({ ...echec, erreur: 'Composition impossible : aucun téléphone passerelle en ligne : est-il connecté en Bluetooth ?' }, 'deconnecte')).toBe(true);
    expect(reconnexionAppel({ ...echec, erreur: 'Le téléphone passerelle n’a pas ouvert le canal son, même après reconnexion.' }, 'libre')).toBe(true);
  });

  it('jamais ligne injoignable, pendant un appel, ni avant le premier relevé', () => {
    expect(reconnexionAppel(echec, 'injoignable')).toBe(false);
    expect(reconnexionAppel(echec, 'en-appel')).toBe(false);
    expect(reconnexionAppel(echec, 'releve')).toBe(false);
  });

  it('ni pour un autre échec, une autre ligne, une analyse en échec ou un appel abouti', () => {
    expect(reconnexionAppel({ ...echec, erreur: 'Le pont Bluetooth ne répond pas : le service autocalled-pont tourne-t-il ?' }, 'libre')).toBe(false);
    expect(reconnexionAppel({ ...echec, erreur: 'Plafond d’appels atteint avant la recomposition : l’appel n’est pas reparti (chaque composition compte).' }, 'libre')).toBe(false);
    expect(reconnexionAppel({ ...echec, erreur: null }, 'libre')).toBe(false);
    expect(reconnexionAppel({ ...echec, ligne: 'navigateur' }, 'libre')).toBe(false);
    expect(reconnexionAppel({ ...echec, conversation: true }, 'libre')).toBe(false);
    expect(reconnexionAppel({ ...echec, statut: 'termine' }, 'libre')).toBe(false);
  });
});
