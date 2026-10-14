// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Mélange de Fisher-Yates avec un générateur pseudo-aléatoire à graine fixe :
// reproductible d'une exécution à l'autre — ce qu'il faut pour comparer deux
// mesures (12.3.1) et pour qu'un sous-corpus tiré au hasard (12.3.3.2) soit
// refaisable à l'identique.
export function tirerAuHasard(liste, n, graine = 1) {
  let etat = graine;
  function suivant() {
    etat = (etat * 1103515245 + 12345) & 0x7fffffff;
    return etat / 0x7fffffff;
  }
  const copie = [...liste];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(suivant() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie.slice(0, n);
}
