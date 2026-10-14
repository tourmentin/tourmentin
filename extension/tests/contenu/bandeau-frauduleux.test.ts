// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { mutationsInternes } from '../../src/contenu/bandeau.js';
import { TEXTE_FRAUDULEUX, afficherBandeauFrauduleux, construireContenuBandeauFrauduleux, retirerBandeauFrauduleux } from '../../src/contenu/bandeau-frauduleux.js';

function installerDocumentGlobal(): Document {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
  return dom.window.document;
}
const clic = (document: Document, el: Element) => el.dispatchEvent(new document.defaultView!.MouseEvent('click', { bubbles: true }));

describe("bandeau rouge d'un site frauduleux signalé (14.37 point 4)", () => {
  it("le texte de Ph, l'hôte réel, une alerte, deux contrôles", () => {
    const document = installerDocumentGlobal();
    const racine = document.createElement('div').attachShadow({ mode: 'open' });
    construireContenuBandeauFrauduleux(racine, 'faux.exemple.fr', vi.fn());
    expect(TEXTE_FRAUDULEUX).toBe('Site frauduleux signalé : quittez cette page');
    expect(racine.querySelector('strong')!.textContent).toBe(TEXTE_FRAUDULEUX);
    expect(racine.textContent).toContain('faux.exemple.fr');
    expect(racine.querySelector('.bandeau')!.getAttribute('role')).toBe('alert');
    expect([...racine.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Comment vérifier une adresse', 'Fermer']);
  });

  it("« Fermer » appelle la fermeture, « Comment vérifier » ouvre l'aide ; aucun bouton ne déclare ni n'atténue", () => {
    const document = installerDocumentGlobal();
    const racine = document.createElement('div').attachShadow({ mode: 'open' });
    const fermer = vi.fn();
    const aide = vi.fn();
    construireContenuBandeauFrauduleux(racine, 'x.fr', fermer, aide);
    const [b1, b2] = [...racine.querySelectorAll('button')];
    clic(document, b2!);
    clic(document, b1!);
    expect(fermer).toHaveBeenCalledTimes(1);
    expect(aide).toHaveBeenCalledTimes(1);
    expect([...racine.querySelectorAll('button')].some((b) => /officiel|légitime|ignorer/i.test(b.textContent ?? ''))).toBe(false);
  });

  it('afficher : un seul hôte dans la page, idempotent pour un même hôte, remplacé pour un autre, retiré à la fermeture', () => {
    const document = installerDocumentGlobal();
    afficherBandeauFrauduleux('faux.exemple.fr', undefined, vi.fn());
    const premier = document.getElementById('tourmentin-bandeau-frauduleux');
    expect(premier).not.toBeNull();
    afficherBandeauFrauduleux('faux.exemple.fr');
    expect(document.getElementById('tourmentin-bandeau-frauduleux')).toBe(premier);
    afficherBandeauFrauduleux('autre.exemple.fr');
    expect(document.querySelectorAll('#tourmentin-bandeau-frauduleux')).toHaveLength(1);
    expect(document.getElementById('tourmentin-bandeau-frauduleux')).not.toBe(premier);
    retirerBandeauFrauduleux();
    expect(document.getElementById('tourmentin-bandeau-frauduleux')).toBeNull();
    retirerBandeauFrauduleux();
  });

  it("ses propres insertions ne relancent pas d'analyse (hôte interne)", () => {
    const document = installerDocumentGlobal();
    const hote = document.createElement('div');
    hote.id = 'tourmentin-bandeau-frauduleux';
    const m = { addedNodes: [hote], removedNodes: [] } as unknown as MutationRecord;
    expect(mutationsInternes([m])).toBe(true);
  });
});
