// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.33 B et C : adresse de base des listes signées et clé publique de vérification. Fixées à la construction
// (vite.config.ts, `define`), jamais lues au chargement depuis une source modifiable :
//   - TOURMENTIN_URL_PUBLICATION       -> adresse de base, terminée par « / », en https ;
//   - TOURMENTIN_CLE_PUBLIQUE_LISTES   -> clé publique Ed25519, 64 caractères hexadécimaux.
// Absentes (builds d'aujourd'hui, tests unitaires) : l'extension ne télécharge rien et n'accepte aucune liste.
declare const __URL_PUBLICATION__: string | undefined;
declare const __CLE_PUBLIQUE_LISTES__: string | undefined;
declare const __PUBLICATION_ESSAI_LOCAL__: boolean | undefined;

export const URL_PUBLICATION: string = typeof __URL_PUBLICATION__ === 'undefined' ? '' : __URL_PUBLICATION__;
export const CLE_PUBLIQUE_LISTES: string | null = typeof __CLE_PUBLIQUE_LISTES__ === 'undefined' || __CLE_PUBLIQUE_LISTES__ === '' ? null : __CLE_PUBLIQUE_LISTES__;

/** Vrai seulement dans dist/chrome-publication-test (jamais remis) : clé d'essai et serveur local. */
export const PUBLICATION_ESSAI_LOCAL: boolean = typeof __PUBLICATION_ESSAI_LOCAL__ === 'undefined' ? false : __PUBLICATION_ESSAI_LOCAL__;
