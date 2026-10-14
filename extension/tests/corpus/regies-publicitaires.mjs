// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.1, tableau de filtrage des ressources : liste d'hôtes de régies
// publicitaires et de mesure d'audience, bloqués pendant le harnais L5 parce
// qu'aucun n'affiche de formulaire d'identification (le signal E7 vise un
// formulaire dans un cadre d'origine différente, pas un bandeau publicitaire).
//
// Chaque hôte listé ici, et ses sous-domaines, sont bloqués — mais seulement
// pour les types de ressource qui ne sont pas protégés par
// filtrage-ressources.mjs (jamais image, stylesheet, font, ni la navigation
// d'un cadre). Un hôte ajouté ici doit être une régie ou un outil de mesure
// documenté, jamais un CDN ni un hébergeur générique : bloquer par hôte un
// service qui sert aussi du contenu légitime casserait des pages honnêtes.

export const HOTES_REGIES_PUBLICITAIRES = [
  // Display et enchères publicitaires
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'adservice.google.fr',
  'amazon-adsystem.com',
  'adnxs.com',
  'adform.net',
  'pubmatic.com',
  'rubiconproject.com',
  'casalemedia.com',
  'openx.net',
  'smartadserver.com',
  'criteo.com',
  'criteo.net',
  'taboola.com',
  'outbrain.com',
  'media.net',
  'yieldmo.com',
  'weborama.fr',
  'adotmob.com',

  // Mesure d'audience et suivi
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'scorecardresearch.com',
  'quantserve.com',
  'hotjar.com',
  'mixpanel.com',
  'segment.com',
  'segment.io',
  'connect.facebook.net',
  'facebook.net',
  'atdmt.com',
  'xiti.com', // AT Internet, très utilisé sur les sites publics français
];
