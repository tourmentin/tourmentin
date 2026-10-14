// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { FENETRE_FP_MS, FENETRE_LATENCE_MS } from './fenetre-analyse.mjs';

describe('fenêtres d\'analyse (12.3.1.3 : la fenêtre élargie ne fuit pas dans la passe de faux positifs)', () => {
  it('la fenêtre de la passe de faux positifs reste à 1,5 s', () => {
    expect(FENETRE_FP_MS).toBe(1_500);
  });

  it('la fenêtre de la campagne de mesure de latence est élargie à 10 s', () => {
    expect(FENETRE_LATENCE_MS).toBe(10_000);
  });

  it('les deux fenêtres sont des constantes distinctes, pas une valeur dérivée d\'un mode', () => {
    expect(FENETRE_LATENCE_MS).not.toBe(FENETRE_FP_MS);
    expect(FENETRE_LATENCE_MS).toBeGreaterThan(FENETRE_FP_MS);
  });
});
