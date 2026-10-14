// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { fermetureResteValable, memoriserFermeture } from '../../src/contenu/fermeture.js';
import type { SignalDeclenche, Verdict } from '../../src/moteur/types.js';

const signal = (code: string): SignalDeclenche => ({ code, poids: 30, famille: 'mot-de-passe' as never, detail: '' });
const verdictN2 = (codes: string[], marque = 'impots-gouv'): Verdict => ({
  niveau: 'N2', motif: 'm', marqueDetectee: marque, signauxExposition: codes.map(signal),
});

describe('fermetureResteValable — 14.17 : la fermeture porte sur le verdict fermé', () => {
  const ferme = memoriserFermeture(verdictN2(['E1']));

  it('positif : verdict identique → reste fermé', () => {
    expect(fermetureResteValable(ferme, verdictN2(['E1']))).toBe(true);
  });

  it('positif : moins grave (N1, ou moins de signaux) → reste fermé', () => {
    expect(fermetureResteValable(ferme, { niveau: 'N1', motif: 'm', marqueDetectee: 'impots-gouv', signauxExposition: [signal('E1')] })).toBe(true);
    expect(fermetureResteValable(memoriserFermeture(verdictN2(['E1', 'E4'])), verdictN2(['E1']))).toBe(true);
  });

  it('négatif : un moyen de paiement (E8) apparaît sur la même page → le bandeau revient', () => {
    expect(fermetureResteValable(ferme, verdictN2(['E1', 'E8']))).toBe(false);
  });

  it('négatif : un signal d\'exposition absent à la fermeture (autre que E8) → le bandeau revient', () => {
    expect(fermetureResteValable(ferme, verdictN2(['E1', 'E4']))).toBe(false);
  });

  it('négatif : niveau supérieur → le bandeau revient', () => {
    expect(fermetureResteValable(ferme, { niveau: 'N3', motif: 'm', marqueDetectee: 'impots-gouv', signauxExposition: [signal('E1')] })).toBe(false);
  });

  it('cas limite : autre marque au même niveau → le bandeau revient (ce n\'est pas le même verdict)', () => {
    expect(fermetureResteValable(ferme, verdictN2(['E1'], 'ameli'))).toBe(false);
  });

  it('cas limite : fermé sans aucun signal mémorisé, tout signal ultérieur est une aggravation', () => {
    expect(fermetureResteValable(memoriserFermeture(verdictN2([])), verdictN2(['E1']))).toBe(false);
  });
});
