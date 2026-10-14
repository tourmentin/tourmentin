// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.1.3 : les deux fenêtres d'analyse du harnais, isolées dans un
// module sans effet de bord pour qu'un test puisse les vérifier sans lancer
// Playwright. FENETRE_FP_MS est celle de la passe de faux positifs — elle
// ne change jamais, sous peine de rendre les rapports incomparables d'une
// version à l'autre (12.3.1). FENETRE_LATENCE_MS ne sert qu'à la campagne de
// mesure dédiée (--mesure-latence), qui n'écrit ni dans resultats.jsonl ni
// dans RAPPORT-FP-*.md.
export const FENETRE_FP_MS = 1_500;
export const FENETRE_LATENCE_MS = 10_000;
