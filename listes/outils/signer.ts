// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lot L2, livrable 2 : signature Ed25519 d'une liste générée par generer.ts.
// @noble/curves plutôt qu'une dépendance native : pur JS/WASM-free, portable,
// pas de compilation à l'installation — pertinent pour un outil de publication
// exécuté en CI comme en local.
import { readFileSync, writeFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519.js';
import { estAppeleDirectement } from './cli.ts';
import { donneesSignables, type ListeSocle } from './canonique.ts';

export interface ListeSocleSignee extends ListeSocle {
  signature: string;
}

const VARIABLE_CLE_PRIVEE = 'TOURMENTIN_CLE_PRIVEE_SOCLE';

function decoderHex(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${VARIABLE_CLE_PRIVEE} doit être une clé Ed25519 de 32 octets en hexadécimal (64 caractères).`);
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/** Fonction pure : ne lit ni l'environnement ni le disque, ne journalise rien. Testable sans clé réelle sur disque. */
export function signerListe(liste: ListeSocle, clePrivee: Uint8Array): ListeSocleSignee {
  const signature = ed25519.sign(donneesSignables(liste), clePrivee);
  return { ...liste, signature: Buffer.from(signature).toString('hex') };
}

export function lireClePriveeDepuisEnv(env: NodeJS.ProcessEnv = process.env): Uint8Array {
  const hex = env[VARIABLE_CLE_PRIVEE];
  if (!hex) {
    throw new Error(`Variable d'environnement ${VARIABLE_CLE_PRIVEE} absente : impossible de signer.`);
  }
  return decoderHex(hex);
}

/* v8 ignore start -- exécuté dans un sous-processus par cli-integration.test.ts (node outils/signer.ts) ;
   la couverture v8 ne voit que le process courant, pas les enfants. Comportement vérifié par ce test, pas par ce rapport. */
if (estAppeleDirectement(import.meta.url)) {
  const [cheminEntree, cheminSortie] = process.argv.slice(2);
  if (!cheminEntree || !cheminSortie) {
    console.error('Usage : node outils/signer.ts <socle.json> <socle.signe.json>');
    process.exit(1);
  }
  const liste = JSON.parse(readFileSync(cheminEntree, 'utf8')) as ListeSocle;
  const signee = signerListe(liste, lireClePriveeDepuisEnv());
  writeFileSync(cheminSortie, `${JSON.stringify(signee, null, 2)}\n`, 'utf8');
  console.log(`Liste signée écrite dans ${cheminSortie}.`);
}
/* v8 ignore stop */
