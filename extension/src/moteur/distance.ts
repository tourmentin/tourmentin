// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Distance d'édition pour I4 (5.3). Fonctions pures, aucune dépendance.

/**
 * Distance de Damerau-Levenshtein, variante "optimal string alignment" (chaque
 * sous-chaîne n'est modifiée qu'une fois ; les transpositions ne se combinent
 * pas avec une autre opération sur les mêmes caractères). Suffisant pour des
 * chaînes de la longueur d'un nom de domaine, et c'est la variante employée par
 * les outils de détection de typosquat usuels (ex. dnstwist).
 */
export function distanceDamerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      let valeur = Math.min(
        d[i - 1]![j]! + 1, // suppression
        d[i]![j - 1]! + 1, // insertion
        d[i - 1]![j - 1]! + cout, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        valeur = Math.min(valeur, d[i - 2]![j - 2]! + 1); // transposition adjacente
      }
      d[i]![j] = valeur;
    }
  }

  return d[m]![n]!;
}

/**
 * Retire le dernier label (le "TLD" au sens naïf, pas le suffixe PSL) d'un
 * domaine enregistrable. Requis par I4 : comparer "impots.gouv" à "impots.gouv"
 * rapproche impots.gouv.fr et impots.gouv.com, alors qu'une comparaison sur le
 * domaine enregistrable complet (PSL) ne les rapprocherait jamais puisque
 * gouv.fr et com n'ont pas la même arité de suffixe.
 */
export function sansDernierLabel(domaine: string): string {
  const derniereBorne = domaine.lastIndexOf('.');
  return derniereBorne === -1 ? domaine : domaine.slice(0, derniereBorne);
}
