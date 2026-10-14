// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { fusionnerFrames, type RapportFrame } from '../../src/arriere-plan/fusion.js';
import type { EntreeAnalyse } from '../../src/moteur/types.js';

function entreeMinimale(partiel: Partial<EntreeAnalyse> = {}): EntreeAnalyse {
  return {
    source: 'page',
    titre: '',
    texteVisible: '',
    liens: [],
    formulaires: [],
    ressources: { logosHash: [], couleursDominantes: [] },
    comportements: [],
    horodatage: 0,
    ...partiel,
  };
}

function urlDe(domaineEnregistrable: string) {
  return {
    href: `https://${domaineEnregistrable}/`,
    hote: domaineEnregistrable,
    schema: 'https',
    domaineEnregistrable,
    suffixePublic: 'fr',
    sousDomaines: [],
    chemin: '/',
    punycode: false,
    estAdresseIp: false,
  };
}

describe('fusionnerFrames', () => {
  it('positif : le formulaire d\'une frame enfant cross-origin est réétiqueté', () => {
    const rapports: RapportFrame[] = [
      { frameId: 0, entree: entreeMinimale({ url: urlDe('impots.gouv.fr') }) },
      {
        frameId: 5,
        entree: entreeMinimale({
          url: urlDe('attaquant.com'),
          formulaires: [{ champs: [], dansIframeCrossOrigin: false }],
        }),
      },
    ];
    const fusion = fusionnerFrames(rapports)!;
    expect(fusion.formulaires).toHaveLength(1);
    expect(fusion.formulaires[0]).toMatchObject({ dansIframeCrossOrigin: true, domaineFrame: 'attaquant.com' });
  });

  it('négatif : pas de frame principale (frameId 0) → null', () => {
    const rapports: RapportFrame[] = [{ frameId: 3, entree: entreeMinimale({ url: urlDe('impots.gouv.fr') }) }];
    expect(fusionnerFrames(rapports)).toBeNull();
  });

  it('cas limite : frame enfant de même domaine → pas cross-origin', () => {
    const rapports: RapportFrame[] = [
      { frameId: 0, entree: entreeMinimale({ url: urlDe('impots.gouv.fr') }) },
      {
        frameId: 1,
        entree: entreeMinimale({
          url: urlDe('impots.gouv.fr'),
          formulaires: [{ champs: [], dansIframeCrossOrigin: false }],
        }),
      },
    ];
    const fusion = fusionnerFrames(rapports)!;
    expect(fusion.formulaires[0]?.dansIframeCrossOrigin).toBe(false);
  });

  it('cas limite : aucune frame enfant n\'a de formulaire → l\'entrée principale est renvoyée telle quelle', () => {
    const principal = entreeMinimale({ url: urlDe('impots.gouv.fr') });
    const rapports: RapportFrame[] = [
      { frameId: 0, entree: principal },
      { frameId: 2, entree: entreeMinimale({ url: urlDe('impots.gouv.fr') }) },
    ];
    expect(fusionnerFrames(rapports)).toBe(principal);
  });

  it('cas limite : frame enfant sans URL connue (ex. data:) → non marquée cross-origin', () => {
    const rapports: RapportFrame[] = [
      { frameId: 0, entree: entreeMinimale({ url: urlDe('impots.gouv.fr') }) },
      { frameId: 4, entree: entreeMinimale({ formulaires: [{ champs: [], dansIframeCrossOrigin: false }] }) },
    ];
    const fusion = fusionnerFrames(rapports)!;
    expect(fusion.formulaires[0]).toMatchObject({ dansIframeCrossOrigin: false, domaineFrame: undefined });
  });
});
