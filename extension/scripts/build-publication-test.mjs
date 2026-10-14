#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.33 G : construit l'extension d'essai de bout en bout des listes signées, avec une clé publique JETABLE et
// un serveur statique local. Variables : TOURMENTIN_URL_PUBLICATION (http://127.0.0.1:<port>/) et
// TOURMENTIN_CLE_PUBLIQUE_LISTES (64 hexadécimaux). Sortie dans dist/chrome-publication-test, JAMAIS dans
// dist/chrome-essai : ce build ne peut pas être remis à un testeur (verifier-build-essai.mjs le contrôle aussi).
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE_EXTENSION = join(dirname(fileURLToPath(import.meta.url)), '..');
// 14.48 : « --firefox » construit la variante Firefox (dist/firefox-publication-test)
const mode = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
execSync(`npx vite build --mode ${mode}`, {
  cwd: RACINE_EXTENSION,
  stdio: 'inherit',
  env: { ...process.env, TOURMENTIN_PUBLICATION_ESSAI_LOCAL: '1' },
});
