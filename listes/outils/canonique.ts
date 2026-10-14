// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Sérialisation canonique du contenu signé : toujours les trois mêmes champs,
// dans le même ordre, que ce soit pour signer ou pour vérifier. Évite qu'une
// différence de sérialisation (ordre des clés, espaces) fasse échouer une
// vérification sur une liste pourtant authentique.
export interface ListeSocle {
  version: string;
  genere_le: string;
  entrees: unknown[];
}

export function donneesSignables(liste: ListeSocle): Uint8Array {
  const canonique = JSON.stringify({ version: liste.version, genere_le: liste.genere_le, entrees: liste.entrees });
  return new TextEncoder().encode(canonique);
}
