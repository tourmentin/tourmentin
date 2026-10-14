// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.17 : une fermeture porte sur le VERDICT qui était affiché, pas sur la page.
// Fonctions pures : aucune API navigateur, testables seules.
//
// « Fermer ce message » ne doit pas réduire au silence ce qui vient ensuite
// (même famille que 14.8 : une action de l'usager ne l'aveugle pas sur la
// suite). Règle :
//   - verdict identique ou moins grave que celui fermé : reste fermé ;
//   - verdict plus grave — niveau supérieur, signal d'exposition absent à la
//     fermeture (un moyen de paiement, E8, en premier lieu), ou autre marque :
//     le bandeau revient ;
//   - la navigation remet tout à zéro (le script de contenu, lui, repart à neuf).
import type { NiveauAlerte, Verdict } from '../moteur/types.js';

const RANG: Record<NiveauAlerte, number> = { N0: 0, N1: 1, N2: 2, N3: 3 };

/** Ce qui était affiché au moment où l'usager a fermé le message. */
export interface VerdictFerme {
  niveau: NiveauAlerte;
  marque: string | undefined;
  /** Codes des signaux d'exposition déclenchés à ce moment (E1, E8...). */
  signauxExposition: string[];
}

export function memoriserFermeture(verdict: Verdict): VerdictFerme {
  return {
    niveau: verdict.niveau,
    marque: verdict.marqueDetectee,
    signauxExposition: (verdict.signauxExposition ?? []).map((s) => s.code),
  };
}

/**
 * Vrai si le verdict courant est identique ou moins grave que celui fermé :
 * le message reste fermé. Faux dès qu'il est plus grave (ou d'une autre marque) :
 * le bandeau doit réapparaître.
 */
export function fermetureResteValable(ferme: VerdictFerme, courant: Verdict): boolean {
  if (RANG[courant.niveau] > RANG[ferme.niveau]) return false;
  if (courant.marqueDetectee !== ferme.marque) return false;
  const dejaVus = new Set(ferme.signauxExposition);
  return (courant.signauxExposition ?? []).every((s) => dejaVus.has(s.code));
}
