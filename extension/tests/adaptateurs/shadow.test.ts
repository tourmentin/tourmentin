// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { racinesProfondes, selectionnerProfond } from '../../src/adaptateurs/shadow.js';

function docAvecHote(): { document: Document; hote: HTMLElement } {
  const document = new JSDOM('<div id="hote"></div>').window.document;
  const hote = document.getElementById('hote') as HTMLElement;
  return { document, hote };
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('racinesProfondes / selectionnerProfond — sans API chrome (repli sur element.shadowRoot)', () => {
  it('positif : une shadow root ouverte est descendue', () => {
    const { document, hote } = docAvecHote();
    const racine = hote.attachShadow({ mode: 'open' });
    racine.innerHTML = '<input type="password">';
    expect(selectionnerProfond(document, 'input')).toHaveLength(1);
  });

  it('négatif : aucune shadow root, une seule racine (le document lui-même)', () => {
    const { document } = docAvecHote();
    expect(racinesProfondes(document)).toEqual([document]);
  });

  it('cas limite : shadow roots imbriquées, récursion sur plusieurs niveaux', () => {
    const { document, hote } = docAvecHote();
    const niveau1 = hote.attachShadow({ mode: 'open' });
    niveau1.innerHTML = '<div id="hote2"></div>';
    const niveau2 = niveau1.getElementById('hote2')!.attachShadow({ mode: 'open' });
    niveau2.innerHTML = '<input type="text">';
    expect(selectionnerProfond(document, 'input')).toHaveLength(1);
  });
});

describe('racinesProfondes — Firefox : element.openOrClosedShadowRoot (14.48)', () => {
  it('positif : une racine FERMÉE est descendue grâce à la propriété du nœud, sans chrome.dom', () => {
    const { document, hote } = docAvecHote();
    const racine = hote.attachShadow({ mode: 'closed' });
    racine.innerHTML = '<input type="password">';
    expect(hote.shadowRoot).toBeNull(); // sans la propriété de Firefox, la racine fermée resterait invisible
    expect(selectionnerProfond(document, 'input')).toHaveLength(0);
    Object.defineProperty(hote, 'openOrClosedShadowRoot', { value: racine });
    expect(selectionnerProfond(document, 'input')).toHaveLength(1);
  });
});

describe('racinesProfondes — avec chrome.dom.openOrClosedShadowRoot', () => {
  it('positif : l\'API chrome est préférée à element.shadowRoot', () => {
    const { document, hote } = docAvecHote();
    const racineReelle = hote.attachShadow({ mode: 'open' });
    racineReelle.innerHTML = '<input type="text">';
    let appelee = false;
    (globalThis as { chrome?: unknown }).chrome = {
      dom: {
        openOrClosedShadowRoot: (el: Element) => {
          appelee = true;
          return (el as unknown as { shadowRoot: ShadowRoot | null }).shadowRoot;
        },
      },
    };
    expect(selectionnerProfond(document, 'input')).toHaveLength(1);
    expect(appelee).toBe(true);
  });

  it('cas limite : l\'API chrome lève → repli sur element.shadowRoot sans planter', () => {
    const { document, hote } = docAvecHote();
    const racine = hote.attachShadow({ mode: 'open' });
    racine.innerHTML = '<input type="text">';
    (globalThis as { chrome?: unknown }).chrome = {
      dom: {
        openOrClosedShadowRoot: () => {
          throw new Error('API indisponible dans ce contexte');
        },
      },
    };
    expect(selectionnerProfond(document, 'input')).toHaveLength(1);
  });

  it('négatif : l\'API chrome renvoie null (pas de shadow root, ouverte ou fermée)', () => {
    const { document } = docAvecHote();
    (globalThis as { chrome?: unknown }).chrome = { dom: { openOrClosedShadowRoot: () => null } };
    expect(racinesProfondes(document)).toEqual([document]);
  });
});
