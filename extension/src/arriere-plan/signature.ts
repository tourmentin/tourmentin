// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.19 C, 14.26 A (clé d'installation) : paire Ed25519 de l'installation, WebCrypto. La clé
// privée est NON EXPORTABLE : même un code qui lit le stockage ne peut pas la sortir (règle 3 de
// CLAUDE.md : aucun secret en clair sur disque). Disponible à partir de Chrome 137.
//
// Format des signatures, identique à celui que le serveur vérifie (14.28 B) : la signature porte
// sur « <domaine>\n<corps> » en UTF-8, où <corps> est la chaîne JSON envoyée telle quelle (aucune
// canonicalisation). Le domaine sépare les usages : une signature de déclaration ne vaut jamais pour
// une action.

export type DomaineSignature = 'tmt-declaration-v1' | 'tmt-liaison-v1' | 'tmt-action-v1' | 'tmt-enregistrement-v1';

export function versBase64Url(octets: ArrayBuffer | Uint8Array): string {
  const u = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  let binaire = '';
  for (const o of u) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface PaireInstallation {
  privee: CryptoKey;
  publique: CryptoKey;
}

export async function genererPaire(): Promise<PaireInstallation> {
  // extractable = false : s'applique à la clé privée ; la clé publique reste exportable.
  const paire = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
  return { privee: paire.privateKey, publique: paire.publicKey };
}

export async function clePubliqueBase64Url(publique: CryptoKey): Promise<string> {
  return versBase64Url(await crypto.subtle.exportKey('raw', publique));
}

/** Identifiant de l'installation : empreinte SHA-256 de la clé publique brute, en base64url (le serveur calcule la même). */
export async function identifiantInstallation(publique: CryptoKey): Promise<string> {
  const brute = await crypto.subtle.exportKey('raw', publique);
  return versBase64Url(await crypto.subtle.digest('SHA-256', brute));
}

export async function signer(privee: CryptoKey, domaine: DomaineSignature, texte: string): Promise<string> {
  const signature = await crypto.subtle.sign('Ed25519', privee, new TextEncoder().encode(`${domaine}\n${texte}`));
  return versBase64Url(signature);
}

/** Preuve de possession à l'enregistrement : la clé signe « <clé publique>\n<horodatage> ». */
export async function preuveEnregistrement(privee: CryptoKey, clePublique: string, horodatage: string): Promise<string> {
  return signer(privee, 'tmt-enregistrement-v1', `${clePublique}\n${horodatage}`);
}
