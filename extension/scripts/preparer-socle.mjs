#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Livrable 1 du lot L3 : le socle publié n'est jamais supposé présent. Ce
// script régénère listes/publie/socle.json (via `npm run generer` dans
// listes/, qui n'inclut que les marques actives, cf. lot L2) puis copie le
// résultat dans src/listes/socle.genere.json, importé par
// src/listes/chargement.ts. Fichier dérivé, gitignore, jamais édité à la main.
//
// Ne signe pas la liste : un fichier embarqué dans le paquet de l'extension a
// déjà l'intégrité que lui donne la signature du store (Chrome Web Store /
// AMO). La signature Ed25519 (listes/outils/signer.ts, déjà prête) sert au
// scénario du lot L9 — une liste téléchargée depuis un CDN, où la menace est
// différente (CDN compromis, interception réseau) et où la vérification a
// vraiment un rôle à jouer.
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_EXTENSION = join(ICI, '..');
const DOSSIER_LISTES = join(RACINE_EXTENSION, '..', 'listes');
const SOCLE_PUBLIE = join(DOSSIER_LISTES, 'publie', 'socle.json');
const SOCLE_EMBARQUE = join(RACINE_EXTENSION, 'src', 'listes', 'socle.genere.json');

// Commande entièrement littérale, sans donnée externe interpolée : exécuter
// via un shell n'introduit aucun risque d'injection ici. execFileSync sans
// shell échoue à résoudre npm.cmd sous Windows (EINVAL) ; c'est le cas
// documenté où le shell est nécessaire, pas contourné par confort.
execSync('npm run generer', { cwd: DOSSIER_LISTES, stdio: 'inherit' });

mkdirSync(dirname(SOCLE_EMBARQUE), { recursive: true });
copyFileSync(SOCLE_PUBLIE, SOCLE_EMBARQUE);
console.log(`Socle copié dans ${SOCLE_EMBARQUE}.`);
