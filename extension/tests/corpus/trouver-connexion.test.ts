// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.2 et 12.3.3.3 : le jugement d'une page de connexion porte sur ce
// que l'adaptateur de l'extension voit (structure des formulaires), et la
// catégorie back-office écarte les écrans d'administration de CMS. Hors seuil
// de couverture de src/ (comme les autres tests du harnais).
import { describe, expect, it } from 'vitest';
import { estBackOffice, jugerAnalyse, resumerImitation } from './trouver-connexion.mjs';
import { tirerAuHasard } from './tirage.mjs';

type Champ = { type: string; autocomplete?: string | null; nom?: string | null; libelle?: string | null; placeholder?: string | null };
const analyse = (titre: string, chemin: string, ...formulaires: Champ[][]) => ({
  titre,
  chemin,
  formulaires: formulaires.map((champs) => ({ champs })),
});

describe('jugerAnalyse', () => {
  it('positif : champ password -> mot-de-passe', () => {
    expect(jugerAnalyse(analyse('Accueil', '/', [{ type: 'text' }, { type: 'password' }]))).toBe('mot-de-passe');
  });

  it('positif : connexion en deux temps, autocomplete username, titre de connexion -> identifiant', () => {
    expect(jugerAnalyse(analyse('Connexion – ANTS', '/connexion', [{ type: 'text', autocomplete: 'username' }]))).toBe('identifiant');
  });

  it('positif : identifiant reconnu par son libellé, chemin de connexion', () => {
    expect(jugerAnalyse(analyse('Espace', '/login', [{ type: 'text', libelle: 'Adresse e-mail' }]))).toBe('identifiant');
  });

  it('négatif : champ e-mail d\'une newsletter sur une page qui n\'évoque pas la connexion', () => {
    expect(jugerAnalyse(analyse('Restez informé', '/actualites', [{ type: 'email', autocomplete: 'email' }]))).toBeNull();
  });

  it('négatif : formulaire de connexion sans champ reconnu comme identifiant (recherche)', () => {
    expect(jugerAnalyse(analyse('Connexion', '/connexion', [{ type: 'text', nom: 'q', placeholder: 'Rechercher' }]))).toBeNull();
  });

  it('négatif : aucun formulaire (champs hors <form> : invisibles pour l\'extension)', () => {
    expect(jugerAnalyse(analyse('Connexion', '/connexion'))).toBeNull();
  });
});

describe('resumerImitation', () => {
  it('ne consigne ni texte de page ni valeur de champ, seulement structure et signaux', () => {
    const r = resumerImitation({
      href: 'https://exemple.fr/connexion?state=abc#x',
      formulaires: [{ champs: [{ type: 'text' }] }],
      axe: { score: 30, marqueDetectee: 'franceconnect', signaux: [{ code: 'I1', poids: 30, famille: 'textuelle', detail: 'terme fort "x"' }] },
      marqueurs: [{ marque: 'franceconnect', horsDomaines: true, termesForts: ['x'] }],
    });
    expect(r).toEqual({
      url: 'https://exemple.fr/connexion',
      aFormulaire: true,
      etape: null,
      scoreImitation: 30,
      marqueDetectee: 'franceconnect',
      signaux: [{ code: 'I1', poids: 30, famille: 'textuelle', detail: 'terme fort "x"' }],
      marqueurs: [{ marque: 'franceconnect', horsDomaines: true, termesForts: ['x'] }],
    });
  });

  it('null quand la page n\'a pas pu être lue', () => {
    expect(resumerImitation(null)).toBeNull();
  });
});

describe('estBackOffice', () => {
  it.each(['https://exemple.fr/wp-login.php', 'https://exemple.fr/wp-admin/', 'https://exemple.fr/administrator/', '/typo3/', 'https://exemple.fr/admin'])(
    'positif : %s',
    (u) => expect(estBackOffice(u)).toBe(true),
  );

  it.each(['https://exemple.fr/login', 'https://exemple.fr/connexion', 'https://exemple.fr/user/login', 'https://exemple.fr/administration-publique'])(
    'négatif : %s',
    (u) => expect(estBackOffice(u)).toBe(false),
  );
});

describe('tirerAuHasard', () => {
  it('reproductible à graine fixe, et mélange bien', () => {
    const liste = Array.from({ length: 50 }, (_, i) => i);
    expect(tirerAuHasard(liste, 50, 1)).toEqual(tirerAuHasard(liste, 50, 1));
    expect(tirerAuHasard(liste, 50, 1)).not.toEqual(liste);
  });
});
