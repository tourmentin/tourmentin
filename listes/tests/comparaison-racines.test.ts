// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { LONGUEUR_MIN_CORRESPONDANCE_PARTIELLE, racineCorrespondAuHote } from '../outils/comparaison-racines.ts';

describe('racineCorrespondAuHote', () => {
  it('positif : correspondance exacte à une étiquette', () => {
    expect(racineCorrespondAuHote('ants', 'www.ants.fr')).toBe(true);
  });

  it('positif : correspondance exacte à une étiquette issue d\'un tiret', () => {
    expect(racineCorrespondAuHote('caf', 'mon-caf-perso.fr')).toBe(true);
  });

  it('négatif : sous-chaîne libre d\'une racine courte (< 6 caractères) rejetée — cas d\'école « ants » dans « enfants »', () => {
    expect(racineCorrespondAuHote('ants', 'www.enfantsduforez.com')).toBe(false);
  });

  it('négatif : « caf » dans « cafetheatre » rejeté', () => {
    expect(racineCorrespondAuHote('caf', '3tcafetheatre.com')).toBe(false);
  });

  it('négatif : « dila » dans « jardiland » rejeté', () => {
    expect(racineCorrespondAuHote('dila', 'www.jardiland.com')).toBe(false);
  });

  it('positif : sous-chaîne d\'une étiquette acceptée à partir de six caractères', () => {
    expect('assurancemaladie'.length).toBeGreaterThanOrEqual(LONGUEUR_MIN_CORRESPONDANCE_PARTIELLE);
    expect(racineCorrespondAuHote('assurancemaladie', 'www.assurancemaladiefictive.fr')).toBe(true);
  });

  it('cas limite : exactement six caractères, la sous-chaîne au sein d\'une étiquette est acceptée', () => {
    expect('impots'.length).toBe(6);
    expect(racineCorrespondAuHote('impots', 'www.impotsdomaine.fr')).toBe(true);
  });

  it('cas limite : cinq caractères, la sous-chaîne au sein d\'une étiquette est refusée', () => {
    expect('impot'.length).toBe(5);
    expect(racineCorrespondAuHote('impot', 'www.impotsdomaine.fr')).toBe(false);
  });

  it('négatif : aucun rapport', () => {
    expect(racineCorrespondAuHote('urssaf', 'exemple-quelconque.fr')).toBe(false);
  });

  it('insensible à la casse', () => {
    expect(racineCorrespondAuHote('ANTS', 'www.ANTS.fr')).toBe(true);
  });
});
