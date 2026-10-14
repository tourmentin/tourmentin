#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.5 / 14.13 : construit l'extension avec N3 actif, pour les passes du
// harnais (faux positifs, latence, diagnostics). Le build d'essai remis aux
// testeurs (`npm run build:chrome`) plafonne le N3 par score à N2 : mesuré
// avec lui, C1 se lirait à 0 par construction.
//
// Sortie dans dist/chrome-mesure, jamais dans dist/chrome-essai (14.15 point 1) :
// le build de mesure ne peut pas être remis à un testeur par une étape oubliée.
// Il s'annonce en outre (options, badge « M »).
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE_EXTENSION = join(dirname(fileURLToPath(import.meta.url)), '..');

// Commande entièrement littérale : aucun risque d'injection ; le shell est
// nécessaire sous Windows pour résoudre npx.cmd (cf. preparer-socle.mjs).
execSync('npx vite build --mode chrome', {
  cwd: RACINE_EXTENSION,
  stdio: 'inherit',
  env: { ...process.env, TOURMENTIN_N3: '1' },
});
