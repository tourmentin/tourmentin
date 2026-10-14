// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Fusion des rapports de chaque frame d'un même onglet (6.5). Chaque frame
// s'analyse seule — un content script ne peut pas lire le DOM d'un iframe
// cross-origin — et remonte son EntreeAnalyse au service worker, qui recompose
// ici la vue d'ensemble avant d'appeler analyser(). Fonction pure : aucune API
// chrome.*, testable sans mock.
import type { EntreeAnalyse, FormulaireNormalise } from '../moteur/types.js';

export interface RapportFrame {
  frameId: number;
  entree: EntreeAnalyse;
}

/**
 * `null` si la frame principale (frameId 0) n'a pas encore rapporté : rien à
 * analyser tant qu'on n'a pas au moins l'URL et le texte de la page elle-même.
 */
export function fusionnerFrames(rapports: RapportFrame[]): EntreeAnalyse | null {
  const principal = rapports.find((r) => r.frameId === 0);
  if (!principal) return null;

  const domainePrincipal = principal.entree.url?.domaineEnregistrable;

  const formulairesEnfants: FormulaireNormalise[] = [];
  for (const rapport of rapports) {
    if (rapport.frameId === 0) continue;
    const domaineFrame = rapport.entree.url?.domaineEnregistrable;
    const crossOrigin = domaineFrame !== undefined && domaineFrame !== domainePrincipal;
    for (const formulaire of rapport.entree.formulaires) {
      formulairesEnfants.push({ ...formulaire, dansIframeCrossOrigin: crossOrigin, domaineFrame });
    }
  }

  if (formulairesEnfants.length === 0) return principal.entree;

  return {
    ...principal.entree,
    formulaires: [...principal.entree.formulaires, ...formulairesEnfants],
  };
}
