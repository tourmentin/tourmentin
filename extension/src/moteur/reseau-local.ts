// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.67 : adresses du réseau local, exclues de toute analyse (routeur, imprimante, intranet : jamais un site d'hameçonnage à protéger,
// et une page de connexion d'équipement n'a pas à recevoir un bandeau). Fonction pure : aucune API navigateur.
// Restent analysés, sans exception : les adresses IP publiques et les fichiers ouverts depuis le disque (hôte vide).

const SUFFIXES_LOCAUX = ['.local', '.lan', '.home.arpa', '.internal'];

/** Quatre nombres décimaux de 0 à 255 sans zéro initial (un nom comme « 192.168.0.250.exemple.com » n'est pas une adresse). */
function octetsIPv4(hote: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hote);
  if (!m) return null;
  const octets = m.slice(1).map((t) => (t.length > 1 && t.startsWith('0') ? Number.NaN : Number(t)));
  return octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255) ? octets : null;
}

function ipv4Locale([a, b]: number[]): boolean {
  return (
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8
    (a === 172 && b! >= 16 && b! <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 169 && b === 254) // 169.254.0.0/16
  );
}

/** Huit groupes de 16 bits d'une adresse IPv6 (forme compressée « :: » admise), ou null. Sans crochets. */
function groupesIPv6(texte: string): number[] | null {
  if (!/^[0-9a-f:]+$/.test(texte) || texte.includes(':::')) return null;
  const moitiés = texte.split('::');
  if (moitiés.length > 2) return null;
  const lire = (s: string): number[] | null => {
    if (s === '') return [];
    const g = s.split(':');
    if (g.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
    return g.map((x) => parseInt(x, 16));
  };
  const tete = lire(moitiés[0]!);
  const queue = moitiés.length === 2 ? lire(moitiés[1]!) : [];
  if (tete === null || queue === null) return null;
  if (moitiés.length === 1) return tete.length === 8 ? tete : null;
  const manquants = 8 - tete.length - queue.length;
  if (manquants < 1) return null;
  return [...tete, ...Array<number>(manquants).fill(0), ...queue];
}

function ipv6Locale(g: number[]): boolean {
  const boucle = g.slice(0, 7).every((x) => x === 0) && g[7] === 1; // ::1
  return boucle || (g[0]! & 0xfe00) === 0xfc00 /* fc00::/7 */ || (g[0]! & 0xffc0) === 0xfe80; /* fe80::/10 */
}

/**
 * L'hôte (tel que le navigateur le donne : minuscules, IPv6 avec ou sans crochets) est-il une adresse du réseau local ?
 * Un hôte vide (fichier local, `file://`) n'en est PAS une : il reste analysé.
 */
export function estAdresseReseauLocal(hote: string): boolean {
  let h = hote.trim().toLowerCase();
  if (h === '') return false;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.includes(':')) {
    const g = groupesIPv6(h);
    return g !== null && ipv6Locale(g);
  }
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h === '') return false;
  const octets = octetsIPv4(h);
  if (octets !== null) return ipv4Locale(octets);
  if (h === 'localhost') return true;
  if (SUFFIXES_LOCAUX.some((s) => h.endsWith(s))) return true;
  return !h.includes('.'); // nom sans point : intranet
}
