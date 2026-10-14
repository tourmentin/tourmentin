// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extraireTexteVisible } from '../../src/adaptateurs/texte-visible.js';

describe('extraireTexteVisible', () => {
  it('positif : accepte un Element directement, pas seulement un Document', () => {
    const doc = new JSDOM('<div id="cible"><p>Espace Particulier</p></div>').window.document;
    expect(extraireTexteVisible(doc.getElementById('cible')!)).toBe('Espace Particulier');
  });

  it('négatif : commentaires HTML ignorés', () => {
    const doc = new JSDOM('<body><!-- commentaire --><p>visible</p></body>').window.document;
    expect(extraireTexteVisible(doc)).toBe('visible');
  });

  it('cas limite : document sans defaultView (createHTMLDocument) → rien n\'est masqué par erreur', () => {
    const doc = new JSDOM('').window.document.implementation.createHTMLDocument('sans fenêtre');
    doc.body.innerHTML = '<p style="display:none">quand même compté</p>';
    expect(doc.defaultView).toBeNull();
    expect(extraireTexteVisible(doc)).toBe('quand même compté');
  });

  it('cas limite : document sans <body> (retiré) → repli sur documentElement', () => {
    const doc = new JSDOM('<html><body><p>x</p></body></html>').window.document;
    doc.body.remove();
    expect(doc.body).toBeNull();
    expect(extraireTexteVisible(doc)).toBe('');
  });

  it('espaces multiples et retours à la ligne réduits à un seul espace', () => {
    const doc = new JSDOM('<p>Espace   \n\n  Particulier</p>').window.document;
    expect(extraireTexteVisible(doc)).toBe('Espace Particulier');
  });
});
