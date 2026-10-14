// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Chargement des listes depuis les fichiers empaquetés (pas encore de
// réseau — lot L9 s'en chargera). socle.genere.json est produit avant chaque
// build/test par scripts/preparer-socle.mjs à partir de listes/publie/socle.json.
// Ce fichier publié est déjà au format EmpreinteMarque du moteur — une
// projection par liste blanche faite à la génération (listes/outils/projection.ts,
// spec v1.5), pas une copie des fichiers sources : aucune conversion de champs
// à faire ici. Jamais édité à la main, jamais présumé présent dans le dépôt.
import type { Config, EmpreinteMarque, Listes } from '../moteur/types.js';
import { N3_PAR_SCORE_ACTIF } from '../version-essai.js';
import socleGenere from './socle.genere.json';

export function chargerSocle(): EmpreinteMarque[] {
  return socleGenere.entrees as EmpreinteMarque[];
}

/**
 * Listes minimales pour ce lot : le socle embarqué est la seule liste
 * réellement peuplée. Révocation, exclusions personnelles et validation
 * communautaire arrivent avec le téléchargement des listes (lot L9) ; domaines
 * déjà vus et TLD abusifs avec le paramétrage (lot L4 et suivants). Les
 * modificateurs M1-M6 qui en dépendent restent donc inertes jusque-là — pas un
 * bug, une donnée qui n'existe pas encore.
 */
export function construireListes(): Listes {
  return {
    socle: chargerSocle(),
    revocation: [],
    exclusionsPersonnelles: [],
    communautaireValidee: [],
    domainesDejaVus: [],
    tldAbusifs: [],
  };
}

export function configParDefaut(): Config {
  return { sensibilite: 'equilibre', motsClesPersonnels: [], secretsSurveilles: [], n3ParScoreActif: N3_PAR_SCORE_ACTIF };
}

/** 14.2.4 : version du socle embarqué, affichée dans les options et écrite dans les exports — un verdict rapporté doit pouvoir dire de quelle version il vient. */
export function versionSocle(): string {
  return socleGenere.version;
}
