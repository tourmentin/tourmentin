// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.5, 14.13 point 6 : le drapeau qui éteint N3 dans le build remis aux
// testeurs. Explicite et documenté, pas une constante oubliée.
//
// Fixé à la construction (vite.config.ts, `define`), jamais au chargement :
//   - `npm run build:chrome`   -> build d'essai, N3 par score plafonné à N2 ;
//   - `npm run build:mesure`   -> N3 actif, pour les passes de faux positifs
//     du harnais. Sans cela, C1 (faux positifs en N3) se lirait à 0 par
//     construction, l'instrument déterminant la réponse (12.3.3.18, 14.11).
// Hors build (tests unitaires, moteur seul) le symbole est absent : le
// comportement du moteur est alors celui qu'il a toujours eu, N3 actif.
//
// Ce drapeau ne plafonne que le N3 atteint par le score. Z1 (révocation) et
// E5 (secret reconnu) ne le lisent jamais : voir moteur/analyser.ts.
declare const __N3_PAR_SCORE_ACTIF__: boolean | undefined;

export const N3_PAR_SCORE_ACTIF: boolean = typeof __N3_PAR_SCORE_ACTIF__ === 'undefined' ? true : __N3_PAR_SCORE_ACTIF__;

/**
 * 14.15 point 1 : un build dont N3 est actif est un build de mesure, jamais
 * remis à un testeur. Il s'annonce — page d'options et badge « M » — pour
 * qu'on ne puisse pas le confondre avec le build d'essai. Même source que le
 * drapeau : les deux ne peuvent pas diverger.
 */
export const BUILD_DE_MESURE: boolean = N3_PAR_SCORE_ACTIF;
