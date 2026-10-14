// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.7 : les quatre scénarios exigés avant d'accepter la correction
// des formulaires implicites, au niveau du verdict complet (construireEntreeAnalyse
// -> analyser), pas seulement de la collecte de champs (voir aussi
// tests/adaptateurs/dom.test.ts pour les cas unitaires de la règle de rétention).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { construireEntreeAnalyse } from '../../src/adaptateurs/dom.js';
import { analyser } from '../../src/moteur/analyser.js';
import { configParDefaut, construireListes } from '../../src/listes/chargement.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const DOSSIER = join(ICI, '..', 'pages', 'diagnostic');

function verdictDe(fichier: string, url: string) {
  const html = readFileSync(join(DOSSIER, fichier), 'utf8');
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  const entree = construireEntreeAnalyse(dom.window.document);
  return { entree, verdict: analyser(entree, construireListes(), configParDefaut()) };
}

describe('12.3.3.7 — les quatre scénarios de la mesure avant acceptation', () => {
  it('page sans <form> avec un seul champ de recherche : Z5 s\'applique, N0', () => {
    const { verdict } = verdictDe('hors-formulaire-recherche-seule.html', 'https://mediatheque-test.fr/');
    expect(verdict.niveau).toBe('N0');
    expect(verdict.motif).toBe('aucun champ de saisie ni formulaire');
  });

  it('page sans <form> avec une inscription à la lettre d\'information seule : N0', () => {
    const { verdict } = verdictDe('hors-formulaire-newsletter-seule.html', 'https://festival-test.fr/');
    expect(verdict.niveau).toBe('N0');
    expect(verdict.motif).toBe('aucun champ de saisie ni formulaire');
  });

  it('page légitime du socle, mire sans <form> : N0 par Z2, pas par les seuils', () => {
    const { verdict } = verdictDe('hors-formulaire-socle-z2.html', 'https://ants.gouv.fr/connexion');
    expect(verdict.niveau).toBe('N0');
    expect(verdict.motif).toBe('domaine authentique de la marque détectée');
    expect(verdict.marqueDetectee).toBe('ants');
  });

  it(
    'gabarit représentatif Wix/Salesforce (identifiant + mot de passe hors <form>) : les champs sont ' +
      'désormais collectés — non-régression de forme ; la non-régression au sens strict se joue sur les 15 hôtes réels de 12.3.3.5',
    () => {
      const { entree, verdict } = verdictDe('hors-formulaire-spa-representatif.html', 'https://exemple-spa-test.fr/connexion');
      const champs = entree.formulaires.flatMap((f) => f.champs);
      expect(champs.map((c) => c.type).sort()).toEqual(['password', 'text']);
      // Aucun marqueur de marque sur ce gabarit générique : reste N0, mais
      // plus par Z5 — le point vérifié est que la page A ÉTÉ mise à l'épreuve.
      expect(verdict.motif).not.toBe('aucun champ de saisie ni formulaire');
    },
  );
});
