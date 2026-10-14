// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { pathToFileURL } from 'node:url';

/** Vrai quand le module est exécuté directement (`node fichier.ts`), faux quand il est importé. */
export function estAppeleDirectement(urlDuModule: string): boolean {
  return process.argv[1] !== undefined && urlDuModule === pathToFileURL(process.argv[1]).href;
}
