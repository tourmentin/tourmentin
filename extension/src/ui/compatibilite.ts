// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.48 : auto-vérification des fonctions dont l'extension dépend et que les navigateurs ne gèrent pas tous de la même façon. Affichée dans
// la page des paramètres : un testeur (et un autre navigateur) voit tout de suite ce qui ne fonctionnera pas chez lui. Aucune requête,
// aucune donnée réelle : la paire de clés d'essai vit dans une base jetable, supprimée aussitôt.
export interface ResultatVerification {
  ok: boolean;
  texte: string;
  /** Étape et nom de l'erreur, pour le support (jamais de donnée de l'utilisateur). */
  detail?: string;
}

export const TEXTE_ED25519_OK = 'fonctionne (clé privée non exportable, rangée dans le navigateur)';
export const TEXTE_ED25519_KO = 'ne fonctionne pas dans ce navigateur : l\'envoi à tourmentin.fr n\'y sera pas possible, les listes signées non plus';

/** Signature Ed25519 (WebCrypto) avec clé non exportable conservée dans IndexedDB : ce que la liaison, les déclarations et les listes exigent. */
export async function verifierEd25519(): Promise<ResultatVerification> {
  const nomBase = `tmt-compat-${Math.random().toString(36).slice(2)}`;
  let etape = 'génération de la clé';
  try {
    const paire = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
    let exportable = true;
    try {
      await crypto.subtle.exportKey('pkcs8', paire.privateKey);
    } catch {
      exportable = false;
    }
    etape = "ouverture d'IndexedDB";
    const db = await new Promise<IDBDatabase>((ok, ko) => {
      const r = indexedDB.open(nomBase, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('k');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    try {
      etape = 'enregistrement de la clé dans IndexedDB';
      await new Promise<void>((ok, ko) => {
        const t = db.transaction('k', 'readwrite');
        t.objectStore('k').put(paire, 'p');
        t.oncomplete = () => ok();
        t.onerror = () => ko(t.error);
      });
      etape = 'relecture de la clé';
      const relue = await new Promise<CryptoKeyPair>((ok, ko) => {
        const r = db.transaction('k').objectStore('k').get('p');
        r.onsuccess = () => ok(r.result as CryptoKeyPair);
        r.onerror = () => ko(r.error);
      });
      etape = 'signature';
      const donnees = new TextEncoder().encode('verification');
      const signature = await crypto.subtle.sign('Ed25519', relue.privateKey, donnees);
      const valide = signature.byteLength === 64 && (await crypto.subtle.verify('Ed25519', relue.publicKey, signature, donnees));
      return exportable || !valide ? { ok: false, texte: TEXTE_ED25519_KO, detail: `clé exportable : ${exportable} ; signature valide : ${valide}` } : { ok: true, texte: TEXTE_ED25519_OK };
    } finally {
      db.close();
      indexedDB.deleteDatabase(nomBase);
    }
  } catch (e) {
    return { ok: false, texte: TEXTE_ED25519_KO, detail: `${etape} : ${e instanceof Error ? e.name : 'erreur'}` };
  }
}
