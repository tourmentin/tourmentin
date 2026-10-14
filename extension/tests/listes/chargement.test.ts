// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { chargerSocle, configParDefaut, construireListes } from '../../src/listes/chargement.js';

describe('chargerSocle (fichier réellement publié par listes/outils/generer.ts)', () => {
  it('charge les 9 marques actives, déjà au format EmpreinteMarque (projection, spec v1.5)', () => {
    const socle = chargerSocle();
    expect(socle.length).toBe(9);
    for (const empreinte of socle) {
      expect(typeof empreinte.id).toBe('string');
      expect(Array.isArray(empreinte.termesForts)).toBe(true);
      expect(Array.isArray(empreinte.domaines)).toBe(true);
      // 14.12 : le bandeau N2 affiche ce champ comme adresse officielle, jamais un sous-domaine deviné.
      expect(typeof empreinte.domainePrincipal).toBe('string');
      expect(empreinte.domaines).toContain(empreinte.domainePrincipal);
      expect(typeof empreinte.criticite).toBe('number');
      // Le fichier publié est un contrat : aucun commentaire de maintenance dedans.
      expect(empreinte).not.toHaveProperty('a_verifier');
      expect(empreinte).not.toHaveProperty('notes_verification');
      expect(empreinte).not.toHaveProperty('avertissement');
    }
  });
});

describe('construireListes / configParDefaut', () => {
  it('construit des Listes exploitables par analyser(), le socle chargé et le reste vide', () => {
    const listes = construireListes();
    expect(listes.socle.length).toBe(9);
    expect(listes.revocation).toEqual([]);
    expect(listes.exclusionsPersonnelles).toEqual([]);
    expect(listes.communautaireValidee).toEqual([]);
    expect(listes.domainesDejaVus).toEqual([]);
    expect(listes.tldAbusifs).toEqual([]);
  });

  it('config par défaut : sensibilité équilibrée, rien de personnel configuré', () => {
    expect(configParDefaut()).toEqual({ sensibilite: 'equilibre', motsClesPersonnels: [], secretsSurveilles: [], n3ParScoreActif: true });
  });
});
