// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Fonction pure d'analyse, chapitre 4.4 et arbre de décision du 5.6.
import { NB_FAMILLES_MIN_POUR_N3, SEUIL_E_POUR_N1, SEUIL_E_POUR_N2, SEUIL_E_POUR_N3, SEUIL_I_POUR_N1 } from './constantes.js';
import { appartientAuxDomaines } from './domaine.js';
import { calculerSeuil, evaluerModificateurs } from './seuils.js';
import { evaluerAxeImitation, evaluerI1, evaluerI2 } from './signaux-imitation.js';
import { evaluerAxeExposition } from './signaux-exposition.js';
import { estAdresseReseauLocal } from './reseau-local.js';
import type { Config, EntreeAnalyse, ImitationRetenue, Listes, SignalDeclenche, UrlAnalysee, Verdict } from './types.js';

// 14.67 : les fichiers ouverts depuis le disque (file://, pièces jointes HTML piégées) restent analysés.
const SCHEMAS_ANALYSABLES = new Set(['https', 'http', 'file']);
const HOTES_LOCAUX_SUFFIXES = ['.local', '.localhost', '.test', '.invalid', '.example'];
const HOTES_LOCAUX_EXACTS = new Set(['localhost']);

function estDomaineLocal(hote: string): boolean {
  return HOTES_LOCAUX_EXACTS.has(hote) || HOTES_LOCAUX_SUFFIXES.some((suffixe) => hote.endsWith(suffixe));
}

/**
 * Z4 : page interne (schéma ni http, ni https, ni file), hôte local ou adresse du réseau local (14.67). Exportée pour que
 * l'affichage (14.20 F, statut 1) lise la même règle que le moteur au lieu de la
 * recopier : aucune conséquence sur le calcul.
 */
export function estHorsPerimetre(url: Pick<UrlAnalysee, 'schema' | 'hote'>): boolean {
  return !SCHEMAS_ANALYSABLES.has(url.schema) || estDomaineLocal(url.hote) || estReseauLocal(url);
}

/** 14.67 : page web (http ou https) d'une adresse du réseau local : routeur, imprimante, intranet. Donne le statut « Adresse de votre réseau local ». */
export function estReseauLocal(url: Pick<UrlAnalysee, 'schema' | 'hote'>): boolean {
  return (url.schema === 'http' || url.schema === 'https') && estAdresseReseauLocal(url.hote);
}

/**
 * Z2 : le domaine appartient authentiquement à une marque du socle, et les
 * marqueurs détectés sur la page correspondent à cette même marque (I1 ou I2).
 * N'évalue que la marque tenue par le domaine, pas les huit signaux ni les
 * autres marques : c'est un court-circuit bon marché, pas une analyse complète.
 * Passe après Z1 (révocation) depuis la v1.3 : un domaine du socle est légitime
 * jusqu'à preuve du contraire, et la révocation est cette preuve.
 */
function evaluerZ2(entree: EntreeAnalyse, listes: Listes, config?: Config): Verdict | null {
  const domaine = entree.url?.domaineEnregistrable;
  if (!domaine) return null;

  const marque = listes.socle.find((m) => appartientAuxDomaines(domaine, m.domaines));
  if (!marque) return null;

  const i1 = evaluerI1(entree, marque, config);
  const i2 = evaluerI2(entree, marque);
  if (!i1 && !i2) return null;

  const signauxImitation = [i1, i2].filter((s): s is SignalDeclenche => s !== null);
  return {
    niveau: 'N0',
    motif: 'domaine authentique de la marque détectée',
    marqueDetectee: marque.id,
    scoreImitation: signauxImitation.reduce((total, s) => total + s.poids, 0),
    signauxImitation,
  };
}

function pageAAuMoinsUnChamp(entree: EntreeAnalyse): boolean {
  return entree.formulaires.some((f) => f.champs.length > 0);
}

/**
 * 14.57 : `contexte.imitationRetenue` est l'imitation d'une page précédente du MÊME hôte, lue par l'appelant dans une mémoire de session
 * de 15 minutes (le moteur ne connaît ni le temps ni le stockage). Elle n'est utilisée que si la page présente un mot de passe (E1) ou un paiement (E8) :
 * le score d'imitation devient alors max(page, retenu). Aucun seuil ni modificateur n'est modifié.
 */
export interface ContexteAnalyse {
  imitationRetenue?: ImitationRetenue;
}

export function analyser(entree: EntreeAnalyse, listes: Listes, config: Config, contexte: ContexteAnalyse = {}): Verdict {
  // Z1 : révocation, avant le socle depuis la v1.3 — sinon un domaine officiel
  // compromis (sous-domaine oublié et détourné) serait éteint en N0 par Z2
  // avant que la révocation ne puisse s'appliquer.
  // 14.37 point 4 : les hôtes confirmés frauduleux (liste signée) ont le même rang, par hôte exact.
  const hotesFrauduleux = listes.hotesFrauduleux ?? [];
  if (entree.url && (listes.revocation.includes(entree.url.domaineEnregistrable) || hotesFrauduleux.includes(entree.url.hote))) {
    return { niveau: 'N3', motif: 'domaine signalé', signaleParListe: true };
  }

  // Z2
  const z2 = evaluerZ2(entree, listes, config);
  if (z2) return z2;

  // Z3
  if (entree.url && listes.exclusionsPersonnelles.includes(entree.url.domaineEnregistrable)) {
    return { niveau: 'N0', motif: 'domaine dans les exclusions personnelles' };
  }

  // Z4
  if (entree.url && estHorsPerimetre(entree.url)) {
    return { niveau: 'N0', motif: 'schéma non pertinent ou domaine local' };
  }

  // Z5
  if (!pageAAuMoinsUnChamp(entree)) {
    return { niveau: 'N0', motif: 'aucun champ de saisie ni formulaire' };
  }

  // Les deux axes sont calculés une fois. L'ordre des branches ci-dessous
  // reproduit néanmoins exactement celui du 5.6 : E == 0, puis E5, puis le
  // calcul de niveau au seuil — seul l'ordre des tests compte pour l'arbre de
  // décision, pas l'instant où les axes ont été calculés.
  const axeImitation = evaluerAxeImitation(entree, listes.socle, config);
  const marqueDetectee = listes.socle.find((m) => m.id === axeImitation.marqueDetectee);
  const axeExposition = evaluerAxeExposition(entree, marqueDetectee, config, listes.socle);

  if (axeExposition.score === 0) {
    return {
      niveau: 'N0',
      motif: 'aucune exposition détectée',
      scoreImitation: axeImitation.score,
      scoreExposition: 0,
      marqueDetectee: axeImitation.marqueDetectee,
      signauxImitation: axeImitation.signaux,
      signauxExposition: [],
    };
  }

  const e5 = axeExposition.signaux.find((s) => s.code === 'E5');
  if (e5) {
    return {
      niveau: 'N3',
      motif: 'secret reconnu à la frappe',
      marqueDetectee: axeImitation.marqueDetectee,
      scoreImitation: axeImitation.score,
      scoreExposition: axeExposition.score,
      signauxImitation: axeImitation.signaux,
      signauxExposition: axeExposition.signaux,
    };
  }

  const modificateurs = evaluerModificateurs(entree, listes);
  const seuil = calculerSeuil(modificateurs.total, config.sensibilite);

  // 14.57 : connexion en deux étapes. Page courante sans imitation (écran dépouillé) mais avec mot de passe ou paiement : on reprend l'imitation retenue.
  const retenue = contexte.imitationRetenue;
  const demandeMotDePasseOuPaiement = axeExposition.signaux.some((s) => s.code === 'E1' || s.code === 'E8');
  const imitationRetenueUtilisee = retenue !== undefined && demandeMotDePasseOuPaiement && retenue.scoreImitation > axeImitation.score ? retenue : undefined;
  const imitation = imitationRetenueUtilisee
    ? {
        ...axeImitation,
        score: imitationRetenueUtilisee.scoreImitation,
        marqueDetectee: imitationRetenueUtilisee.marque,
        famillesIndependantes: Math.max(axeImitation.famillesIndependantes, imitationRetenueUtilisee.familles.length),
      }
    : axeImitation;

  let niveau: Verdict['niveau'];
  let motif: string;
  if (imitation.score >= seuil && axeExposition.score >= SEUIL_E_POUR_N3 && imitation.famillesIndependantes >= NB_FAMILLES_MIN_POUR_N3) {
    niveau = 'N3';
    motif = 'imitation forte et exposition confirmée sur deux familles de signaux';
  } else if (imitation.score >= seuil && axeExposition.score >= SEUIL_E_POUR_N2) {
    niveau = 'N2';
    motif = 'imitation au-delà du seuil et exposition significative';
  } else if (imitation.score >= SEUIL_I_POUR_N1 && axeExposition.score >= SEUIL_E_POUR_N1) {
    niveau = 'N1';
    motif = 'indices d\'imitation et exposition modérée';
  } else {
    niveau = 'N0';
    motif = 'sous les seuils d\'alerte';
  }

  if (imitationRetenueUtilisee && niveau !== 'N0') motif += " (imitation retenue d'une page précédente du même site, 14.57)";

  // 5.5 : un domaine validé par la couche communautaire ne peut jamais produire
  // N3, quel que soit le calcul de seuil qui précède.
  if (niveau === 'N3' && modificateurs.m6Actif) {
    niveau = 'N2';
    motif = 'imitation forte, mais domaine validé par la couche communautaire (N3 exclu par M6)';
  }

  // 14.5 / 14.13 point 6 : plafond de la version d'essai. Il ne vise que le N3
  // atteint ici, par le score : Z1 (révocation) et E5 (secret reconnu) ont
  // déjà retourné plus haut et ne passent jamais par cette ligne — leur N3
  // ne porte pas de marque et ne doit pas devenir un N2 sans marque.
  if (niveau === 'N3' && config.n3ParScoreActif === false) {
    niveau = 'N2';
    motif = 'imitation forte et exposition confirmée (N3 non activé dans cette version d\'essai, 14.5)';
  }

  // 14.12, point 2 : N1 et N2 ne sont atteints que par une branche exigeant
  // imitation.score > 0 (>= seuil ou >= SEUIL_I_POUR_N1, tous deux > 0),
  // et evaluerAxeImitation ne renvoie un score non nul qu'accompagné d'une
  // marque (signaux-imitation.ts). L'assertion est donc la preuve de
  // l'invariant, pas une confiance non vérifiée ; le type Verdict (N1|N2
  // exigent marqueDetectee: string) le rend visible au compilateur pour tout
  // le reste du code, sans qu'une chaîne de repli n'ait à masquer un manquement.
  if (niveau === 'N1' || niveau === 'N2') {
    return {
      niveau,
      motif,
      marqueDetectee: imitation.marqueDetectee!,
      scoreImitation: imitation.score,
      scoreExposition: axeExposition.score,
      seuil,
      signauxImitation: imitation.signaux,
      signauxExposition: axeExposition.signaux,
      modificateursSeuil: modificateurs.signaux,
      ...(imitationRetenueUtilisee ? { imitationRetenueUtilisee } : {}),
    };
  }

  return {
    niveau,
    motif,
    marqueDetectee: imitation.marqueDetectee,
    scoreImitation: imitation.score,
    scoreExposition: axeExposition.score,
    seuil,
    signauxImitation: imitation.signaux,
    signauxExposition: axeExposition.signaux,
    modificateursSeuil: modificateurs.signaux,
    ...(imitationRetenueUtilisee ? { imitationRetenueUtilisee } : {}),
  };
}
