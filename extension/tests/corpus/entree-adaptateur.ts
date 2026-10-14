// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Point d'entrée du bundle injecté dans une page par les scripts de diagnostic
// et de constitution du corpus (12.3.3.3) : expose l'adaptateur DOM de
// l'extension ET l'axe d'imitation du moteur, tels quels — le même code que
// celui du content script, pas une réimplémentation du script. Une page de
// connexion se juge avec la détection de l'extension, jamais avec une
// détection propre au script.
//
// Limite connue : injecté dans le monde principal de la page, il ne dispose pas
// de chrome.dom.openOrClosedShadowRoot — les racines d'ombre FERMÉES lui sont
// invisibles, alors que le content script les voit. Le recensement CDP
// (diagnostiquer-connexion.mjs) traverse les racines fermées pour le vérifier.
//
// Aucune valeur de champ ni texte de page ne sort d'ici : seulement des
// structures (types, autocomplete, libellés de champ) et des résultats de
// signaux.
import { construireEntreeAnalyse } from '../../src/adaptateurs/dom.js';
import { selectionnerProfond } from '../../src/adaptateurs/shadow.js';
import { evaluerAxeImitation } from '../../src/moteur/signaux-imitation.js';
import { analyser } from '../../src/moteur/analyser.js';
import { appartientAuxDomaines } from '../../src/moteur/domaine.js';
import { contientTerme, normaliser } from '../../src/moteur/texte.js';
import { construireListes, configParDefaut } from '../../src/listes/chargement.js';

const listes = construireListes();
const config = configParDefaut();
const g = globalThis as unknown as Record<string, unknown>;

g.__tourmentinEntree = () => construireEntreeAnalyse(document);

/**
 * Verdict complet (niveau, motif, marque, scores I et E, signaux des deux
 * axes) -- exactement ce que calcule le service worker en production
 * (moteur/analyser.ts), pas une réévaluation partielle limitée à l'axe
 * d'imitation. Ajouté pour 12.3.3.17, point 6 : le relevé des mires doit
 * pouvoir dire si C1 tient, pas seulement donner un score d'imitation.
 */
g.__tourmentinVerdict = () => analyser(construireEntreeAnalyse(document), listes, config);

/**
 * Champs de type password ou d'identifiant situés hors de toute balise
 * <form> — depuis 12.3.3.7, PLUS invisibles pour Z5/E1/E2 : dom.ts les
 * collecte désormais dans un formulaire implicite. Ce compteur sert donc à
 * une distinction plus fine, pas à détecter un angle mort : jugerAnalyse()
 * l'utilise pour signaler qu'un champ de ce type existe hors <form> mais que
 * le contexte de page (titre, chemin) n'a pas convaincu l'heuristique de
 * classement du script — pas une lacune de l'adaptateur ni du moteur.
 */
function champsDeConnexionHorsFormulaire(): number {
  return selectionnerProfond<HTMLInputElement>(document, 'input').filter((i) => {
    if (i.closest('form')) return false;
    const ac = (i.getAttribute('autocomplete') ?? '').toLowerCase();
    return i.type.toLowerCase() === 'password' || ac.includes('username') || ac.includes('email');
  }).length;
}

g.__tourmentinAnalyse = () => {
  const entree = construireEntreeAnalyse(document);
  const axe = evaluerAxeImitation(entree, listes.socle, config);
  const texte = normaliser(`${entree.titre} ${entree.texteVisible}`);
  const marqueurs = listes.socle
    .map((e) => ({
      marque: e.id,
      horsDomaines: entree.url ? !appartientAuxDomaines(entree.url.domaineEnregistrable, e.domaines) : false,
      termesForts: e.termesForts.filter((t) => contientTerme(texte, t)),
    }))
    .filter((m) => m.termesForts.length > 0);
  return {
    href: entree.url?.href,
    hote: entree.url?.hote,
    domaineEnregistrable: entree.url?.domaineEnregistrable,
    chemin: entree.url?.chemin,
    titre: entree.titre,
    formulaires: entree.formulaires.map((f) => ({
      champs: f.champs.map((c) => ({
        type: c.type,
        autocomplete: c.autocomplete ?? null,
        nom: c.nom ?? null,
        libelle: c.libelle ?? null,
        placeholder: c.placeholder ?? null,
        visible: c.visible,
      })),
    })),
    champsHorsFormulaire: champsDeConnexionHorsFormulaire(),
    axe: {
      score: axe.score,
      marqueDetectee: axe.marqueDetectee ?? null,
      signaux: axe.signaux.map((s) => ({ code: s.code, poids: s.poids, famille: s.famille, detail: s.detail })),
    },
    marqueurs,
  };
};
