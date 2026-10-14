// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// CLAUDE.md, règle 4 : src/moteur/ ne doit importer aucune API navigateur,
// aucun type DOM, aucun chrome.*. Ce test lit les fichiers sources et échoue
// si l'un d'eux contredit cette contrainte.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// import.meta.url plutôt que __dirname : le paquet est en ESM strict
// ("type": "module"), où __dirname n'existe pas.
const ICI = dirname(fileURLToPath(import.meta.url));
const DOSSIER_MOTEUR = join(ICI, '..', '..', 'src', 'moteur');

const MOTIFS_INTERDITS: { motif: RegExp; description: string }[] = [
  { motif: /\bchrome\./, description: 'API chrome.*' },
  { motif: /\bdocument\./, description: 'API document.*' },
  { motif: /\bwindow\./, description: 'API window.*' },
  { motif: /\b(HTMLElement|HTMLInputElement|HTMLFormElement|Element|Node|ShadowRoot)\b/, description: 'type DOM' },
  { motif: /lib=["']dom["']/i, description: 'référence à la lib DOM' },
];

function fichiersSource(): string[] {
  return readdirSync(DOSSIER_MOTEUR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(DOSSIER_MOTEUR, f));
}

describe('pureté du moteur (src/moteur)', () => {
  const fichiers = fichiersSource();

  it('trouve au moins un fichier à vérifier', () => {
    expect(fichiers.length).toBeGreaterThan(0);
  });

  it.each(fichiers)('%s ne contient aucune dépendance navigateur', (chemin) => {
    const contenu = readFileSync(chemin, 'utf8');
    for (const { motif, description } of MOTIFS_INTERDITS) {
      expect(motif.test(contenu), `${chemin} contient une référence interdite : ${description}`).toBe(false);
    }
  });
});
