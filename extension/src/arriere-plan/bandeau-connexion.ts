// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.22 B : quand afficher le bandeau de connexion, et la mémoire « déjà vu ».
// Décision prise ici (service worker), rendue par le script de contenu.
//
// Le bandeau ne s'affiche que sur une page à champ mot de passe, d'un site
// absent de la base et non signalé par le moteur : c'est exactement le statut
// « Site inconnu : prudence… » (14.20 F, statut 8) avec un champ mot de passe.
// Tout autre statut — N1, N2, N3, officiel vérifié, frauduleux, déclaré,
// exclusion, hors périmètre — le supprime : le bandeau d'alerte prime, et un
// site déjà connu n'a pas à être questionné.
import type { StatutAffiche } from './statut.js';

export type ModeAvertissement = 'une-fois' | 'chaque-visite' | 'jamais';

export const MODE_AVERTISSEMENT_PAR_DEFAUT: ModeAvertissement = 'une-fois';

export const MODES_AVERTISSEMENT: readonly ModeAvertissement[] = ['une-fois', 'chaque-visite', 'jamais'];

export function estModeAvertissement(valeur: unknown): valeur is ModeAvertissement {
  return typeof valeur === 'string' && (MODES_AVERTISSEMENT as readonly string[]).includes(valeur);
}

export function doitAfficherBandeauConnexion(statut: StatutAffiche, mode: ModeAvertissement, dejaVu: boolean): boolean {
  if (mode === 'jamais') return false;
  if (statut.code !== 'inconnu-prudence') return false;
  if (!statut.champMotDePasse || statut.pagePaiement) return false;
  if (mode === 'une-fois' && dejaVu) return false;
  return true;
}

/**
 * 14.24 A1 : compteur local des bandeaux affichés, un entier par jour (UTC), jamais un
 * hôte ni une adresse. Sert à mesurer la fréquence du bandeau pendant l'essai ; inclus dans l'export.
 */
export type CompteurBandeaux = Record<string, number>;

export function cleJour(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function incrementerCompteur(compteur: CompteurBandeaux, date: Date = new Date()): CompteurBandeaux {
  const cle = cleJour(date);
  return { ...compteur, [cle]: (compteur[cle] ?? 0) + 1 };
}

/** 14.22 B : plafond de la mémoire, les plus anciennes entrées sortent. */
export const PLAFOND_HOTES_VUS = 2000;

/**
 * Empreinte SHA-256 de l'hôte, tronquée à 16 caractères hexadécimaux : la
 * mémoire « déjà vu » sert à une comparaison, jamais à relire les sites de
 * connexion visités (14.1, 14.3 : le journal est éteint par défaut pour cette
 * raison).
 */
export async function empreinteHote(hote: string): Promise<string> {
  const octets = new TextEncoder().encode(hote.toLowerCase());
  const condense = new Uint8Array(await crypto.subtle.digest('SHA-256', octets));
  return [...condense.slice(0, 8)].map((o) => o.toString(16).padStart(2, '0')).join('');
}

export function ajouterHoteVu(existants: string[], empreinte: string, plafond: number = PLAFOND_HOTES_VUS): string[] {
  if (existants.includes(empreinte)) return existants;
  const suite = [...existants, empreinte];
  return suite.length > plafond ? suite.slice(suite.length - plafond) : suite;
}
