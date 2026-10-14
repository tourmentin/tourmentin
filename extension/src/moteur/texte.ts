// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Normalisation de texte pour les comparaisons insensibles a la casse et aux
// accents (I1, I2, I3, E2, E3). Fonctions pures, aucune dependance.

// Plage Unicode des diacritiques combinants (0x0300-0x036F) apres decomposition
// NFD, construite par code point pour eviter tout caractere combinant litteral
// dans le fichier source.
const DEBUT_DIACRITIQUES = 0x0300;
const FIN_DIACRITIQUES = 0x036f;
const PLAGE_DIACRITIQUES = new RegExp(
  '[' + String.fromCodePoint(DEBUT_DIACRITIQUES) + '-' + String.fromCodePoint(FIN_DIACRITIQUES) + ']',
  'g',
);

/** Minuscules, accents supprimes, espaces multiples reduits. */
export function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(PLAGE_DIACRITIQUES, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function contientTerme(texteNormalise: string, terme: string): boolean {
  return texteNormalise.includes(normaliser(terme));
}

export function compterTermesPresents(texteNormalise: string, termes: string[]): number {
  return termes.reduce((total, terme) => total + (contientTerme(texteNormalise, terme) ? 1 : 0), 0);
}
