// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Axe I — Imitation, chapitre 5.3. Chaque signal est évalué pour une empreinte
// de marque donnée (I1-I6), ou indépendamment de toute marque (I7, I8, qui ne
// jugent que la forme du domaine).
import { POIDS_IMITATION, NB_TERMES_FAIBLES_MIN_I2, NB_COULEURS_MIN_I6 } from './constantes.js';
import { distanceDamerauLevenshtein, sansDernierLabel } from './distance.js';
import { analyserHote, appartientAuxDomaines, contientTokenHorsSuffixe, possedeLabelPunycodeMeleALatin } from './domaine.js';
import { contientTerme, compterTermesPresents, normaliser } from './texte.js';
import type { Config, EmpreinteMarque, EntreeAnalyse, SignalDeclenche } from './types.js';

function texteComplet(entree: EntreeAnalyse): string {
  return normaliser(`${entree.titre} ${entree.texteVisible}`);
}

export function evaluerI1(entree: EntreeAnalyse, empreinte: EmpreinteMarque, config?: Config): SignalDeclenche | null {
  const texte = texteComplet(entree);
  const termeFortTrouve = empreinte.termesForts.find((t) => contientTerme(texte, t));
  if (termeFortTrouve) {
    return { code: 'I1', poids: POIDS_IMITATION.I1, famille: 'textuelle', detail: `terme fort "${termeFortTrouve}"` };
  }
  const motCleTrouve = config?.motsClesPersonnels.find((t) => contientTerme(texte, t));
  if (motCleTrouve) {
    return { code: 'I1', poids: POIDS_IMITATION.I1, famille: 'textuelle', detail: `mot-clé personnel "${motCleTrouve}"` };
  }
  return null;
}

export function evaluerI2(entree: EntreeAnalyse, empreinte: EmpreinteMarque): SignalDeclenche | null {
  const texte = texteComplet(entree);
  const nb = compterTermesPresents(texte, empreinte.termesFaibles);
  if (nb >= NB_TERMES_FAIBLES_MIN_I2) {
    return { code: 'I2', poids: POIDS_IMITATION.I2, famille: 'textuelle', detail: `${nb} termes faibles` };
  }
  return null;
}

export function evaluerI3(entree: EntreeAnalyse, empreinte: EmpreinteMarque): SignalDeclenche | null {
  if (!entree.url) return null;
  const zoneSuspecte = normaliser(`${entree.url.sousDomaines.join('.')} ${entree.url.chemin}`);
  const domaineEnregistrableNormalise = normaliser(entree.url.domaineEnregistrable);
  const racine = empreinte.racinesTypo.find(
    (r) => contientTerme(zoneSuspecte, r) && !contientTerme(domaineEnregistrableNormalise, r),
  );
  if (racine) {
    return { code: 'I3', poids: POIDS_IMITATION.I3, famille: 'lexicale-url', detail: `racine "${racine}" hors domaine enregistrable` };
  }
  return null;
}

export function evaluerI4(entree: EntreeAnalyse, empreinte: EmpreinteMarque): SignalDeclenche | null {
  if (!entree.url) return null;
  const cible = sansDernierLabel(entree.url.domaineEnregistrable);
  for (const domaineMarque of empreinte.domaines) {
    if (entree.url.domaineEnregistrable === analyserHote(domaineMarque).domaineEnregistrable) continue;
    const reference = sansDernierLabel(analyserHote(domaineMarque).domaineEnregistrable);
    const distance = distanceDamerauLevenshtein(cible, reference);
    if (distance <= 2) {
      return { code: 'I4', poids: POIDS_IMITATION.I4, famille: 'lexicale-url', detail: `distance ${distance} de "${domaineMarque}"` };
    }
  }
  return null;
}

export function evaluerI5(entree: EntreeAnalyse, empreinte: EmpreinteMarque): SignalDeclenche | null {
  if (!entree.url) return null;
  const hash = entree.ressources.faviconHash;
  if (!hash || !empreinte.faviconHash.includes(hash)) return null;
  if (appartientAuxDomaines(entree.url.domaineEnregistrable, empreinte.domaines)) return null;
  return { code: 'I5', poids: POIDS_IMITATION.I5, famille: 'visuelle', detail: 'empreinte de favicon identique, domaine différent' };
}

export function evaluerI6(entree: EntreeAnalyse, empreinte: EmpreinteMarque): SignalDeclenche | null {
  const couleursMarque = new Set(empreinte.couleurs.map((c) => c.toLowerCase()));
  const nb = entree.ressources.couleursDominantes.filter((c) => couleursMarque.has(c.toLowerCase())).length;
  if (nb >= NB_COULEURS_MIN_I6) {
    return { code: 'I6', poids: POIDS_IMITATION.I6, famille: 'visuelle', detail: `${nb} couleurs dominantes communes` };
  }
  return null;
}

export function evaluerI7(entree: EntreeAnalyse): SignalDeclenche | null {
  if (!entree.url) return null;
  if (possedeLabelPunycodeMeleALatin(entree.url.hote)) {
    return { code: 'I7', poids: POIDS_IMITATION.I7, famille: 'lexicale-url', detail: 'label punycode mêlé à un label latin' };
  }
  return null;
}

export function evaluerI8(entree: EntreeAnalyse): SignalDeclenche | null {
  if (!entree.url) return null;
  if (contientTokenHorsSuffixe(entree.url.hote, entree.url.suffixePublic, 'gouv')) {
    return { code: 'I8', poids: POIDS_IMITATION.I8, famille: 'lexicale-url', detail: '"gouv" hors du suffixe public réel' };
  }
  return null;
}

export interface ResultatAxeImitation {
  score: number;
  marqueDetectee?: string;
  signaux: SignalDeclenche[];
  famillesIndependantes: number;
}

function evaluerSignauxPourMarque(entree: EntreeAnalyse, empreinte: EmpreinteMarque, config?: Config): SignalDeclenche[] {
  const signaux = [
    evaluerI1(entree, empreinte, config),
    evaluerI2(entree, empreinte),
    evaluerI3(entree, empreinte),
    evaluerI4(entree, empreinte),
    evaluerI5(entree, empreinte),
    evaluerI6(entree, empreinte),
    evaluerI7(entree),
    evaluerI8(entree),
  ];
  return signaux.filter((s): s is SignalDeclenche => s !== null);
}

export function compterFamillesIndependantes(signaux: SignalDeclenche[]): number {
  return new Set(signaux.map((s) => s.famille)).size;
}

/**
 * Évalue l'axe I pour chaque marque du socle et retient la marque dont les
 * signaux totalisent le score le plus élevé (« la marque détectée »). En cas
 * d'égalité de score, le niveau d'alerte est inchangé (il ne dépend que du
 * score), mais N3 nomme la marque à l'usager -- 12.3.3.12 : le départage ne
 * doit donc pas dépendre de l'ordre d'appel. Trié sur l'identifiant de marque
 * (ordre alphabétique) avant le parcours, indépendamment de l'ordre reçu en
 * paramètre : chargerSocle() livre déjà ses entrées triées ainsi (5.3,
 * generer.ts), ce tri est une garantie de l'axe lui-même, pas une confiance
 * faite à l'appelant.
 */
export function evaluerAxeImitation(entree: EntreeAnalyse, socle: EmpreinteMarque[], config?: Config): ResultatAxeImitation {
  let meilleur: { empreinte: EmpreinteMarque; signaux: SignalDeclenche[]; score: number } | undefined;

  const socleTrie = [...socle].sort((a, b) => a.id.localeCompare(b.id));
  for (const empreinte of socleTrie) {
    const signaux = evaluerSignauxPourMarque(entree, empreinte, config);
    const score = Math.min(100, signaux.reduce((total, s) => total + s.poids, 0));
    if (!meilleur || score > meilleur.score) {
      meilleur = { empreinte, signaux, score };
    }
  }

  if (!meilleur || meilleur.score === 0) {
    return { score: 0, signaux: [], famillesIndependantes: 0 };
  }

  return {
    score: meilleur.score,
    marqueDetectee: meilleur.empreinte.id,
    signaux: meilleur.signaux,
    famillesIndependantes: compterFamillesIndependantes(meilleur.signaux),
  };
}
