// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Clé de signature des listes publiées (spec 14.33 C). La clé privée est écrite CHIFFRÉE (scrypt + AES-256-GCM)
// dans un fichier hors du dépôt ; la phrase de passe n'est ni affichée, ni écrite. Seule la clé publique sort.
// Fonctions pures de chiffrement ici ; la saisie de la phrase et les fichiers sont dans publier.ts / cle-cli.ts.
import { createCipheriv, createDecipheriv, createPrivateKey, generateKeyPairSync, randomBytes, scryptSync } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

export interface FichierCle {
  v: 1;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  sel: string;
  iv: string;
  tag: string;
  chiffre: string;
  /** Clé publique brute (32 octets, hexadécimal) : non secrète, lue sans phrase de passe. */
  publique: string;
}

const PARAMETRES = { N: 2 ** 15, r: 8, p: 1 };
const PKCS8_ED25519_PREFIXE = Buffer.from('302e020100300506032b657004220420', 'hex');

function deriver(phrase: string, sel: Buffer, p: { N: number; r: number; p: number }): Buffer {
  return scryptSync(phrase, sel, 32, { N: p.N, r: p.r, p: p.p, maxmem: 256 * 1024 * 1024 });
}

export function creerFichierCle(phrase: string, parametres = PARAMETRES): FichierCle {
  if (phrase.length < 12) throw new Error('la phrase de passe doit faire au moins 12 caractères');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const graine = Buffer.from(privateKey.export({ format: 'der', type: 'pkcs8' })).subarray(PKCS8_ED25519_PREFIXE.length);
  const publique = Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url').toString('hex');
  const sel = randomBytes(16);
  const iv = randomBytes(12);
  const chiffreur = createCipheriv('aes-256-gcm', deriver(phrase, sel, parametres), iv);
  const chiffre = Buffer.concat([chiffreur.update(graine), chiffreur.final()]);
  return { v: 1, kdf: 'scrypt', ...parametres, sel: sel.toString('hex'), iv: iv.toString('hex'), tag: chiffreur.getAuthTag().toString('hex'), chiffre: chiffre.toString('hex'), publique };
}

/** Déchiffre et rend la clé privée ; une mauvaise phrase de passe lève une erreur sans rien révéler. */
export function lireClePrivee(fichier: FichierCle, phrase: string): KeyObject {
  try {
    const dechiffreur = createDecipheriv('aes-256-gcm', deriver(phrase, Buffer.from(fichier.sel, 'hex'), fichier), Buffer.from(fichier.iv, 'hex'));
    dechiffreur.setAuthTag(Buffer.from(fichier.tag, 'hex'));
    const graine = Buffer.concat([dechiffreur.update(Buffer.from(fichier.chiffre, 'hex')), dechiffreur.final()]);
    return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIXE, graine]), format: 'der', type: 'pkcs8' });
  } catch {
    throw new Error('phrase de passe incorrecte ou fichier de clé altéré');
  }
}
