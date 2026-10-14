// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { construireListes } from '../../src/listes/chargement.js';
import { listesAvecPublication } from '../../src/listes/publication.js';

const liste = (entrees: { hote: string; marque?: string; statut?: 'repertorie' }[]) => ({ liste: 'officiels' as const, version: '2026.10.001', genereLe: '2026-10-06T00:00:00.000Z', entrees });

describe('listesAvecPublication (14.33 F)', () => {
  it('sans publication, les listes du moteur sont inchangées', () => {
    const base = construireListes();
    const l = listesAvecPublication(base, {});
    expect(l.communautaireValidee).toEqual([]);
    expect(l.communautaireMarques).toEqual({});
    expect(l.socle).toBe(base.socle);
  });

  it('les hôtes officiels deviennent communautaireValidee, avec leur marque quand elle existe', () => {
    const l = listesAvecPublication(construireListes(), { officiels: liste([{ hote: 'www.exemple.fr', marque: 'ameli' }, { hote: 'sans-marque.fr' }]) });
    expect(l.communautaireValidee).toEqual(['www.exemple.fr', 'sans-marque.fr']);
    expect(l.communautaireMarques).toEqual({ 'www.exemple.fr': 'ameli' });
  });

  it('les hôtes frauduleux deviennent hotesFrauduleux (14.37 point 4) et ne touchent ni la révocation ni les hôtes validés', () => {
    const base = construireListes();
    const l = listesAvecPublication(base, { frauduleux: { ...liste([{ hote: 'faux.example.net' }]), liste: 'frauduleux' } });
    expect(l.hotesFrauduleux).toEqual(['faux.example.net']);
    expect(l.revocation).toEqual(base.revocation);
    expect(l.communautaireValidee).toEqual([]);
  });

  it('sans publication, hotesFrauduleux est vide ; ce que la base portait est conservé sans doublon', () => {
    expect(listesAvecPublication(construireListes(), {}).hotesFrauduleux).toEqual([]);
    const base = { ...construireListes(), hotesFrauduleux: ['a.fr'] };
    expect(listesAvecPublication(base, { frauduleux: { ...liste([{ hote: 'a.fr' }, { hote: 'b.fr' }]), liste: 'frauduleux' } }).hotesFrauduleux).toEqual(['a.fr', 'b.fr']);
  });

  it('14.47 : les répertoriés ne reçoivent PAS M6 (absents de communautaireValidee), ils sont listés à part (hotesRepertories) ; les validés oui', () => {
    const l = listesAvecPublication(construireListes(), { officiels: liste([{ hote: 'www.exemple.fr', marque: 'ameli' }, { hote: 'mairie.example.fr', statut: 'repertorie' }]) });
    expect(l.communautaireValidee).toEqual(['www.exemple.fr']);
    expect(l.communautaireMarques).toEqual({ 'www.exemple.fr': 'ameli' });
    expect(l.hotesRepertories).toEqual(['mairie.example.fr']);
    expect(listesAvecPublication(construireListes(), {}).hotesRepertories).toEqual([]);
    const base = { ...construireListes(), hotesRepertories: ['a.fr'] };
    expect(listesAvecPublication(base, { officiels: liste([{ hote: 'a.fr', statut: 'repertorie' }, { hote: 'b.fr', statut: 'repertorie' }]) }).hotesRepertories).toEqual(['a.fr', 'b.fr']);
  });

  it('conserve ce que la base portait déjà, sans doublon', () => {
    const base = { ...construireListes(), communautaireValidee: ['a.fr'], communautaireMarques: { 'a.fr': 'caf' } };
    const l = listesAvecPublication(base, { officiels: liste([{ hote: 'a.fr', marque: 'caf' }, { hote: 'b.fr' }]) });
    expect(l.communautaireValidee).toEqual(['a.fr', 'b.fr']);
    expect(l.communautaireMarques).toEqual({ 'a.fr': 'caf' });
  });
});
