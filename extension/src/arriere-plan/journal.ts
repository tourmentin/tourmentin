// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.6 point c, 14.4 point 1-2 : le journal local. Fonctions pures de mise en
// forme et de purge — le stockage lui-même (chrome.storage.local) reste dans
// service-worker.ts, seul endroit du projet qui doit toucher les API
// chrome.*. Rien ici ne dépend d'une API navigateur : testable hors extension,
// comme le moteur (règle 4 de CLAUDE.md, appliquée par analogie à ce module de
// liaison qui porte une règle de confidentialité, pas seulement une fonction
// pure).
import type { NiveauAlerte, Verdict } from '../moteur/types.js';

/** Chapitre 10 : conservation de 30 jours pour le journal automatique. */
export const RETENTION_JOURNAL_MS = 30 * 24 * 60 * 60 * 1000;

export interface EntreeJournal {
  horodatage: string; // ISO 8601
  schema: string;
  hote: string;
  chemin: string;
  /** 14.3 point 2 : la chaîne de requête et le fragment ne sont jamais écrits, ni hachés ni remplacés — seule leur présence est notée. */
  requetePresente: boolean;
  niveau: NiveauAlerte;
  motif: string;
  marqueDetectee?: string;
  scoreImitation?: number;
  scoreExposition?: number;
}

/**
 * 14.3 point 2 : réduit une URL complète à schéma + hôte + chemin. `href`
 * porte la requête et le fragment ; on les détecte sans jamais les
 * transporter au-delà de cette fonction.
 */
export function urlPourJournal(href: string): { schema: string; hote: string; chemin: string; requetePresente: boolean } {
  const url = new URL(href);
  return {
    schema: url.protocol.replace(':', ''),
    hote: url.hostname,
    chemin: url.pathname,
    requetePresente: url.search.length > 0 || url.hash.length > 0,
  };
}

/**
 * 14.4 point 1 : n'enregistre automatiquement que N1 et au-dessus. N0 n'est
 * jamais écrit par ce chemin — seule la déclaration explicite de
 * signalements.ts peut consigner une page N0.
 */
export function estEligibleAuJournalAutomatique(niveau: NiveauAlerte): boolean {
  return niveau !== 'N0';
}

export function construireEntreeJournal(href: string, verdict: Verdict, horodatage: string = new Date().toISOString()): EntreeJournal {
  return {
    horodatage,
    ...urlPourJournal(href),
    niveau: verdict.niveau,
    motif: verdict.motif,
    marqueDetectee: verdict.marqueDetectee,
    scoreImitation: verdict.scoreImitation,
    scoreExposition: verdict.scoreExposition,
  };
}

/** Chapitre 10 : purge les entrées de plus de 30 jours. Appelé à chaque écriture, faute de minuteur fiable dans un service worker éphémère (14.2.3, point 5). */
export function purgerJournal(entrees: EntreeJournal[], maintenant: number = Date.now()): EntreeJournal[] {
  return entrees.filter((e) => maintenant - new Date(e.horodatage).getTime() < RETENTION_JOURNAL_MS);
}
