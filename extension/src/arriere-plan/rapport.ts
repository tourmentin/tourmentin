// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.19 B, 14.28 B : le corps d'une déclaration envoyée à tourmentin.fr. Fonction pure : elle ne
// reçoit QUE ce qui peut partir — l'adresse (jamais la requête ni le fragment), le verdict, le
// texte visible déjà nettoyé, des adresses d'images. Elle n'a aucun accès au DOM, donc aucune
// valeur de champ de formulaire ne peut s'y glisser (le texte visible vient de
// construireEntreeAnalyse, dont le test dom.test.ts garantit qu'il ne porte aucune valeur saisie).
import type { NiveauAlerte, SignalDeclenche, Verdict } from '../moteur/types.js';
import { nettoyerTexte } from './nettoyage.js';
import type { TypeDeclaration } from './signalements.js';

export const LIMITE_TEXTES = 20000;
export const LIMITE_SIGNAUX = 40;
export const LIMITE_IMAGES = 20;

export interface RapportDeclaration {
  v: 1;
  type: TypeDeclaration;
  marque?: string;
  hote: string;
  chemin: string;
  paiement: boolean;
  niveau: NiveauAlerte;
  signaux: { code: string; poids: number; detail: string }[];
  textes?: string;
  images?: { url: string }[];
  horodatage: string;
  version_extension?: string;
}

function chemin(url: URL): string {
  // Jamais de chaîne de requête ni de fragment (14.3 point 2) ; nettoyé comme le texte (un chemin peut porter une adresse e-mail).
  const c = nettoyerTexte(url.pathname || '/');
  return c.length > 512 ? c.slice(0, 512) : c;
}

function signalDe(s: SignalDeclenche): { code: string; poids: number; detail: string } {
  const poids = Math.max(-200, Math.min(200, Math.trunc(Number.isFinite(s.poids) ? s.poids : 0)));
  const detail = nettoyerTexte(s.detail.replace(/[\u0000-\u001F\u007F]/g, ' ')).slice(0, 200);
  return { code: s.code, poids, detail };
}

/** Adresses d'images sans requête ni fragment, http(s) seulement, uniques, au plus 20. */
export function adressesImages(brutes: string[]): { url: string }[] {
  const vues = new Set<string>();
  const sortie: { url: string }[] = [];
  for (const brute of brutes) {
    let u: URL;
    try {
      u = new URL(brute);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue; // data:, blob: = du contenu
    const adresse = nettoyerTexte(`${u.protocol}//${u.host}${u.pathname}`);
    if (adresse.length > 512 || vues.has(adresse)) continue;
    vues.add(adresse);
    sortie.push({ url: adresse });
    if (sortie.length >= LIMITE_IMAGES) break;
  }
  return sortie;
}

export function construireRapport(args: {
  type: TypeDeclaration;
  href: string;
  verdict: Verdict;
  textes?: string;
  images?: string[];
  versionExtension?: string;
  maintenant?: Date;
}): RapportDeclaration {
  const url = new URL(args.href);
  const { verdict } = args;
  const signauxBruts = [...(verdict.signauxImitation ?? []), ...(verdict.signauxExposition ?? [])];
  const rapport: RapportDeclaration = {
    v: 1,
    type: args.type,
    hote: url.hostname.toLowerCase(),
    chemin: chemin(url),
    paiement: (verdict.signauxExposition ?? []).some((s) => s.famille === 'paiement'),
    niveau: verdict.niveau,
    signaux: signauxBruts.slice(0, LIMITE_SIGNAUX).map(signalDe),
    horodatage: (args.maintenant ?? new Date()).toISOString(),
  };
  if (verdict.marqueDetectee && /^[a-z0-9][a-z0-9-]{0,63}$/.test(verdict.marqueDetectee)) rapport.marque = verdict.marqueDetectee;
  if (args.textes !== undefined && args.textes !== '') rapport.textes = nettoyerTexte(args.textes).slice(0, LIMITE_TEXTES);
  if (args.images !== undefined && args.images.length > 0) rapport.images = adressesImages(args.images);
  if (args.versionExtension) rapport.version_extension = args.versionExtension.slice(0, 32);
  return rapport;
}
