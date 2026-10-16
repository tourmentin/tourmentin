// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.63 : texte « Ce que Tourmentin lit », validé par Ph le 17/10/2026, commun à l'accueil (site/accueil/index.html, recopié à l'identique) et à la page
// d'installation (extension/scripts/construire-installer.mjs). Chaque phrase a été vérifiée dans le code (adaptateurs/dom.ts, contenu/) ; formules des navigateurs :
// Chrome et Brave (mesurée), Firefox (vérifiée par Ph sur addons.mozilla.org en français).
export const TITRE_CE_QUE_TOURMENTIN_LIT = 'Ce que Tourmentin lit';
export const TEXTE_CE_QUE_TOURMENTIN_LIT =
  "Tourmentin ne peut pas lire les fichiers de votre ordinateur : une extension de navigateur ne voit que les pages que votre navigateur affiche. " +
  "Sur une page ouverte, il examine son adresse, son titre, son texte visible, ses liens et les champs de ses formulaires (leur type et leur intitulé : jamais ce que vous y tapez), pour savoir si elle imite un service connu. " +
  "À l'installation, votre navigateur annonce que l'extension pourra « lire et modifier toutes vos données sur tous les sites Web » (Chrome, Brave) ou « Accéder à vos données pour tous les sites web » (Firefox) : " +
  "c'est la formule standard pour toute extension qui examine chaque page, comme un bloqueur de publicité. " +
  "Tourmentin ne modifie rien d'autre dans la page que le bandeau d'alerte qu'il peut y afficher. " +
  "Son code est public : chacun peut vérifier ce qu'il fait.";
