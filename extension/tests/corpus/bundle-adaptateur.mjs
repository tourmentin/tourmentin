// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Construit (et met en cache) le bundle IIFE de entree-adaptateur.ts avec vite,
// pour l'injecter dans les pages via page.addScriptTag / frame.evaluate.
import { build } from 'vite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ICI = dirname(fileURLToPath(import.meta.url));
const SORTIE = join(ICI, '.cache');

export async function construireBundleAdaptateur() {
  await build({
    configFile: false,
    logLevel: 'error',
    root: join(ICI, '..', '..'),
    build: {
      outDir: SORTIE,
      emptyOutDir: true,
      minify: false,
      lib: { entry: join(ICI, 'entree-adaptateur.ts'), formats: ['iife'], name: 'TourmentinDiag', fileName: () => 'entree-adaptateur.js' },
    },
  });
  return readFileSync(join(SORTIE, 'entree-adaptateur.js'), 'utf8');
}
