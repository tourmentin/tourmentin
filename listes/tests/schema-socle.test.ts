// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lot L2, livrable 4 : valide les douze fichiers existants contre le schéma.
// Un fichier qui échoue n'est PAS corrigé ici : le test échoue et le détail de
// l'écart doit être remonté à Pierre-Hervé, pas silencieusement contourné.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { empreinteSchema, estActive } from '../outils/schema.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const DOSSIER_SOCLE = join(ICI, '..', 'socle');

const FICHIERS = readdirSync(DOSSIER_SOCLE).filter((f) => f.endsWith('.json'));

const MARQUES_DESACTIVEES_ATTENDUES = ['chorus-pro', 'msa', 'timbres-fiscaux'];

describe('schéma des empreintes de marque (listes/socle/*.json)', () => {
  it('trouve les douze fichiers attendus', () => {
    expect(FICHIERS.length).toBe(12);
  });

  it.each(FICHIERS)('%s respecte le schéma', (fichier) => {
    const contenu = JSON.parse(readFileSync(join(DOSSIER_SOCLE, fichier), 'utf8'));
    const resultat = empreinteSchema.safeParse(contenu);
    expect(resultat.success, resultat.success ? '' : JSON.stringify(resultat.error.issues, null, 2)).toBe(true);
  });

  it('aucun terme fort n\'est partagé entre deux marques (5.3 : un terme fort doit être distinctif)', () => {
    const parTerme = new Map<string, string[]>();
    for (const fichier of FICHIERS) {
      const empreinte = empreinteSchema.parse(JSON.parse(readFileSync(join(DOSSIER_SOCLE, fichier), 'utf8')));
      for (const terme of empreinte.termes_forts) {
        const cle = terme.toLowerCase();
        parTerme.set(cle, [...(parTerme.get(cle) ?? []), empreinte.id]);
      }
    }
    const partages = [...parTerme.entries()].filter(([, marques]) => marques.length > 1);
    expect(partages, JSON.stringify(partages, null, 2)).toEqual([]);
  });

  it('exactement les 9 marques attendues sont actives, 3 désactivées (chapitre 3)', () => {
    const empreintes = FICHIERS.map((f) => empreinteSchema.parse(JSON.parse(readFileSync(join(DOSSIER_SOCLE, f), 'utf8'))));
    const actives = empreintes.filter(estActive).map((e) => e.id).sort();
    const desactivees = empreintes.filter((e) => !estActive(e)).map((e) => e.id).sort();
    expect(desactivees).toEqual([...MARQUES_DESACTIVEES_ATTENDUES].sort());
    expect(actives.length).toBe(9);
  });
});

describe('termes_forts et termes_saisie mutuellement exclusifs (12.3.3.11)', () => {
  const base = {
    id: 'test',
    libelle: 'Test',
    criticite: 1,
    actif: true,
    domaines: ['exemple.fr'],
    domaine_principal: 'exemple.fr',
    termes_forts: ['un terme fort de test'],
    termes_faibles: [],
    termes_saisie: ['mot de passe'],
    format_identifiant: 'test',
    racines_typo: [],
    couleurs: ['#000000'],
    franceconnect: false,
    espaces_multiples: [],
    a_verifier: true,
  };

  it('refuse un libellé présent à la fois dans termes_forts et termes_saisie', () => {
    const resultat = empreinteSchema.safeParse({ ...base, termes_forts: ['code personnel de test'], termes_saisie: ['code personnel de test'] });
    expect(resultat.success).toBe(false);
  });

  it('accepte deux listes disjointes', () => {
    expect(empreinteSchema.safeParse(base).success).toBe(true);
  });
});

describe('contrôle de forme des domaines (12.3.3.6 : ameli.fr/assure était un chemin, pas un hôte)', () => {
  const base = {
    id: 'test',
    libelle: 'Test',
    criticite: 1,
    actif: true,
    termes_forts: ['un terme fort de test'],
    termes_faibles: [],
    termes_saisie: ['mot de passe'],
    format_identifiant: 'test',
    racines_typo: [],
    couleurs: ['#000000'],
    franceconnect: false,
    espaces_multiples: [],
    a_verifier: true,
  };

  it.each(['exemple.fr/chemin', 'https://exemple.fr', 'http://exemple.fr/', 'exemple fr', 'exemple.fr '])(
    'refuse %s dans domaines',
    (domaine) => {
      expect(empreinteSchema.safeParse({ ...base, domaines: [domaine], domaine_principal: domaine }).success).toBe(false);
    },
  );

  it.each(['exemple.fr', 'sous.domaine.exemple.fr', 'exemple-avec-tiret.fr'])('accepte %s dans domaines', (domaine) => {
    expect(empreinteSchema.safeParse({ ...base, domaines: [domaine], domaine_principal: domaine }).success).toBe(true);
  });

  it('refuse aussi une forme invalide dans domaines_verifies', () => {
    expect(empreinteSchema.safeParse({ ...base, domaines: ['exemple.fr'], domaine_principal: 'exemple.fr', domaines_verifies: ['exemple.fr/mire'] }).success).toBe(false);
  });
});

describe('domaine_principal (14.12) : obligatoire et membre de domaines', () => {
  const base = {
    id: 'test',
    libelle: 'Test',
    criticite: 1,
    actif: true,
    domaines: ['exemple.fr', 'exemple.net'],
    domaine_principal: 'exemple.fr',
    termes_forts: ['un terme fort de test'],
    termes_faibles: [],
    termes_saisie: ['mot de passe'],
    format_identifiant: 'test',
    racines_typo: [],
    couleurs: ['#000000'],
    franceconnect: false,
    espaces_multiples: [],
    a_verifier: true,
  };

  it('positif : un domaine_principal membre de domaines est accepté', () => {
    expect(empreinteSchema.safeParse(base).success).toBe(true);
  });

  it('négatif : absent, la validation échoue (obligatoire, pas de repli)', () => {
    const { domaine_principal: _domainePrincipal, ...sansPrincipal } = base;
    expect(empreinteSchema.safeParse(sansPrincipal).success).toBe(false);
  });

  it('cas limite : présent mais absent de domaines, refusé', () => {
    expect(empreinteSchema.safeParse({ ...base, domaine_principal: 'ailleurs.fr' }).success).toBe(false);
  });
});

describe('estActive — seul `actif` fait foi', () => {
  const base = empreinteSchema.parse({
    id: 'test',
    libelle: 'Test',
    criticite: 1,
    actif: true,
    domaines: ['test.fr'],
    domaine_principal: 'test.fr',
    termes_forts: ['un terme fort de test'],
    termes_faibles: [],
    termes_saisie: ['mot de passe'],
    format_identifiant: 'test',
    racines_typo: [],
    couleurs: ['#000000'],
    franceconnect: false,
    espaces_multiples: [],
    a_verifier: true,
  });

  it('une marque active reste active même avec un avertissement (champ de commentaire, pas de contrôle)', () => {
    expect(estActive({ ...base, avertissement: 'commentaire sans rapport avec la publication' })).toBe(true);
  });

  it('une marque désactivée reste désactivée sans avertissement', () => {
    expect(estActive({ ...base, actif: false })).toBe(false);
  });
});
