// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.33 F : ce que les listes publiées et vérifiées changent dans les listes du moteur. Pur : aucun chrome.*.
import type { Listes } from '../moteur/types.js';
import type { CodeRejet, ListeVerifiee, NomListe } from './verification.js';

/** État conservé dans chrome.storage.local : des données publiques et vérifiées, aucun secret. */
export interface EtatPublication {
  officiels?: ListeVerifiee;
  frauduleux?: ListeVerifiee;
  /** Dernière vérification réussie ou « identique », par liste (date ISO). */
  verifieLe?: Partial<Record<NomListe, string>>;
  /** Dernier problème par liste (code seulement, jamais le contenu) ; effacé à la prochaine vérification réussie. */
  rejets?: Partial<Record<NomListe, CodeRejet | 'reseau'>>;
}

/**
 * Les hôtes VALIDÉS deviennent `communautaireValidee` (hôte exact, donc M6) et leur marque `communautaireMarques` ; les répertoriés
 * deviennent `hotesRepertories` (affichage seulement, aucun effet sur la détection).
 * 14.37 point 4 : les hôtes de `frauduleux` deviennent `hotesFrauduleux` (même rang que la révocation, Z1).
 */
export function listesAvecPublication(base: Listes, etat: EtatPublication): Listes {
  const officiels = etat.officiels?.entrees ?? [];
  const marques: Record<string, string> = {};
  for (const e of officiels) if (e.marque) marques[e.hote] = e.marque;
  return {
    ...base,
    // 14.47 (décision de Ph, 09/10/2026) : un répertorié ne donne PAS M6 ; seuls les validés y entrent. La détection d'un répertorié est
    // celle d'un site inconnu (le phishing est souvent hébergé sur des sites légitimes piratés : la population même de l'import).
    communautaireValidee: [...new Set([...base.communautaireValidee, ...officiels.filter((e) => e.statut !== 'repertorie').map((e) => e.hote)])],
    communautaireMarques: { ...base.communautaireMarques, ...marques },
    hotesRepertories: [...new Set([...(base.hotesRepertories ?? []), ...officiels.filter((e) => e.statut === 'repertorie').map((e) => e.hote)])],
    hotesFrauduleux: [...new Set([...(base.hotesFrauduleux ?? []), ...(etat.frauduleux?.entrees ?? []).map((e) => e.hote)])],
  };
}
