// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Axe E — Exposition, chapitres 5.4 et 5.4.1. Les signaux liés à un champ
// précis (E1-E4) sont évalués sur l'ensemble des champs de tous les
// formulaires de la page ; E6-E8 sont évalués au niveau du formulaire ou de la
// page.
import { POIDS_EXPOSITION, LONGUEUR_MIN_SAISIE_E4 } from './constantes.js';
import { normaliser, contientTerme } from './texte.js';
import type { ChampFormulaire, Config, EmpreinteMarque, EntreeAnalyse, FormulaireNormalise, SignalDeclenche } from './types.js';

function libelleChamp(champ: ChampFormulaire): string {
  return normaliser([champ.libelle, champ.nom, champ.placeholder, champ.autocomplete].filter(Boolean).join(' '));
}

function tousLesChamps(entree: EntreeAnalyse): ChampFormulaire[] {
  return entree.formulaires.flatMap((f) => f.champs);
}

export function evaluerE1(entree: EntreeAnalyse): SignalDeclenche | null {
  const champ = tousLesChamps(entree).find((c) => c.type === 'password' && c.visible);
  if (!champ) return null;
  return { code: 'E1', poids: POIDS_EXPOSITION.E1, famille: 'identifiant', detail: 'champ mot de passe visible' };
}

export function evaluerE2(entree: EntreeAnalyse, marqueDetectee?: EmpreinteMarque): SignalDeclenche | null {
  if (!marqueDetectee) return null;
  for (const champ of tousLesChamps(entree)) {
    const libelle = libelleChamp(champ);
    const terme = marqueDetectee.termesSaisie.find((t) => contientTerme(libelle, t));
    if (terme) {
      return { code: 'E2', poids: POIDS_EXPOSITION.E2, famille: 'identifiant', detail: `champ "${terme}" de la marque détectée` };
    }
  }
  return null;
}

export function evaluerE3(entree: EntreeAnalyse, config?: Config): SignalDeclenche | null {
  if (!config) return null;
  for (const champ of tousLesChamps(entree)) {
    const libelle = libelleChamp(champ);
    const secret = config.secretsSurveilles.find((s) => contientTerme(libelle, s.libelle));
    if (secret) {
      return { code: 'E3', poids: POIDS_EXPOSITION.E3, famille: 'identifiant', detail: `champ correspondant au secret "${secret.libelle}"` };
    }
  }
  return null;
}

/**
 * E4 relit E1/E2/E3 plutôt que de redéfinir sa propre notion de « champ
 * sensible », pour ne jamais diverger de ce que ces trois signaux considèrent
 * comme tel.
 */
export function evaluerE4(entree: EntreeAnalyse, marqueDetectee?: EmpreinteMarque, config?: Config): SignalDeclenche | null {
  const e1 = evaluerE1(entree) !== null;
  const e2 = evaluerE2(entree, marqueDetectee) !== null;
  const e3 = evaluerE3(entree, config) !== null;
  if (!e1 && !e2 && !e3) return null;

  for (const champ of tousLesChamps(entree)) {
    const estSensible =
      (champ.type === 'password' && champ.visible) ||
      (marqueDetectee?.termesSaisie.some((t) => contientTerme(libelleChamp(champ), t)) ?? false) ||
      (config?.secretsSurveilles.some((s) => contientTerme(libelleChamp(champ), s.libelle)) ?? false);
    if (estSensible && (champ.longueurSaisie ?? 0) >= LONGUEUR_MIN_SAISIE_E4) {
      return { code: 'E4', poids: POIDS_EXPOSITION.E4, famille: 'identifiant', detail: `${champ.longueurSaisie} caractères saisis` };
    }
  }
  return null;
}

/** Court-circuit direct vers N3 (5.6), géré par analyser.ts. Incluse dans l'axe pour la cohérence du score. */
export function evaluerE5(entree: EntreeAnalyse): SignalDeclenche | null {
  if (!entree.secretReconnu) return null;
  return { code: 'E5', poids: POIDS_EXPOSITION.E5, famille: 'identifiant', detail: `secret "${entree.secretReconnu.idSecret}" reconnu à la frappe` };
}

function actionDifferente(formulaire: FormulaireNormalise, domainePage?: string): boolean {
  if (!formulaire.actionDomaineEnregistrable || !domainePage) return false;
  return formulaire.actionDomaineEnregistrable !== domainePage;
}

export function evaluerE6(entree: EntreeAnalyse): SignalDeclenche | null {
  const domainePage = entree.url?.domaineEnregistrable;
  const formulaire = entree.formulaires.find((f) => actionDifferente(f, domainePage));
  if (!formulaire) return null;
  return { code: 'E6', poids: POIDS_EXPOSITION.E6, famille: 'formulaire', detail: `action vers "${formulaire.actionDomaineEnregistrable}"` };
}

export function evaluerE7(entree: EntreeAnalyse, socle: EmpreinteMarque[]): SignalDeclenche | null {
  const domainePage = entree.url?.domaineEnregistrable;
  const domainesSocle = new Set(socle.flatMap((m) => m.domaines));
  const formulaire = entree.formulaires.find(
    (f) =>
      f.dansIframeCrossOrigin &&
      f.domaineFrame !== undefined &&
      f.domaineFrame !== domainePage &&
      !domainesSocle.has(f.domaineFrame),
  );
  if (!formulaire) return null;
  return { code: 'E7', poids: POIDS_EXPOSITION.E7, famille: 'formulaire', detail: `iframe cross-origin "${formulaire.domaineFrame}"` };
}

const TERMES_NUMERO_CARTE = ['numéro de carte', 'numero de carte', 'card number', 'carte bancaire', 'cc-number'];
const TERMES_CRYPTOGRAMME = ['cryptogramme', 'cvv', 'cvc', 'cvv2'];
const TERMES_EXPIRATION = ["date d'expiration", 'date d expiration', 'expiration', 'mm/aa', 'mm/yy'];

export function evaluerE8(entree: EntreeAnalyse): SignalDeclenche | null {
  const champs = tousLesChamps(entree);
  const libelles = champs.map(libelleChamp);

  const champNumeroCarte = champs.find(
    (c, i) => c.autocomplete?.toLowerCase() === 'cc-number' || TERMES_NUMERO_CARTE.some((t) => contientTerme(libelles[i]!, t)),
  );
  if (champNumeroCarte) {
    return { code: 'E8', poids: POIDS_EXPOSITION.E8, famille: 'paiement', detail: 'champ numéro de carte' };
  }

  const aCryptogramme = libelles.some((l) => TERMES_CRYPTOGRAMME.some((t) => contientTerme(l, t)));
  const aExpiration = libelles.some((l) => TERMES_EXPIRATION.some((t) => contientTerme(l, t)));
  if (aCryptogramme && aExpiration) {
    return { code: 'E8', poids: POIDS_EXPOSITION.E8, famille: 'paiement', detail: 'couple cryptogramme et date d\'expiration' };
  }

  return null;
}

export interface ResultatAxeExposition {
  score: number;
  signaux: SignalDeclenche[];
}

export function evaluerAxeExposition(
  entree: EntreeAnalyse,
  marqueDetectee: EmpreinteMarque | undefined,
  config: Config | undefined,
  socle: EmpreinteMarque[],
): ResultatAxeExposition {
  const signaux = [
    evaluerE1(entree),
    evaluerE2(entree, marqueDetectee),
    evaluerE3(entree, config),
    evaluerE4(entree, marqueDetectee, config),
    evaluerE5(entree),
    evaluerE6(entree),
    evaluerE7(entree, socle),
    evaluerE8(entree),
  ].filter((s): s is SignalDeclenche => s !== null);

  const score = Math.min(100, signaux.reduce((total, s) => total + s.poids, 0));
  return { score, signaux };
}
