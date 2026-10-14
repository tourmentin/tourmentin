// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.11 rang 2 : export du journal et des signalements. Le serveur de 14.10
// n'étant pas codé, l'export EST le canal de collecte du palier : sans lui,
// rien de ce que les testeurs recueillent ne parvient jamais au gérant.
//
// Geste délibéré du testeur (14.1) : rien ici n'est déclenché par l'extension,
// aucun envoi, aucune requête — le fichier est produit localement, le testeur
// le relit (JSON lisible, pas un binaire) puis le transmet lui-même. Fonctions
// pures : ni API navigateur ni horloge implicite, testables hors extension.
import type { EntreeJournal } from './journal.js';
import type { EntreeSignalement } from './signalements.js';

export type TypeExport = 'journal' | 'signalements';

export interface VersionsExport {
  extension: string;
  socle: string;
}

/** 14.1 : le contenu est décrit en clair au testeur, dans le fichier même qu'il relit avant de l'envoyer. */
export const AVERTISSEMENT_EXPORT =
  "Fichier écrit par Tourmentin sur cet ordinateur, à votre demande. Il contient les adresses de pages " +
  "(schéma, hôte et chemin ; jamais la partie après « ? » ni après « # »), le niveau d'alerte, le motif et la marque évoquée, ainsi que le nombre de bandeaux de connexion affichés chaque jour (un nombre par date, sans adresse). " +
  "Il ne contient ni le contenu des pages, ni rien de ce que vous avez saisi. Rien n'a été envoyé : " +
  "relisez-le, puis transmettez-le vous-même si vous le souhaitez.";

export function construireExport(
  type: TypeExport,
  entrees: EntreeJournal[] | EntreeSignalement[],
  versions: VersionsExport,
  maintenant: Date = new Date(),
  /** 14.24 A1 : bandeaux de connexion affichés, par jour. */
  bandeauxConnexionParJour: Record<string, number> = {},
): string {
  return JSON.stringify(
    {
      application: 'Tourmentin',
      type,
      version_extension: versions.extension,
      version_socle: versions.socle,
      exporte_le: maintenant.toISOString(),
      avertissement: AVERTISSEMENT_EXPORT,
      nombre_entrees: entrees.length,
      bandeaux_connexion_par_jour: bandeauxConnexionParJour,
      entrees,
    },
    null,
    2,
  );
}

export function nomFichierExport(type: TypeExport, maintenant: Date = new Date()): string {
  return `tourmentin-${type}-${maintenant.toISOString().slice(0, 10)}.json`;
}
