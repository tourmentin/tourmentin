// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.1 : ce test doit échouer si le filtrage du harnais L5 en vient à
// bloquer un type de ressource dont un signal dépend (I5, I6, E7). Il ne fait
// pas partie du seuil de couverture 100 % de l'extension (vitest.config.ts
// n'inclut pas tests/corpus/) : c'est un test de garde-fou, pas du moteur.
import { describe, expect, it } from 'vitest';
import { doitBloquerRessource, estHoteRegie, TYPES_JAMAIS_BLOQUES, TYPE_TOUJOURS_BLOQUE } from './filtrage-ressources.mjs';
import { HOTES_REGIES_PUBLICITAIRES } from './regies-publicitaires.mjs';

describe('garde-fou spec 12.3.1 : types jamais bloqués', () => {
  it.each(TYPES_JAMAIS_BLOQUES)('%s n\'est jamais bloqué, même sur un hôte de régie', (type) => {
    for (const regie of HOTES_REGIES_PUBLICITAIRES) {
      expect(doitBloquerRessource(regie, type, HOTES_REGIES_PUBLICITAIRES)).toBe(false);
      expect(doitBloquerRessource(`sous-domaine.${regie}`, type, HOTES_REGIES_PUBLICITAIRES)).toBe(false);
    }
  });

  it('la liste des types protégés couvre bien image, stylesheet, font, document et sub_frame', () => {
    expect(TYPES_JAMAIS_BLOQUES).toEqual(expect.arrayContaining(['image', 'stylesheet', 'font', 'document', 'sub_frame']));
  });

  it('le type toujours bloqué est exactement "media", jamais un des types protégés', () => {
    expect(TYPE_TOUJOURS_BLOQUE).toBe('media');
    expect(TYPES_JAMAIS_BLOQUES).not.toContain(TYPE_TOUJOURS_BLOQUE);
  });
});

describe('doitBloquerRessource', () => {
  it('bloque toujours le type media, quel que soit l\'hôte', () => {
    expect(doitBloquerRessource('site-quelconque.fr', 'media', [])).toBe(true);
    expect(doitBloquerRessource('doubleclick.net', 'media', HOTES_REGIES_PUBLICITAIRES)).toBe(true);
  });

  it('bloque un script ou un xhr servi par une régie connue', () => {
    expect(doitBloquerRessource('doubleclick.net', 'script', HOTES_REGIES_PUBLICITAIRES)).toBe(true);
    expect(doitBloquerRessource('www.google-analytics.com', 'xhr', HOTES_REGIES_PUBLICITAIRES)).toBe(true);
  });

  it('négatif : ne bloque pas un script ou un xhr sur un hôte hors liste', () => {
    expect(doitBloquerRessource('site-legitime.fr', 'script', HOTES_REGIES_PUBLICITAIRES)).toBe(false);
  });

  it('cas limite : un hôte dont le nom contient une régie sans en être un sous-domaine n\'est pas bloqué', () => {
    // "pas-doubleclick.net" ne se termine pas par ".doubleclick.net" et n'est
    // pas non plus "doubleclick.net" : ce n'est pas la même régie.
    expect(doitBloquerRessource('pas-doubleclick.net', 'script', HOTES_REGIES_PUBLICITAIRES)).toBe(false);
  });
});

describe('estHoteRegie', () => {
  it('reconnaît le domaine exact et un sous-domaine', () => {
    expect(estHoteRegie('doubleclick.net', ['doubleclick.net'])).toBe(true);
    expect(estHoteRegie('ads.doubleclick.net', ['doubleclick.net'])).toBe(true);
  });

  it('négatif : un domaine sans rapport n\'est pas reconnu', () => {
    expect(estHoteRegie('exemple.fr', ['doubleclick.net'])).toBe(false);
  });

  it('la casse ne change pas le résultat', () => {
    expect(estHoteRegie('ADS.DOUBLECLICK.NET', ['doubleclick.net'])).toBe(true);
  });
});

describe('regies-publicitaires.mjs', () => {
  it('la liste est non vide et ne contient que des noms d\'hôtes plausibles', () => {
    expect(HOTES_REGIES_PUBLICITAIRES.length).toBeGreaterThan(0);
    for (const hote of HOTES_REGIES_PUBLICITAIRES) {
      expect(hote).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
    }
  });
});
