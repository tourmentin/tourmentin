// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Correction post-L2 : le fichier publié est une projection par liste
// blanche, pas une copie des fichiers sources (5.3, spec v1.5). Publier
// `a_verifier`, `notes_verification` ou `avertissement` distribuerait à
// chaque installation la liste de ce qui n'est pas encore vérifié dans le
// détecteur — une information gratuite à retirer et utile à un attaquant.
//
// Import de type uniquement, effacé à la compilation comme à l'exécution
// (node --experimental-strip-types comme Vite) : aucune dépendance
// d'exécution entre les paquets listes/ et extension/, seulement une
// référence au contrat de forme.
import type { EmpreinteMarque } from '../../extension/src/moteur/types.ts';
import type { EmpreinteBrute } from './schema.ts';

/**
 * Un exemplaire complet d'EmpreinteMarque, entièrement typé : si un champ est
 * ajouté ou retiré du type, TypeScript fait échouer cette déclaration avant
 * que quiconque publie ou omette silencieusement le nouveau champ.
 * CHAMPS_PUBLIES est dérivé de ses clés plutôt que retapé à la main.
 */
const EXEMPLE_COMPLET: EmpreinteMarque = {
  id: '',
  libelle: '',
  domaines: [],
  domainePrincipal: '',
  termesForts: [],
  termesFaibles: [],
  termesSaisie: [],
  faviconHash: [],
  couleurs: [],
  racinesTypo: [],
  criticite: 0,
};

export const CHAMPS_PUBLIES = Object.keys(EXEMPLE_COMPLET) as (keyof EmpreinteMarque)[];

/** Projette une empreinte brute (listes/socle/*.json) vers le contrat publié (EmpreinteMarque). */
export function projeterEmpreinte(brute: EmpreinteBrute): EmpreinteMarque {
  return {
    id: brute.id,
    libelle: brute.libelle,
    domaines: brute.domaines,
    domainePrincipal: brute.domaine_principal,
    termesForts: brute.termes_forts,
    termesFaibles: brute.termes_faibles,
    termesSaisie: brute.termes_saisie,
    faviconHash: brute.favicon_hash ?? [],
    couleurs: brute.couleurs,
    racinesTypo: brute.racines_typo,
    criticite: brute.criticite,
  };
}
