// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.7, 14.4 point 3 : la déclaration « Cette page est frauduleuse » (ex-
// « signaler un manque »). Liste distincte du journal, indépendante de son
// interrupteur, sans expiration automatique (14.4 point 3, décidé le
// 27/09/2026). Mêmes garanties de forme d'URL que le journal (14.3 point 2) :
// on réutilise urlPourJournal, pas une seconde fonction qui pourrait diverger.
import type { NiveauAlerte, Verdict } from '../moteur/types.js';
import { urlPourJournal } from './journal.js';

/**
 * 14.20 G : deux sortes de déclaration dans la même file locale. Absent = « frauduleuse » : les entrées écrites avant 14.20 n'ont pas le champ.
 */
export type TypeDeclaration = 'frauduleuse' | 'officiel';

export interface EntreeSignalement {
  horodatage: string;
  type?: TypeDeclaration;
  /** 14.26 étape 3 : résultat de l'envoi à tourmentin.fr. Absent = jamais envoyé (réglage, ou choix « enregistrer seulement »). */
  envoi?: 'ok' | 'echec';
  schema: string;
  hote: string;
  chemin: string;
  requetePresente: boolean;
  niveau: NiveauAlerte;
  motif: string;
  marqueDetectee?: string;
  scoreImitation?: number;
  scoreExposition?: number;
}

export function typeDeclaration(entree: EntreeSignalement): TypeDeclaration {
  return entree.type ?? 'frauduleuse';
}

export function construireEntreeSignalement(
  href: string,
  verdict: Verdict,
  horodatage: string = new Date().toISOString(),
  type: TypeDeclaration = 'frauduleuse',
): EntreeSignalement {
  return {
    horodatage,
    type,
    ...urlPourJournal(href),
    niveau: verdict.niveau,
    motif: verdict.motif,
    marqueDetectee: verdict.marqueDetectee,
    scoreImitation: verdict.scoreImitation,
    scoreExposition: verdict.scoreExposition,
  };
}

/**
 * 14.7, point 3 : ce que la confirmation montre à l'usager avant qu'il
 * n'accepte d'écrire l'entrée — exactement les champs qui seront écrits,
 * rien de plus, pour que l'accord porte sur le contenu réel.
 */
export function apercuSignalement(entree: EntreeSignalement, envoi?: string): string {
  const lieu = `${entree.schema}://${entree.hote}${entree.chemin}${entree.requetePresente ? ' (adresse plus longue, non conservée)' : ''}`;
  return [
    typeDeclaration(entree) === 'officiel' ? 'Vous déclarez : ce site est un site officiel.' : 'Vous déclarez : cette page est frauduleuse.',
    `Adresse : ${lieu}`,
    `Verdict de Tourmentin : ${entree.niveau} — ${entree.motif}`,
    entree.marqueDetectee ? `Marque évoquée : ${entree.marqueDetectee}` : 'Aucune marque détectée',
    ...(envoi ? ['', envoi] : []),
  ].join('\n');
}
