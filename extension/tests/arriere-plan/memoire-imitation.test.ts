// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.57 : mémoire d'imitation par hôte exact, 15 minutes (table pure ; le service worker la range dans chrome.storage.session).
import { describe, expect, it } from 'vitest';
import { DUREE_MEMOIRE_IMITATION_MS } from '../../src/moteur/constantes.js';
import { PLAFOND_HOTES_MEMOIRE, lireImitationRetenue, retenirImitation } from '../../src/arriere-plan/memoire-imitation.js';

const R = { marque: 'impots-gouv', scoreImitation: 80, familles: ['domaine', 'contenu'] };
const T0 = 1_000_000;

describe('mémoire d\'imitation (14.57)', () => {
  it('relit ce qui a été retenu pour le même hôte', () => {
    const t = retenirImitation(undefined, 'faux.example', R, T0);
    expect(lireImitationRetenue(t, 'faux.example', T0 + 1000)).toEqual(R);
  });
  it('clé = hôte exact : un autre sous-domaine, ou le domaine parent, ne la voit pas', () => {
    const t = retenirImitation(undefined, 'faux.example', R, T0);
    expect(lireImitationRetenue(t, 'www.faux.example', T0)).toBeUndefined();
    expect(lireImitationRetenue(t, 'example', T0)).toBeUndefined();
    expect(lireImitationRetenue(t, 'autre.example', T0)).toBeUndefined();
  });
  it('15 minutes : valable juste avant, périmée à 15 minutes pile', () => {
    const t = retenirImitation(undefined, 'faux.example', R, T0);
    expect(lireImitationRetenue(t, 'faux.example', T0 + DUREE_MEMOIRE_IMITATION_MS - 1)).toEqual(R);
    expect(lireImitationRetenue(t, 'faux.example', T0 + DUREE_MEMOIRE_IMITATION_MS)).toBeUndefined();
  });
  it('une horloge qui recule ne prolonge pas la mémoire', () => {
    const t = retenirImitation(undefined, 'faux.example', R, T0);
    expect(lireImitationRetenue(t, 'faux.example', T0 - 1)).toBeUndefined();
  });
  it('retenir à nouveau remet le compteur à zéro pour cet hôte', () => {
    let t = retenirImitation(undefined, 'faux.example', R, T0);
    t = retenirImitation(t, 'faux.example', { ...R, scoreImitation: 90 }, T0 + 10 * 60_000);
    expect(lireImitationRetenue(t, 'faux.example', T0 + 20 * 60_000)?.scoreImitation).toBe(90);
  });
  it('les entrées périmées sont retirées de la table à chaque écriture', () => {
    let t = retenirImitation(undefined, 'a.example', R, T0);
    t = retenirImitation(t, 'b.example', R, T0 + DUREE_MEMOIRE_IMITATION_MS + 1);
    expect(Object.keys(t)).toEqual(['b.example']);
  });
  it('plafond : au plus ' + PLAFOND_HOTES_MEMOIRE + ' hôtes, les plus anciens sortent', () => {
    let t = retenirImitation(undefined, 'h0.example', R, T0);
    for (let i = 1; i <= PLAFOND_HOTES_MEMOIRE + 5; i++) t = retenirImitation(t, `h${i}.example`, R, T0 + i);
    expect(Object.keys(t).length).toBe(PLAFOND_HOTES_MEMOIRE);
    expect(t['h0.example']).toBeUndefined();
    expect(t[`h${PLAFOND_HOTES_MEMOIRE + 5}.example`]).toBeDefined();
  });
  it('table absente : rien, sans erreur', () => expect(lireImitationRetenue(undefined, 'x.example', T0)).toBeUndefined());
});
