// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { AVERTISSEMENT_EXPORT, construireExport, nomFichierExport } from '../../src/arriere-plan/export.js';
import { construireEntreeJournal } from '../../src/arriere-plan/journal.js';
import { construireEntreeSignalement } from '../../src/arriere-plan/signalements.js';
import type { Verdict } from '../../src/moteur/types.js';

const VERSIONS = { extension: '0.0.1', socle: '2026.09.055' };
const MAINTENANT = new Date('2026-09-28T20:00:00.000Z');
const verdict: Verdict = { niveau: 'N2', motif: 'imitation au-delà du seuil et exposition significative', marqueDetectee: 'urssaf', scoreImitation: 80, scoreExposition: 40 };

describe('construireExport — 14.11 rang 2 : le canal de collecte du palier', () => {
  it('positif : JSON lisible portant versions, date, avertissement et entrées', () => {
    const entrees = [construireEntreeJournal('https://faux-urssaf.fr/connexion?jeton=abc123#frag', verdict, '2026-09-28T19:00:00.000Z')];
    const texte = construireExport('journal', entrees, VERSIONS, MAINTENANT);
    const objet = JSON.parse(texte);
    expect(objet).toMatchObject({
      application: 'Tourmentin', type: 'journal', version_extension: '0.0.1', version_socle: '2026.09.055',
      exporte_le: '2026-09-28T20:00:00.000Z', nombre_entrees: 1,
    });
    expect(objet.avertissement).toBe(AVERTISSEMENT_EXPORT);
    expect(objet.entrees[0]).toMatchObject({ hote: 'faux-urssaf.fr', chemin: '/connexion', requetePresente: true, niveau: 'N2' });
    expect(texte).toContain('\n  '); // indenté : le testeur peut le relire avant de l'envoyer
  });

  it('négatif : ni requête, ni fragment, ni jeton ne se retrouvent dans le fichier', () => {
    const entrees = [
      construireEntreeSignalement('https://faux-caf.fr/mon-compte?adresse=jean%40mail.fr&jeton=abc123#secret', verdict),
      construireEntreeJournal('https://faux-caf.fr/mon-compte?adresse=jean%40mail.fr#secret', verdict),
    ];
    for (const type of ['journal', 'signalements'] as const) {
      const texte = construireExport(type, entrees as never, VERSIONS, MAINTENANT);
      expect(texte).not.toContain('jean');
      expect(texte).not.toContain('abc123');
      expect(texte).not.toContain('secret');
    }
  });

  it('cas limite : liste vide — un fichier valide, nombre_entrees à 0, pas une erreur', () => {
    const objet = JSON.parse(construireExport('signalements', [], VERSIONS, MAINTENANT));
    expect(objet.nombre_entrees).toBe(0);
    expect(objet.entrees).toEqual([]);
  });
});

describe('nomFichierExport', () => {
  it('positif : type et date dans le nom, distincts entre journal et signalements', () => {
    expect(nomFichierExport('journal', MAINTENANT)).toBe('tourmentin-journal-2026-09-28.json');
    expect(nomFichierExport('signalements', MAINTENANT)).toBe('tourmentin-signalements-2026-09-28.json');
  });
});

describe('construireExport — compteur des bandeaux de connexion (14.24 A1)', () => {
  it('positif : le nombre par jour figure dans les deux types de fichier, et l\'avertissement le dit', () => {
    for (const type of ['journal', 'signalements'] as const) {
      const objet = JSON.parse(construireExport(type, [], VERSIONS, MAINTENANT, { '2026-09-30': 4, '2026-10-01': 1 }));
      expect(objet.bandeaux_connexion_par_jour).toEqual({ '2026-09-30': 4, '2026-10-01': 1 });
    }
    expect(AVERTISSEMENT_EXPORT).toContain('bandeaux de connexion');
  });

  it('cas limite : sans compteur, l\'objet est présent et vide', () => {
    expect(JSON.parse(construireExport('journal', [], VERSIONS, MAINTENANT)).bandeaux_connexion_par_jour).toEqual({});
  });
});
