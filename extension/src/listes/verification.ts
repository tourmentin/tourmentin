// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.33 E : vérification d'une liste publiée AVANT toute application. Module pur (aucune API chrome.*) :
// il reçoit le texte téléchargé, la clé publique embarquée et la version déjà appliquée, et rend soit la liste
// vérifiée, soit un code de rejet (jamais le contenu). Le contenu d'une liste est une donnée : aucune entrée
// n'est interprétée, seulement comparée (CLAUDE.md règle 8).
export type NomListe = 'officiels' | 'frauduleux';

/** « identique » n'est pas une faute : la liste est authentique et déjà appliquée. */
export type CodeRejet = 'cle' | 'taille' | 'json' | 'format' | 'liste' | 'entree' | 'signature' | 'retour-arriere' | 'identique';

export interface EntreeListe {
  hote: string;
  marque?: string;
  /** 14.44 : absent = validé ; « repertorie » = sur le corpus public, sans marque. */
  statut?: 'repertorie';
}

export interface ListeVerifiee {
  liste: NomListe;
  version: string;
  genereLe: string;
  entrees: EntreeListe[];
}

export type ResultatVerification = { ok: true; liste: ListeVerifiee } | { ok: false; code: CodeRejet };

// 14.44 : relevé de 1 Mo à 2 Mo : 20 000 entrées de ~90 octets dépassaient 1 Mo (quelques milliers de répertoriés)
const TAILLE_MAX = 2_000_000;
const ENTREES_MAX = 20_000;
const HOTE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = /^\d{4}\.\d{2}\.\d{3}$/;
const HEX_CLE = /^[0-9a-f]{64}$/;
const HEX_SIGNATURE = /^[0-9a-f]{128}$/;

function hexVersOctets(hex: string): Uint8Array<ArrayBuffer> {
  const octets = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < octets.length; i++) octets[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return octets;
}

function entreeValide(nom: NomListe, e: unknown): e is Record<string, unknown> {
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return false;
  const o = e as Record<string, unknown>;
  if (typeof o.hote !== 'string' || !HOTE.test(o.hote)) return false;
  if (nom === 'officiels') {
    const marqueOk = o.marque === undefined || (typeof o.marque === 'string' && /^[a-z0-9-]{1,64}$/.test(o.marque));
    // 14.44 : « statut » absent (validé) ou « repertorie » ; un répertorié n'a pas de marque
    const statutOk = o.statut === undefined || (o.statut === 'repertorie' && o.marque === undefined);
    return marqueOk && statutOk && typeof o.valide_le === 'string' && DATE.test(o.valide_le);
  }
  return o.portee === 'hote' && typeof o.confirme_le === 'string' && DATE.test(o.confirme_le);
}

/**
 * @param texte contenu téléchargé, non interprété avant cette fonction
 * @param attendue nom de la liste demandée : un fichier ne peut pas être rejoué sous un autre nom
 * @param clePubliqueHex clé publique Ed25519 embarquée (64 caractères hexadécimaux), ou null : aucune liste acceptée
 * @param versionAppliquee version actuellement appliquée, ou null ; la nouvelle doit lui être strictement supérieure
 */
export async function verifierListeSignee(
  texte: string,
  attendue: NomListe,
  clePubliqueHex: string | null,
  versionAppliquee: string | null,
): Promise<ResultatVerification> {
  if (clePubliqueHex === null || !HEX_CLE.test(clePubliqueHex)) return { ok: false, code: 'cle' };
  if (new TextEncoder().encode(texte).length > TAILLE_MAX) return { ok: false, code: 'taille' };
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    return { ok: false, code: 'json' };
  }
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return { ok: false, code: 'format' };
  const o = brut as Record<string, unknown>;
  if (
    typeof o.liste !== 'string' ||
    typeof o.version !== 'string' || !VERSION.test(o.version) ||
    typeof o.genere_le !== 'string' ||
    typeof o.signature !== 'string' || !HEX_SIGNATURE.test(o.signature) ||
    !Array.isArray(o.entrees) || o.entrees.length > ENTREES_MAX
  ) {
    return { ok: false, code: 'format' };
  }
  if (o.liste !== attendue) return { ok: false, code: 'liste' };
  if (!o.entrees.every((e) => entreeValide(attendue, e))) return { ok: false, code: 'entree' };

  const octets = new TextEncoder().encode(`tmt-liste-v1\n${attendue}\n${JSON.stringify({ version: o.version, genere_le: o.genere_le, entrees: o.entrees })}`);
  let valide = false;
  try {
    const cle = await crypto.subtle.importKey('raw', hexVersOctets(clePubliqueHex), 'Ed25519', false, ['verify']);
    valide = await crypto.subtle.verify('Ed25519', cle, hexVersOctets(o.signature), octets);
  } catch {
    return { ok: false, code: 'cle' };
  }
  if (!valide) return { ok: false, code: 'signature' };
  if (versionAppliquee !== null && o.version === versionAppliquee) return { ok: false, code: 'identique' };
  if (versionAppliquee !== null && o.version < versionAppliquee) return { ok: false, code: 'retour-arriere' };

  const entrees = (o.entrees as Record<string, unknown>[]).map((e) => ({
    hote: e.hote as string,
    ...(typeof e.marque === 'string' ? { marque: e.marque } : {}),
    ...(e.statut === 'repertorie' ? { statut: 'repertorie' as const } : {}),
  }));
  return { ok: true, liste: { liste: attendue, version: o.version, genereLe: o.genere_le, entrees } };
}
