// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lot L2, livrable 3 : vérification de signature. Exportée pour être
// réutilisée par l'extension au lot L9 (téléchargement des listes) — fonction
// pure, aucun accès disque ni réseau, pour rester appelable depuis le service
// worker sans adaptation.
import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519.js';
import { estAppeleDirectement } from './cli.ts';
import { donneesSignables } from './canonique.ts';
import type { ListeSocleSignee } from './signer.ts';

function decoderHex(hex: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/**
 * Vérifie qu'une liste a bien été signée par la clé publique donnée. Ne lève
 * jamais : une entrée mal formée (signature absente, hex invalide) est un cas
 * normal d'appel — un fichier corrompu ou une liste non signée — et retourne
 * simplement `false`, pas une exception à traiter par l'appelant.
 */
export function verifierSignature(objet: unknown, clePubliqueHex: string): boolean {
  if (typeof objet !== 'object' || objet === null || !('signature' in objet)) return false;
  const { signature, ...reste } = objet as ListeSocleSignee;
  if (typeof signature !== 'string') return false;

  const signatureOctets = decoderHex(signature);
  const clePubliqueOctets = decoderHex(clePubliqueHex);
  if (!signatureOctets || !clePubliqueOctets) return false;

  try {
    return ed25519.verify(signatureOctets, donneesSignables(reste), clePubliqueOctets);
  } catch {
    return false;
  }
}

/* v8 ignore start -- exécuté dans un sous-processus par cli-integration.test.ts (node outils/verifier.ts) ;
   la couverture v8 ne voit que le process courant, pas les enfants. Comportement vérifié par ce test, pas par ce rapport. */
if (estAppeleDirectement(import.meta.url)) {
  const [cheminListe, clePubliqueHex] = process.argv.slice(2);
  if (!cheminListe || !clePubliqueHex) {
    console.error('Usage : node outils/verifier.ts <socle.signe.json> <cle-publique-hex>');
    process.exit(1);
  }
  const objet = JSON.parse(readFileSync(cheminListe, 'utf8'));
  const valide = verifierSignature(objet, clePubliqueHex);
  console.log(valide ? 'Signature valide.' : 'Signature INVALIDE.');
  process.exit(valide ? 0 : 1);
}
/* v8 ignore stop */
