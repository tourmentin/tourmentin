// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.1 : le filtrage de ressources du harnais L5 modifie ce que le
// moteur voit, donc relève de la spécification, pas d'un simple réglage de
// performance. Deux règles, et une seule direction d'évolution : on peut
// restreindre encore le blocage, jamais l'étendre sans repasser par la spec.
//
// Bloqué, toujours : le type `media` (vidéo, audio — le collecteur DOM ne les
// lit pas, aucun signal n'en dépend).
// Bloqué, seulement pour les hôtes de régies-publicitaires.mjs, et seulement
// si le type de ressource n'est pas protégé ci-dessous.
//
// Jamais bloqué, quel que soit l'hôte : image et stylesheet (signaux visuels
// I5/I6), font (la mise en page alimente ces mêmes signaux), et la navigation
// d'un cadre — `document` pour le cadre principal, `sub_frame` pour un cadre
// enfant. Un hôte de corpus qui coïnciderait avec une régie ne doit jamais
// se voir bloquer sa propre page (spec 12.3.2, vérification demandée après
// le rapport du 14/09 : `document` manquait de cette liste).
export const TYPE_TOUJOURS_BLOQUE = 'media';

export const TYPES_JAMAIS_BLOQUES = ['image', 'stylesheet', 'font', 'document', 'sub_frame'];

/**
 * Vrai si `hote` est le domaine d'une régie de `listeRegies`, ou un de ses
 * sous-domaines (`ads.doubleclick.net` compte pour `doubleclick.net`).
 */
export function estHoteRegie(hote, listeRegies) {
  const h = hote.toLowerCase();
  return listeRegies.some((regie) => h === regie || h.endsWith(`.${regie}`));
}

/**
 * Décide si une requête doit être bloquée. `resourceType` suit le
 * vocabulaire Playwright (`request.resourceType()`). Le garde-fou sur
 * TYPES_JAMAIS_BLOQUES est vérifié en premier et prime toujours sur la
 * liste de régies : un hôte de régie qui sert une image ou une police n'est
 * pas bloqué pour autant.
 */
export function doitBloquerRessource(hote, resourceType, listeRegies = []) {
  if (TYPES_JAMAIS_BLOQUES.includes(resourceType)) return false;
  if (resourceType === TYPE_TOUJOURS_BLOQUE) return true;
  return estHoteRegie(hote, listeRegies);
}
