#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.48 : signature Mozilla, canal « non listé », de dist/firefox-essai. Les clés d'API sont lues dans l'environnement
// (WEB_EXT_API_KEY, WEB_EXT_API_SECRET) par web-ext ; ce script vérifie seulement qu'elles existent, sans jamais les afficher.
// Seul le fichier de l'extension (code compilé, sans clé ni donnée d'utilisateur) est transmis à Mozilla.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(RACINE, 'dist', 'firefox-essai');
const SORTIE = join(RACINE, 'dist', 'signe');
for (const v of ['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET']) {
  if (!process.env[v]) { console.error(`REFUS : la variable d'environnement ${v} n'est pas définie (voir la procédure donnée à Ph).`); process.exit(1); }
}
if (!existsSync(join(SOURCE, 'manifest.json'))) { console.error('REFUS : dist/firefox-essai absent (npm run build:firefox).'); process.exit(1); }
mkdirSync(SORTIE, { recursive: true });
const r = spawnSync('npx', ['web-ext', 'sign', '--channel=unlisted', `--source-dir=${SOURCE}`, `--artifacts-dir=${SORTIE}`], { cwd: RACINE, stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
