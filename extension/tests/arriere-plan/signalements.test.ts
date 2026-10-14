// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { apercuSignalement, construireEntreeSignalement } from '../../src/arriere-plan/signalements.js';
import type { Verdict } from '../../src/moteur/types.js';

describe('construireEntreeSignalement — 14.7 : la déclaration ne porte jamais plus que le journal', () => {
  it('positif : disponible même pour un verdict N0 (14.7, point 2 : le faux négatif étiqueté)', () => {
    const verdict: Verdict = { niveau: 'N0', motif: 'sous les seuils d\'alerte', scoreImitation: 20, scoreExposition: 0 };
    const entree = construireEntreeSignalement('https://faux-service-public.fr/identifiants?secret=xyz', verdict, '2026-09-27T10:00:00.000Z');
    expect(entree).toMatchObject({ niveau: 'N0', hote: 'faux-service-public.fr', chemin: '/identifiants', requetePresente: true });
    expect(JSON.stringify(entree)).not.toContain('xyz');
  });

  it('négatif : aucune valeur de champ ni contenu de page dans la structure produite', () => {
    const verdict: Verdict = { niveau: 'N1', motif: 'indices d\'imitation et exposition modérée', marqueDetectee: 'ameli' };
    const entree = construireEntreeSignalement('https://exemple.fr/connexion', verdict);
    expect(Object.keys(entree).sort()).toEqual(
      ['chemin', 'horodatage', 'hote', 'marqueDetectee', 'motif', 'niveau', 'requetePresente', 'schema', 'scoreExposition', 'scoreImitation', 'type'].sort(),
    );
  });
});

describe('apercuSignalement — 14.7 point 3 : ce que la confirmation doit montrer', () => {
  it('positif : montre adresse (sans requête), niveau, motif et marque', () => {
    const verdict: Verdict = { niveau: 'N0', motif: 'sous les seuils d\'alerte', marqueDetectee: 'caf' };
    const entree = construireEntreeSignalement('https://faux-caf.fr/mon-compte?jeton=secret-de-session', verdict, '2026-09-27T10:00:00.000Z');
    const apercu = apercuSignalement(entree);
    expect(apercu).toContain('faux-caf.fr/mon-compte');
    expect(apercu).toContain('N0');
    expect(apercu).toContain('caf');
    expect(apercu).not.toContain('jeton');
    expect(apercu).not.toContain('secret-de-session');
  });

  it('cas limite : aucune marque détectée, le texte le dit explicitement plutôt que de rester muet', () => {
    const verdict: Verdict = { niveau: 'N0', motif: 'sous les seuils d\'alerte' };
    const entree = construireEntreeSignalement('https://exemple.fr/page', verdict);
    expect(apercuSignalement(entree)).toContain('Aucune marque détectée');
  });
});
