// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.43 : identifiant de construction (le `version_name` du manifeste, 14.19 E), fixé à la construction (vite.config.ts,
// `define`). Compilé DANS le service worker ET dans les pages : si une page est plus récente que le service worker en cours
// d'exécution (fichiers remplacés sans recharger l'extension), les deux valeurs diffèrent et la page le dit.
declare const __BUILD_ID__: string | undefined;

export const BUILD_ID: string = typeof __BUILD_ID__ === 'undefined' ? 'hors-build' : __BUILD_ID__;
