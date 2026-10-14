// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Texte visible de la page (4.4 : EntreeAnalyse.texteVisible), pas
// document.body.textContent — qui inclurait le contenu de <script>, <style>,
// et tout élément masqué. Tronqué à 20 000 caractères en gardant le DÉBUT :
// les marqueurs de marque sont en haut de page (5.3).
const LONGUEUR_MAX_TEXTE_VISIBLE = 20_000;
const BALISES_EXCLUES = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);

function estMasque(element: Element): boolean {
  if (element.hasAttribute('hidden')) return true;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return false;
  return style.display === 'none' || style.visibility === 'hidden';
}

function texteDe(noeud: Node): string {
  if (noeud.nodeType === noeud.TEXT_NODE) {
    // Node.textContent est typé `string | null` pour tout Node, mais ne peut
    // pas être null pour un Text : l'assertion documente cette garantie du
    // DOM plutôt que d'introduire une branche `?? ''` jamais empruntée.
    return noeud.textContent as string;
  }
  if (noeud.nodeType !== noeud.ELEMENT_NODE) {
    return '';
  }
  const element = noeud as Element;
  if (BALISES_EXCLUES.has(element.tagName) || estMasque(element)) {
    return '';
  }

  const morceaux: string[] = [];
  if (element.shadowRoot) {
    for (const enfant of element.shadowRoot.childNodes) morceaux.push(texteDe(enfant));
  }
  for (const enfant of element.childNodes) morceaux.push(texteDe(enfant));
  return morceaux.join(' ');
}

export function extraireTexteVisible(racine: Element | Document): string {
  const depart = 'body' in racine ? (racine.body ?? racine.documentElement) : racine;
  const brut = texteDe(depart).replace(/\s+/g, ' ').trim();
  return brut.slice(0, LONGUEUR_MAX_TEXTE_VISIBLE);
}
