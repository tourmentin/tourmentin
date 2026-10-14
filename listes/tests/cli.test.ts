// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { estAppeleDirectement } from '../outils/cli.js';

describe('estAppeleDirectement', () => {
  it('positif : correspond à process.argv[1]', () => {
    expect(process.argv[1]).toBeDefined();
    expect(estAppeleDirectement(pathToFileURL(process.argv[1]!).href)).toBe(true);
  });

  it('négatif : url différente', () => {
    expect(estAppeleDirectement('file:///autre-module.js')).toBe(false);
  });

  it('cas limite : process.argv[1] absent', () => {
    const original = [...process.argv];
    process.argv.length = 1;
    try {
      expect(estAppeleDirectement('file:///peu-importe.js')).toBe(false);
    } finally {
      process.argv = original;
    }
  });
});
