// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Modificateurs d'infrastructure (5.5) et calcul du seuil d'alerte.
import { AJUSTEMENT_SENSIBILITE, MODIFICATEURS_SEUIL, SEUIL_BASE, SEUIL_MAX, SEUIL_MIN } from './constantes.js';
import type { Config, EntreeAnalyse, Listes, SignalDeclenche } from './types.js';

const QUATRE_NIVEAUX_MIN = 4;
const JOURS_NOUVEAU_DOMAINE = 90;
const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

export function evaluerM1(entree: EntreeAnalyse, listes: Listes): SignalDeclenche | null {
  const domaine = entree.url?.domaineEnregistrable;
  if (!domaine) return null;
  if (listes.domainesDejaVus.includes(domaine)) return null;
  return { code: 'M1', poids: MODIFICATEURS_SEUIL.M1, famille: 'modificateur', detail: 'domaine jamais vu par cette installation' };
}

/**
 * Nécessite une date de création de domaine issue d'une requête RDAP, absente
 * en mode local (MVP). `entree.url.dateCreationDomaine` n'est renseigné par
 * aucun adaptateur du MVP : M2 reste donc inactif par construction, sans
 * drapeau de configuration séparé (5.5 : reporté en V1, en option explicite).
 */
export function evaluerM2(entree: EntreeAnalyse): SignalDeclenche | null {
  const dateCreation = entree.url?.dateCreationDomaine;
  if (dateCreation === undefined) return null;
  const ageEnJours = (entree.horodatage - dateCreation) / MS_PAR_JOUR;
  if (ageEnJours >= JOURS_NOUVEAU_DOMAINE) return null;
  return { code: 'M2', poids: MODIFICATEURS_SEUIL.M2, famille: 'modificateur', detail: `domaine créé il y a ${Math.round(ageEnJours)} jours` };
}

export function evaluerM3(entree: EntreeAnalyse): SignalDeclenche | null {
  if (!entree.url?.estAdresseIp) return null;
  return { code: 'M3', poids: MODIFICATEURS_SEUIL.M3, famille: 'modificateur', detail: 'hôte est une adresse IP littérale' };
}

export function evaluerM4(entree: EntreeAnalyse): SignalDeclenche | null {
  const nb = entree.url?.sousDomaines.length ?? 0;
  if (nb < QUATRE_NIVEAUX_MIN) return null;
  return { code: 'M4', poids: MODIFICATEURS_SEUIL.M4, famille: 'modificateur', detail: `${nb} niveaux de sous-domaines` };
}

export function evaluerM5(entree: EntreeAnalyse, listes: Listes): SignalDeclenche | null {
  const suffixe = entree.url?.suffixePublic;
  if (!suffixe) return null;
  if (!listes.tldAbusifs.includes(suffixe)) return null;
  return { code: 'M5', poids: MODIFICATEURS_SEUIL.M5, famille: 'modificateur', detail: `TLD "${suffixe}" à fort taux d'abus` };
}

export function evaluerM6(entree: EntreeAnalyse, listes: Listes): SignalDeclenche | null {
  // 14.33 F : hôte exact, jamais le domaine enregistrable (un hôte validé sous un hébergement partagé ne valide pas l'hébergement).
  const hote = entree.url?.hote;
  if (!hote) return null;
  if (!listes.communautaireValidee.includes(hote)) return null;
  return { code: 'M6', poids: MODIFICATEURS_SEUIL.M6, famille: 'modificateur', detail: 'domaine validé par la couche communautaire' };
}

export interface ResultatModificateurs {
  total: number;
  signaux: SignalDeclenche[];
  /** M6 interdit N3 quel que soit le calcul de seuil (5.5 : « jamais N3 »). */
  m6Actif: boolean;
}

export function evaluerModificateurs(entree: EntreeAnalyse, listes: Listes): ResultatModificateurs {
  const signaux = [
    evaluerM1(entree, listes),
    evaluerM2(entree),
    evaluerM3(entree),
    evaluerM4(entree),
    evaluerM5(entree, listes),
    evaluerM6(entree, listes),
  ].filter((s): s is SignalDeclenche => s !== null);

  return {
    total: signaux.reduce((somme, s) => somme + s.poids, 0),
    signaux,
    m6Actif: signaux.some((s) => s.code === 'M6'),
  };
}

/** Seuil = 70 + modificateurs + ajustement de sensibilité, borné à [55, 85]. */
export function calculerSeuil(totalModificateurs: number, sensibilite: Config['sensibilite']): number {
  const brut = SEUIL_BASE + totalModificateurs + AJUSTEMENT_SENSIBILITE[sensibilite];
  return Math.min(SEUIL_MAX, Math.max(SEUIL_MIN, brut));
}
