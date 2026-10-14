// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.57 : mémoire d'imitation par hôte exact, 15 minutes, en session. Fonctions pures sur la table ; le service worker la lit et l'écrit dans
// chrome.storage.session (effacé à la fermeture du navigateur, non lisible par les scripts de contenu), jamais dans un cookie, rien ne sort.
import { DUREE_MEMOIRE_IMITATION_MS } from '../moteur/constantes.js';
import type { ImitationRetenue } from '../moteur/types.js';

export const CLE_MEMOIRE_IMITATION = 'memoireImitation';
/** Plafond du nombre d'hôtes retenus : les plus anciens sortent. */
export const PLAFOND_HOTES_MEMOIRE = 100;

export interface EntreeMemoireImitation extends ImitationRetenue {
  /** Date de l'analyse qui a retenu cette imitation, en millisecondes. */
  retenueLe: number;
}
export type TableMemoireImitation = Record<string, EntreeMemoireImitation>;

const estValide = (e: EntreeMemoireImitation, maintenant: number): boolean => maintenant - e.retenueLe >= 0 && maintenant - e.retenueLe < DUREE_MEMOIRE_IMITATION_MS;

/** L'imitation retenue pour CET hôte (clé exacte), si elle a moins de 15 minutes. */
export function lireImitationRetenue(table: TableMemoireImitation | undefined, hote: string, maintenant: number): ImitationRetenue | undefined {
  const e = table?.[hote];
  if (!e || !estValide(e, maintenant)) return undefined;
  return { marque: e.marque, scoreImitation: e.scoreImitation, familles: e.familles };
}

/** Table mise à jour : l'entrée de l'hôte remplacée, les entrées périmées retirées, au plus PLAFOND_HOTES_MEMOIRE hôtes (les plus anciens sortent). */
export function retenirImitation(table: TableMemoireImitation | undefined, hote: string, retenue: ImitationRetenue, maintenant: number): TableMemoireImitation {
  const vivantes = Object.entries(table ?? {}).filter(([h, e]) => h !== hote && estValide(e, maintenant));
  vivantes.sort((a, b) => a[1].retenueLe - b[1].retenueLe);
  const gardees = vivantes.slice(Math.max(0, vivantes.length - (PLAFOND_HOTES_MEMOIRE - 1)));
  return { ...Object.fromEntries(gardees), [hote]: { ...retenue, retenueLe: maintenant } };
}
