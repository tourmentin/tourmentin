// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Traversée récursive du Shadow DOM (6.5). `chrome.dom.openOrClosedShadowRoot`
// révèle aussi les racines fermées et n'existe que dans une vraie extension ;
// hors de ce contexte (tests, jsdom), on retombe sur `element.shadowRoot`, qui
// ne voit que les racines ouvertes — suffisant pour les gabarits de test.
function racineDOmbre(element: Element): ShadowRoot | null {
  const api = (globalThis as typeof globalThis & { chrome?: { dom?: { openOrClosedShadowRoot?: (el: Element) => ShadowRoot | null } } }).chrome
    ?.dom?.openOrClosedShadowRoot;
  if (api) {
    try {
      return api(element);
    } catch {
      return element.shadowRoot;
    }
  }
  // 14.48 : Firefox expose les racines fermées par une propriété du nœud (contexte des scripts de contenu), pas par chrome.dom.
  return (element as Element & { openOrClosedShadowRoot?: ShadowRoot | null }).openOrClosedShadowRoot ?? element.shadowRoot;
}

/**
 * Toutes les racines (le document/fragment donné, plus chaque shadow root
 * découverte, récursivement) sous `racine`, racine comprise.
 */
export function racinesProfondes(racine: ParentNode): ParentNode[] {
  const racines: ParentNode[] = [racine];
  const elements = racine.querySelectorAll('*');
  for (const element of elements) {
    const ombre = racineDOmbre(element);
    if (ombre) {
      racines.push(...racinesProfondes(ombre));
    }
  }
  return racines;
}

/** `querySelectorAll(selecteur)` étendu à toutes les racines profondes. */
export function selectionnerProfond<E extends Element = Element>(racine: ParentNode, selecteur: string): E[] {
  const resultats: E[] = [];
  for (const r of racinesProfondes(racine)) {
    resultats.push(...Array.from(r.querySelectorAll<E>(selecteur)));
  }
  return resultats;
}
