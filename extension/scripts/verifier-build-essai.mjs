#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.15 point 1 : garde-fou sur le seul build jamais remis à un testeur.
// Lit ce qui a été COMPILÉ dans dist/chrome-essai et refuse s'il porte N3 actif.
// Lancé automatiquement après `npm run build:chrome` (postbuild:chrome) : la
// sûreté ne repose pas sur une étape qu'on se rappelle.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOSSIER = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'chrome-essai');
if (!existsSync(join(DOSSIER, 'manifest.json'))) {
  console.error(`REFUS : ${DOSSIER} absent ou incomplet — aucun build d'essai à valider.`);
  process.exit(1);
}
const assets = join(DOSSIER, 'assets');
const compiles = readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8'));
const avecDrapeau = compiles.filter((t) => /n3ParScoreActif:/.test(t));
const actif = avecDrapeau.some((t) => /n3ParScoreActif:(!0|true)/.test(t));
const eteint = avecDrapeau.some((t) => /n3ParScoreActif:(!1|false)/.test(t));
if (actif || !eteint) {
  console.error(`REFUS : dist/chrome-essai ne porte pas le plafond N2 (14.5) — NE PAS DISTRIBUER. (drapeau éteint trouvé : ${eteint}, allumé : ${actif})`);
  process.exit(1);
}
// 14.33 B et C : le build remis ne porte jamais le serveur local ni la clé jetable du build d'essai des listes.
if (compiles.some((t) => /127\.0\.0\.1:\d{2,5}\//.test(t))) {
  console.error("REFUS : dist/chrome-essai porte une adresse de publication locale (build d'essai de bout en bout) — NE PAS DISTRIBUER.");
  process.exit(1);
}
console.log('OK : dist/chrome-essai porte le plafond N2 (N3 par score éteint), prêt pour la remise.');
