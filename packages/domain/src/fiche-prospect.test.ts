import { describe, expect, it } from 'vitest';
import { type FicheProspect, fusionnerFiches, lireFiche, lireFiches } from './fiche-prospect.js';

const julie = `---
nom: Julie Martin
societe: Gîte des Aravis
role: Gérante
telephone: "+33 6 39 98 00 01"
---

Gîte de 4 chambres à Annecy, ouvert depuis 2019.
Site sous Wix, pas de réservation en ligne.
`;

describe('lireFiche', () => {
  it("lit l'en-tête et le contexte, et tire l'identité du nom de fichier", () => {
    const resultat = lireFiche('julie-martin.md', julie);

    expect(resultat).toEqual({
      ok: true,
      fiche: {
        id: 'julie-martin',
        nom: 'Julie Martin',
        societe: 'Gîte des Aravis',
        role: 'Gérante',
        telephone: '+33639980001',
        contexte: 'Gîte de 4 chambres à Annecy, ouvert depuis 2019.\nSite sous Wix, pas de réservation en ligne.',
      },
    });
  });

  it('garde le zéro initial d’un numéro écrit sans guillemets', () => {
    const resultat = lireFiche('julie-martin.md', '---\nnom: Julie\ntelephone: 0639980001\n---\nContexte.');

    expect(resultat.ok && resultat.fiche.telephone).toBe('+33639980001');
  });

  it('accepte une fiche sans société ni rôle', () => {
    const resultat = lireFiche('marc.md', '---\nnom: Marc\ntelephone: "0639980002"\n---\nLoue des vans.');

    expect(resultat.ok).toBe(true);
    if (resultat.ok) {
      expect(resultat.fiche.societe).toBeNull();
      expect(resultat.fiche.role).toBeNull();
    }
  });

  it.each(['Julie Martin.md', 'julie_martin.md', 'jülie.md', 'julie-martin.txt', '-julie.md'])(
    'refuse le nom de fichier %j',
    (nomFichier) => {
      const resultat = lireFiche(nomFichier, julie);

      expect(resultat.ok).toBe(false);
      if (!resultat.ok) expect(resultat.erreurs[0]).toMatch(/nom de fichier/);
    },
  );

  it('refuse un fichier sans en-tête', () => {
    const resultat = lireFiche('julie.md', 'Juste du texte.');

    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.erreurs[0]).toMatch(/en-tête/);
  });

  it('refuse un en-tête YAML invalide', () => {
    const resultat = lireFiche('julie.md', '---\nnom: [Julie\n---\nContexte.');

    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.erreurs[0]).toMatch(/YAML/);
  });

  it('signale un nom manquant et un numéro invalide ensemble', () => {
    const resultat = lireFiche('julie.md', '---\ntelephone: "12"\n---\nContexte.');

    expect(resultat.ok).toBe(false);
    if (!resultat.ok) {
      expect(resultat.erreurs).toHaveLength(2);
      expect(resultat.erreurs.join(' ')).toMatch(/nom/);
      expect(resultat.erreurs.join(' ')).toMatch(/telephone/);
    }
  });

  it('refuse un champ inconnu, pour attraper les fautes de frappe', () => {
    const resultat = lireFiche('julie.md', '---\nnom: Julie\ntéléphone: "0639980001"\n---\nContexte.');

    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.erreurs.join(' ')).toMatch(/téléphone/);
  });

  it('refuse un contexte de plus de 500 mots', () => {
    const long = Array.from({ length: 501 }, () => 'mot').join(' ');

    const resultat = lireFiche('julie.md', `---\nnom: Julie\ntelephone: "0639980001"\n---\n${long}`);

    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.erreurs[0]).toMatch(/500 mots/);
  });
});

describe('lireFiches', () => {
  it('garde les fiches valides quand une autre est refusée', () => {
    const resultat = lireFiches([
      { nomFichier: 'julie-martin.md', contenu: julie },
      { nomFichier: 'cassee.md', contenu: 'pas d’en-tête' },
    ]);

    expect(resultat.fiches.map((f) => f.id)).toEqual(['julie-martin']);
    expect(resultat.refus).toHaveLength(1);
    expect(resultat.refus[0]?.nomFichier).toBe('cassee.md');
  });

  it('refuse les deux fichiers quand un même nom apparaît deux fois', () => {
    const resultat = lireFiches([
      { nomFichier: 'julie-martin.md', contenu: julie },
      { nomFichier: 'julie-martin.md', contenu: julie },
    ]);

    expect(resultat.fiches).toEqual([]);
    expect(resultat.refus).toHaveLength(2);
  });
});

describe('fusionnerFiches', () => {
  const ficheJulie: FicheProspect = {
    id: 'julie-martin',
    nom: 'Julie Martin',
    societe: 'Gîte des Aravis',
    role: 'Gérante',
    telephone: '+33639980001' as FicheProspect['telephone'],
    contexte: 'Ancien contexte.',
  };

  it('crée un nouveau prospect qui partage le numéro d’un autre sans l’écraser', () => {
    const marc: FicheProspect = { ...ficheJulie, id: 'marc-dubois', nom: 'Marc Dubois', contexte: 'Vans.' };

    const resultat = fusionnerFiches([ficheJulie], [marc]);

    expect(resultat.crees.map((f) => f.id)).toEqual(['marc-dubois']);
    expect(resultat.misAJour).toEqual([]);
  });

  it('met à jour un prospect réimporté sous le même nom de fichier', () => {
    const nouvelleJulie = { ...ficheJulie, contexte: 'Nouveau contexte.' };

    const resultat = fusionnerFiches([ficheJulie], [nouvelleJulie]);

    expect(resultat.crees).toEqual([]);
    expect(resultat.misAJour).toEqual([nouvelleJulie]);
  });

  it('ne compte pas comme mise à jour une fiche identique', () => {
    const resultat = fusionnerFiches([ficheJulie], [{ ...ficheJulie }]);

    expect(resultat).toEqual({ crees: [], misAJour: [], inchanges: ['julie-martin'] });
  });
});
