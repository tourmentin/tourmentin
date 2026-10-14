// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.57 : mémoire d'imitation entre les pages d'un même hôte (connexion en deux étapes, 12.3.3.18 point 3).
// Fonctions pures : aucun accès au temps ni au stockage. Le service worker lit et écrit la mémoire (session, 15 minutes, clé = hôte exact)
// et la passe à analyser() en entrée ; ce fichier décide seulement quoi retenir et si une page demande un identifiant.
import { SEUIL_I_POUR_N1 } from './constantes.js';
import { evaluerM6 } from './seuils.js';
import { contientTerme, normaliser } from './texte.js';
import type { ChampFormulaire, EntreeAnalyse, ImitationRetenue, Listes, Verdict } from './types.js';

/** Intitulés d'un champ d'identifiant de connexion (14.57 point 1) : mêmes termes que la mesure de 12.3.3.18, plus les identifiants de l'administration. */
const LEXIQUE_IDENTIFIANT = [
  'identifiant',
  'adresse e-mail',
  'adresse email',
  'adresse electronique',
  'adresse mail',
  'courriel',
  'e-mail',
  'email',
  "nom d'utilisateur",
  'login',
  'username',
  'numero fiscal',
  'numero de securite sociale',
  'securite sociale',
];

/** Champ visible d'identifiant de connexion : autocomplete username ou email, ou intitulé du lexique. Jamais un champ de recherche, un champ caché ou un mot de passe. */
export function estChampIdentifiantConnexion(champ: ChampFormulaire): boolean {
  if (!champ.visible) return false;
  if (champ.type === 'search' || champ.type === 'hidden' || champ.type === 'password') return false;
  const autocomplete = (champ.autocomplete ?? '').toLowerCase().split(/\s+/);
  if (autocomplete.includes('username') || autocomplete.includes('email')) return true;
  const intitule = normaliser([champ.libelle, champ.nom, champ.placeholder].filter(Boolean).join(' '));
  return LEXIQUE_IDENTIFIANT.some((terme) => contientTerme(intitule, terme));
}

export function aChampIdentifiantConnexion(entree: EntreeAnalyse): boolean {
  return entree.formulaires.some((f) => f.champs.some(estChampIdentifiantConnexion));
}

/**
 * Ce que l'analyse d'une page laisse en mémoire pour les pages suivantes du même hôte, ou `null`.
 * On ne retient que si la page demandait un identifiant, que l'analyse est allée jusqu'à l'axe d'exposition (donc ni domaine authentique Z2,
 * ni liste, ni exclusion, ni hors périmètre), que M6 n'est pas actif (domaine validé) et que l'imitation atteint le plancher de N1 :
 * en dessous, max(I page, I retenu) ne pourrait jamais changer un verdict.
 */
export function imitationARetenir(entree: EntreeAnalyse, verdict: Verdict, listes: Listes): ImitationRetenue | null {
  if (!entree.url || !aChampIdentifiantConnexion(entree)) return null;
  if (verdict.signaleParListe || verdict.scoreExposition === undefined) return null;
  // M6 relu sur les listes, pas sur le verdict : l'écran d'identifiant s'arrête à E = 0, avant le calcul des modificateurs.
  if (evaluerM6(entree, listes) !== null) return null;
  const score = verdict.scoreImitation ?? 0;
  if (!verdict.marqueDetectee || score < SEUIL_I_POUR_N1) return null;
  const familles = [...new Set((verdict.signauxImitation ?? []).map((s) => s.famille))];
  return { marque: verdict.marqueDetectee, scoreImitation: score, familles };
}
