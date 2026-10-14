#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.54 : LICENSE et NOTICE (racine du dépôt) sont copiés dans le dossier du build, donc dans les archives distribuées (zip Chrome, .xpi Firefox).
//   node scripts/ajouter-licence.mjs chrome-essai
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cible = join(RACINE, 'extension', 'dist', process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(join(cible, 'manifest.json'))) { console.error(`REFUS : build absent (${cible}).`); process.exit(1); }
for (const f of ['LICENSE', 'NOTICE']) {
  if (!existsSync(join(RACINE, f))) { console.error(`REFUS : ${f} absent à la racine du dépôt.`); process.exit(1); }
  copyFileSync(join(RACINE, f), join(cible, f));
}
console.log(`LICENSE et NOTICE ajoutés à dist/${process.argv[2]}`);
