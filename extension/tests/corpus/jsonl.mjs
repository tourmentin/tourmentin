// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Reprise par jsonl (12.3.1), partagée par le harnais de faux positifs, la
// campagne de mesure de latence et la construction du sous-corpus des
// connexions (12.3.3) — même garantie partout : les résultats écrits au fil
// de l'eau survivent à une interruption, le fichier fait foi, jamais l'état
// en mémoire.
import { readFileSync, existsSync, appendFileSync } from 'node:fs';

/**
 * Lit un fichier jsonl tel qu'il est sur disque, sans condition — utilisé
 * pour construire le rapport final, qui doit refléter tout ce qui a été
 * écrit pendant cette exécution (y compris après --repartir-de-zero).
 */
export function lireTousLesResultats(fichier) {
  if (!existsSync(fichier)) return new Map();
  const parCle = new Map();
  for (const ligne of readFileSync(fichier, 'utf8').split('\n')) {
    if (!ligne.trim()) continue;
    try {
      const entree = JSON.parse(ligne);
      parCle.set(entree.cle, entree); // la dernière occurrence d'une clé l'emporte
    } catch {
      // ligne corrompue (écriture interrompue en plein vol) : ignorée, la
      // relance retraitera la tâche concernée.
    }
  }
  return parCle;
}

/** Résultats à considérer pour la reprise : vide si repartirDeZero. */
export function chargerResultatsPourReprise(fichier, repartirDeZero) {
  return repartirDeZero ? new Map() : lireTousLesResultats(fichier);
}

export function ecrireResultat(fichier, entree) {
  appendFileSync(fichier, `${JSON.stringify(entree)}\n`, 'utf8');
}
