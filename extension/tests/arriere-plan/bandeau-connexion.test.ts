// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  MODE_AVERTISSEMENT_PAR_DEFAUT,
  PLAFOND_HOTES_VUS,
  ajouterHoteVu,
  doitAfficherBandeauConnexion,
  empreinteHote,
  estModeAvertissement,
} from '../../src/arriere-plan/bandeau-connexion.js';
import type { StatutAffiche } from '../../src/arriere-plan/statut.js';

function statut(partiel: Partial<StatutAffiche> = {}): StatutAffiche {
  return {
    code: 'inconnu-prudence',
    texte: 'x',
    couleur: 'jaune',
    peutSignalerOfficiel: true,
    peutDeclarerFrauduleuse: true,
    dejaDeclare: [],
    champMotDePasse: true,
    pagePaiement: false,
    ...partiel,
  };
}

describe('doitAfficherBandeauConnexion — 14.22 B', () => {
  it('positif : site inconnu, champ mot de passe, une première fois', () => {
    expect(doitAfficherBandeauConnexion(statut(), 'une-fois', false)).toBe(true);
  });

  it('« une fois par site » : pas une seconde fois', () => {
    expect(doitAfficherBandeauConnexion(statut(), 'une-fois', true)).toBe(false);
  });

  it('« à chaque visite » : même s\'il a déjà été vu', () => {
    expect(doitAfficherBandeauConnexion(statut(), 'chaque-visite', true)).toBe(true);
  });

  it('« jamais » : jamais, première fois comprise', () => {
    expect(doitAfficherBandeauConnexion(statut(), 'jamais', false)).toBe(false);
  });

  it('jamais si N1, N2 ou N3 est affiché : le bandeau d\'alerte prime', () => {
    for (const code of ['n1-ressemble', 'n2-imitation', 'n3-imitation', 'secret-reconnu', 'frauduleux-liste'] as const) {
      expect(doitAfficherBandeauConnexion(statut({ code }), 'chaque-visite', false)).toBe(false);
    }
  });

  it('jamais sur un site officiel vérifié', () => {
    expect(doitAfficherBandeauConnexion(statut({ code: 'officiel-verifie' }), 'chaque-visite', false)).toBe(false);
  });

  it('jamais sur une page hors périmètre, en exclusion personnelle, ou déjà signalée par l\'usager', () => {
    for (const code of ['hors-perimetre', 'reseau-local', 'exclusion-personnelle', 'declare-en-attente'] as const) {
      expect(doitAfficherBandeauConnexion(statut({ code }), 'chaque-visite', false)).toBe(false);
    }
  });

  it('exige un champ mot de passe : une page de paiement seule n\'en a pas', () => {
    expect(doitAfficherBandeauConnexion(statut({ champMotDePasse: false, pagePaiement: true }), 'chaque-visite', false)).toBe(false);
  });

  it('jamais sur une page qui porte un moyen de paiement, même avec un mot de passe', () => {
    expect(doitAfficherBandeauConnexion(statut({ pagePaiement: true }), 'chaque-visite', false)).toBe(false);
  });

  it('un site sans saisie sensible (statut gris) n\'en déclenche pas', () => {
    expect(doitAfficherBandeauConnexion(statut({ code: 'non-repertorie', champMotDePasse: false }), 'chaque-visite', false)).toBe(false);
  });
});

describe('réglage et mémoire « déjà vu »', () => {
  it('par défaut : une fois par site', () => {
    expect(MODE_AVERTISSEMENT_PAR_DEFAUT).toBe('une-fois');
  });

  it('estModeAvertissement refuse toute autre valeur', () => {
    expect(estModeAvertissement('jamais')).toBe(true);
    expect(estModeAvertissement('toujours')).toBe(false);
    expect(estModeAvertissement(undefined)).toBe(false);
  });

  it('empreinteHote : stable, insensible à la casse, 16 caractères hexadécimaux, ne contient pas l\'hôte', async () => {
    const a = await empreinteHote('Exemple.FR');
    expect(a).toBe(await empreinteHote('exemple.fr'));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toContain('exemple');
    expect(a).not.toBe(await empreinteHote('exemple.com'));
  });

  it('ajouterHoteVu : sans doublon, et plafonné : les plus anciennes sortent', () => {
    expect(ajouterHoteVu(['a'], 'a')).toEqual(['a']);
    expect(ajouterHoteVu(['a', 'b'], 'c', 2)).toEqual(['b', 'c']);
    const beaucoup = Array.from({ length: PLAFOND_HOTES_VUS }, (_, i) => `h${i}`);
    const suite = ajouterHoteVu(beaucoup, 'nouveau');
    expect(suite).toHaveLength(PLAFOND_HOTES_VUS);
    expect(suite[suite.length - 1]).toBe('nouveau');
    expect(suite).not.toContain('h0');
  });
});

describe('compteur local des bandeaux affichés — 14.24 A1', () => {
  it('un entier par jour (UTC), jamais un hôte', async () => {
    const { incrementerCompteur, cleJour } = await import('../../src/arriere-plan/bandeau-connexion.js');
    const jour = new Date('2026-09-30T23:59:00.000Z');
    expect(cleJour(jour)).toBe('2026-09-30');
    const a = incrementerCompteur({}, jour);
    const b = incrementerCompteur(a, jour);
    const c = incrementerCompteur(b, new Date('2026-10-01T00:01:00.000Z'));
    expect(c).toEqual({ '2026-09-30': 2, '2026-10-01': 1 });
    expect(JSON.stringify(c)).not.toMatch(/[a-z]{3,}\.[a-z]{2,}/);
  });

  it('ne modifie pas le compteur reçu', async () => {
    const { incrementerCompteur } = await import('../../src/arriere-plan/bandeau-connexion.js');
    const avant = { '2026-09-30': 1 };
    incrementerCompteur(avant, new Date('2026-09-30T10:00:00.000Z'));
    expect(avant).toEqual({ '2026-09-30': 1 });
  });
});
