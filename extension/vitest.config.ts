// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Environnement Node partout : les tests d'adaptateurs construisent leurs
    // propres documents via `new JSDOM(html, { url })` (paquet jsdom), ce qui
    // donne un contrôle par test de l'URL — impossible à faire proprement en
    // réaffectant `document.location` d'un environnement jsdom global.
    coverage: {
      provider: 'v8',
      include: ['src/moteur/**/*.ts', 'src/adaptateurs/**/*.ts', 'src/arriere-plan/fusion.ts', 'src/listes/**/*.ts'],
      // types.ts : interfaces seules, aucun JS émis. contenu/ et arriere-plan/service-worker.ts :
      // liaison chrome.* non testable unitairement sans un navigateur réel (voir
      // leur commentaire d'en-tête) ; exercés pour de vrai au lot L5 (Playwright).
      exclude: ['src/moteur/types.ts'],
      thresholds: {
        branches: 100,
      },
    },
  },
});
