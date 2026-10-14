// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Constantes de pondération et de seuil, chapitre 5 de la spec.
// Toutes les valeurs numériques sont des [H], hypothèses de départ destinées à
// être remplacées au lot L6 par des valeurs mesurées sur le corpus, sans toucher
// à la logique des chapitres seuils.ts / signaux-*.ts / analyser.ts.

export const POIDS_IMITATION = {
  I1: 30,
  I2: 15,
  I3: 25,
  I4: 25,
  I5: 20,
  I6: 8,
  I7: 20,
  I8: 25,
} as const;

export const POIDS_EXPOSITION = {
  E1: 35,
  E2: 30,
  E3: 30,
  E4: 25,
  E5: 100,
  E6: 20,
  E7: 15,
  E8: 35,
} as const;

/** Effet sur le seuil, en points. Positif = seuil relevé = alerte moins facile. */
export const MODIFICATEURS_SEUIL = {
  M1: -5,
  M2: -15,
  M3: -10,
  M4: -5,
  M5: -5,
  M6: 20,
} as const;

export const SEUIL_BASE = 70;
export const SEUIL_MIN = 55;
export const SEUIL_MAX = 85;

/** Chapitre 10 : Prudent baisse le seuil (alerte plus facile), Strict le relève. */
export const AJUSTEMENT_SENSIBILITE: Record<'prudent' | 'equilibre' | 'strict', number> = {
  prudent: -10,
  equilibre: 0,
  strict: 10,
};

export const SEUIL_E_POUR_N3 = 55;
export const SEUIL_E_POUR_N2 = 35;
export const SEUIL_I_POUR_N1 = 45;
export const SEUIL_E_POUR_N1 = 35;
export const NB_FAMILLES_MIN_POUR_N3 = 2;

export const NB_TERMES_FAIBLES_MIN_I2 = 3;
export const DISTANCE_MAX_I4 = 2;
export const NB_COULEURS_MIN_I6 = 2;
export const LONGUEUR_MIN_SAISIE_E4 = 6;

/**
 * Plafond visuel du 5.3 : I5 + I6 ne doivent jamais, à eux seuls, pouvoir
 * atteindre un seuil d'alerte (minimum SEUIL_MIN = 55). C'est une conséquence
 * du choix des deux poids ci-dessus, vérifiée par un test de régression plutôt
 * que recalculée ici.
 */
export const PLAFOND_VISUEL_I5_I6 = 28;

/** 14.57 : durée de vie de l'imitation retenue d'une page, par hôte exact (appliquée par le service worker, pas par le moteur). */
export const DUREE_MEMOIRE_IMITATION_MS = 15 * 60 * 1000;
