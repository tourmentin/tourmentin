// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.19 B : avant tout envoi, le texte est débarrassé de ce qui ressemble à une adresse
// e-mail, un numéro de téléphone ou un IBAN — certaines pages affichent l'identité de la
// victime. Le motif est remplacé par une mention neutre, jamais par un haché. Le serveur
// refait le même nettoyage (défense en profondeur) ; les deux listes de motifs doivent rester
// alignées.
//
// Ce que ce nettoyage ne couvre PAS (14.19 B) : noms, adresses postales, numéros de carte, de
// sécurité sociale, numéro fiscal. La liste de trois motifs n'est pas une garantie d'anonymat.

const MOTIFS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, '[adresse e-mail retirée]'],
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/gu, '[IBAN retiré]'],
  [/(?<!\d)(?:\+33|0033|0)[\s.-]?[1-9](?:[\s.-]?\d{2}){4}(?!\d)/gu, '[numéro de téléphone retiré]'],
  [/(?<!\d)\+\d{1,3}(?:[\s.-]?\d{2,4}){3,5}(?!\d)/gu, '[numéro de téléphone retiré]'],
];

export function nettoyerTexte(texte: string): string {
  let sortie = texte;
  for (const [motif, remplacement] of MOTIFS) sortie = sortie.replace(motif, remplacement);
  return sortie;
}
