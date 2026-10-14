// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  construireEntreeJournal,
  estEligibleAuJournalAutomatique,
  purgerJournal,
  urlPourJournal,
  RETENTION_JOURNAL_MS,
  type EntreeJournal,
} from '../../src/arriere-plan/journal.js';
import type { Verdict } from '../../src/moteur/types.js';

describe('urlPourJournal — 14.3 point 2 : jamais la requête ni le fragment', () => {
  it('positif : schéma, hôte, chemin conservés, requête détectée mais jamais transportée', () => {
    const resultat = urlPourJournal('https://faux-impots.fr/verification?identifiant=jean.dupont%40mail.fr&jeton=abc123');
    expect(resultat).toEqual({ schema: 'https', hote: 'faux-impots.fr', chemin: '/verification', requetePresente: true });
    expect(JSON.stringify(resultat)).not.toContain('jean.dupont');
    expect(JSON.stringify(resultat)).not.toContain('abc123');
  });

  it('négatif : pas de requête ni de fragment → requetePresente à false', () => {
    expect(urlPourJournal('https://impots.gouv.fr/accueil').requetePresente).toBe(false);
  });

  it('cas limite : un fragment seul compte aussi comme "requête présente"', () => {
    expect(urlPourJournal('https://exemple.fr/page#jeton-de-session').requetePresente).toBe(true);
  });
});

describe('estEligibleAuJournalAutomatique — 14.4 point 1 : N1 et au-dessus seulement', () => {
  it.each([
    ['N0', false],
    ['N1', true],
    ['N2', true],
    ['N3', true],
  ] as const)('%s → %s', (niveau, attendu) => {
    expect(estEligibleAuJournalAutomatique(niveau)).toBe(attendu);
  });
});

describe('construireEntreeJournal', () => {
  it('positif : reprend niveau, motif, marque et scores du verdict', () => {
    const verdict: Verdict = { niveau: 'N2', motif: 'imitation au-delà du seuil et exposition significative', marqueDetectee: 'urssaf', scoreImitation: 80, scoreExposition: 40 };
    const entree = construireEntreeJournal('https://faux-urssaf.fr/connexion?a=1', verdict, '2026-09-27T10:00:00.000Z');
    expect(entree).toMatchObject({ hote: 'faux-urssaf.fr', chemin: '/connexion', requetePresente: true, niveau: 'N2', marqueDetectee: 'urssaf' });
    expect(JSON.stringify(entree)).not.toContain('a=1');
  });
});

describe('purgerJournal — chapitre 10 : rétention de 30 jours', () => {
  const entreeAncienne = (joursAvant: number): EntreeJournal => ({
    horodatage: new Date(Date.parse('2026-09-27T00:00:00.000Z') - joursAvant * 24 * 60 * 60 * 1000).toISOString(),
    schema: 'https', hote: 'exemple.fr', chemin: '/', requetePresente: false, niveau: 'N1', motif: 'm',
  });

  it('positif : une entrée de 31 jours est purgée', () => {
    const maintenant = Date.parse('2026-09-27T00:00:00.000Z');
    expect(purgerJournal([entreeAncienne(31)], maintenant)).toHaveLength(0);
  });

  it('négatif : une entrée de 29 jours est conservée', () => {
    const maintenant = Date.parse('2026-09-27T00:00:00.000Z');
    expect(purgerJournal([entreeAncienne(29)], maintenant)).toHaveLength(1);
  });

  it('cas limite : exactement à la borne de rétention, l\'entrée est purgée', () => {
    const maintenant = Date.parse('2026-09-27T00:00:00.000Z');
    const entree: EntreeJournal = { horodatage: new Date(maintenant - RETENTION_JOURNAL_MS).toISOString(), schema: 'https', hote: 'exemple.fr', chemin: '/', requetePresente: false, niveau: 'N1', motif: 'm' };
    expect(purgerJournal([entree], maintenant)).toHaveLength(0);
  });
});
