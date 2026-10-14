// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.19 B, 14.28 B : adresses des images de la page, pour la déclaration. Adresses seulement (jamais le
// contenu) ; le nettoyage final — http(s), sans requête ni fragment, uniques, au plus 20 — est fait
// par adressesImages (arriere-plan/rapport.ts), seul passage vers un envoi.
export function collecterAdressesImages(document: Document): string[] {
  const adresses: string[] = [];
  for (const img of Array.from(document.images)) {
    const src = img.currentSrc || img.src;
    if (src) adresses.push(src);
  }
  return adresses;
}
