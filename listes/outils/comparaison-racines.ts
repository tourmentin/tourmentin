// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.2 : le contrôle de collision des racines typographiques (12.6)
// comparait une racine à un hôte par simple sous-chaîne libre
// (`hote.includes(racine)`), ce qui produit des faux positifs qui ne
// respectent aucune frontière de mot — "ants" dans "enfants", "caf" dans
// "cafétéria", "dila" dans "jardiland". Ce fichier ne change rien au moteur
// (signaux-imitation.ts garde sa propre logique, éprouvée séparément) : il
// ne sert qu'au contrôle du 12.6, exécuté par verifier-racines-typo.ts et
// par harnais.mjs.
//
// Règle : on découpe l'hôte sur les points et les tirets en étiquettes, et
// une racine ne compte comme collision que si elle est identique à une
// étiquette entière, ou — seulement si elle fait au moins six caractères —
// si elle apparaît comme sous-chaîne à l'intérieur d'une étiquette. Une
// racine composée (avec son propre tiret, par exemple "assurance-maladie")
// ne peut donc plus jamais correspondre à une étiquette unique : c'est une
// conséquence acceptée, pas un défaut à corriger ici, une racine composée
// est déjà trop spécifique pour risquer une collision.
export const LONGUEUR_MIN_CORRESPONDANCE_PARTIELLE = 6;

export function racineCorrespondAuHote(racine: string, hote: string): boolean {
  const racineNormalisee = racine.toLowerCase();
  const etiquettes = hote.toLowerCase().split(/[.-]/);
  return etiquettes.some(
    (etiquette) =>
      etiquette === racineNormalisee ||
      (racineNormalisee.length >= LONGUEUR_MIN_CORRESPONDANCE_PARTIELLE && etiquette.includes(racineNormalisee)),
  );
}
