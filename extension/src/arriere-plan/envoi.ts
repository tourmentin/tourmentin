// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.26 étape 3 : tout ce qui part vers tourmentin.fr — enregistrement de l'installation, déclarations,
// liaison de compte, actions de rôle. Chaque appel reçoit le réglage d'envoi et passe par appelerApi
// (reseau.ts), qui refuse avant toute requête si le réglage est « Ne jamais envoyer ».
//
// Une seule clé par installation (Ed25519, non exportable, dans IndexedDB). Le rôle n'est JAMAIS
// décidé ici : le serveur le vérifie à chaque action ; ce que l'extension en garde n'est qu'une
// mémoire de 15 minutes pour afficher ou non les boutons de rôle.
import type { RapportDeclaration } from './rapport.js';
import { appelerApi, type ModeEnvoi, type ReponseApi } from './reseau.js';
import {
  clePubliqueBase64Url, genererPaire, identifiantInstallation, preuveEnregistrement, signer, type DomaineSignature, type PaireInstallation,
} from './signature.js';

export type Role = 'utilisateur' | 'confiance' | 'super';

interface EtatInstallation {
  id: string;
  enregistre: boolean;
  lie: boolean;
  role?: Role;
  roleVerifieLe?: number;
}

const DUREE_MEMOIRE_ROLE_MS = 15 * 60 * 1000;

// ------------------------------------------------------------------ stockage de la clé (IndexedDB)

function ouvrirBase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const demande = indexedDB.open('tourmentin', 1);
    demande.onupgradeneeded = () => demande.result.createObjectStore('cles');
    demande.onsuccess = () => resolve(demande.result);
    demande.onerror = () => reject(demande.error);
  });
}

async function lireCle(): Promise<(PaireInstallation & { cleBrute: string }) | undefined> {
  const base = await ouvrirBase();
  return new Promise((resolve, reject) => {
    const r = base.transaction('cles').objectStore('cles').get('installation');
    r.onsuccess = () => resolve(r.result as (PaireInstallation & { cleBrute: string }) | undefined);
    r.onerror = () => reject(r.error);
  });
}

async function ecrireCle(valeur: PaireInstallation & { cleBrute: string }): Promise<void> {
  const base = await ouvrirBase();
  return new Promise((resolve, reject) => {
    const t = base.transaction('cles', 'readwrite');
    t.objectStore('cles').put(valeur, 'installation');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

async function effacerCle(): Promise<void> {
  const base = await ouvrirBase();
  return new Promise((resolve, reject) => {
    const t = base.transaction('cles', 'readwrite');
    t.objectStore('cles').delete('installation');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

async function lireEtat(): Promise<EtatInstallation | undefined> {
  return ((await chrome.storage.local.get('installation')).installation as EtatInstallation | undefined) ?? undefined;
}

async function ecrireEtat(etat: EtatInstallation): Promise<void> {
  await chrome.storage.local.set({ installation: etat });
}

// ------------------------------------------------------------------ installation

/** Crée la paire de clés si elle n'existe pas (aucune requête). */
async function paireInstallation(): Promise<{ paire: PaireInstallation; cleBrute: string; id: string }> {
  let stockee = await lireCle();
  if (!stockee) {
    const paire = await genererPaire();
    stockee = { ...paire, cleBrute: await clePubliqueBase64Url(paire.publique) };
    await ecrireCle(stockee);
    await ecrireEtat({ id: await identifiantInstallation(paire.publique), enregistre: false, lie: false });
  }
  const etat = await lireEtat();
  const id = etat?.id ?? (await identifiantInstallation(stockee.publique));
  return { paire: { privee: stockee.privee, publique: stockee.publique }, cleBrute: stockee.cleBrute, id };
}

async function enregistrerSiBesoin(mode: ModeEnvoi, force = false): Promise<{ paire: PaireInstallation; id: string }> {
  const { paire, cleBrute, id } = await paireInstallation();
  const etat = (await lireEtat()) ?? { id, enregistre: false, lie: false };
  if (!etat.enregistre || force) {
    const horodatage = new Date().toISOString();
    const reponse = await appelerApi(mode, '/installations', {
      cle_publique: cleBrute,
      horodatage,
      preuve: await preuveEnregistrement(paire.privee, cleBrute, horodatage),
    });
    if (reponse.statut !== 200 && reponse.statut !== 201) throw new ErreurApi(reponse);
    await ecrireEtat({ ...etat, id, enregistre: true });
  }
  return { paire, id };
}

export class ErreurApi extends Error {
  constructor(public readonly reponse: ReponseApi) {
    super(typeof reponse.json?.erreur === 'string' ? reponse.json.erreur : `http-${reponse.statut}`);
    this.name = 'ErreurApi';
  }
}

async function envoyerSigne(mode: ModeEnvoi, chemin: string, domaine: DomaineSignature, corps: unknown): Promise<ReponseApi> {
  for (let tentative = 0; tentative < 2; tentative++) {
    const { paire, id } = await enregistrerSiBesoin(mode, tentative === 1);
    const texte = JSON.stringify(corps);
    const reponse = await appelerApi(mode, chemin, { installation: id, corps: texte, signature: await signer(paire.privee, domaine, texte) });
    // Le serveur ne connaît plus cette installation (base restaurée) : on la ré-enregistre une fois.
    if (reponse.statut === 401 && reponse.json?.erreur === 'installation_inconnue' && tentative === 0) continue;
    return reponse;
  }
  throw new Error('envoi-impossible');
}

function raison(e: unknown): string {
  if (e instanceof ErreurApi) return e.message;
  if (e instanceof Error) return e.name === 'EnvoiDesactive' ? 'envoi-desactive' : e.name === 'AbortError' ? 'delai-depasse' : 'reseau';
  return 'reseau';
}

// ------------------------------------------------------------------ opérations

export async function envoyerDeclaration(mode: ModeEnvoi, rapport: RapportDeclaration): Promise<{ ok: boolean; erreur?: string }> {
  try {
    const r = await envoyerSigne(mode, '/declarations', 'tmt-declaration-v1', rapport);
    return r.statut === 201 ? { ok: true } : { ok: false, erreur: typeof r.json?.erreur === 'string' ? r.json.erreur : `http-${r.statut}` };
  } catch (e) {
    return { ok: false, erreur: raison(e) };
  }
}

export async function lierCompte(mode: ModeEnvoi, code: string): Promise<{ ok: boolean; role?: Role; erreur?: string }> {
  try {
    const r = await envoyerSigne(mode, '/liaison', 'tmt-liaison-v1', { v: 1, code, horodatage: new Date().toISOString() });
    if (r.statut === 200 && typeof r.json?.role === 'string') {
      const { id } = await paireInstallation();
      await ecrireEtat({ id, enregistre: true, lie: true, role: r.json.role as Role, roleVerifieLe: Date.now() });
      return { ok: true, role: r.json.role as Role };
    }
    return { ok: false, erreur: typeof r.json?.erreur === 'string' ? r.json.erreur : `http-${r.statut}` };
  } catch (e) {
    return { ok: false, erreur: raison(e) };
  }
}

/**
 * Rôle du compte lié, tel que le SERVEUR le dit. Mémoire de 15 minutes seulement (le serveur limite les
 * actions) ; `forcer` ou une action refusée l'efface. Sans réponse du serveur : aucun rôle, donc aucun bouton.
 */
export async function lireRole(mode: ModeEnvoi, forcer = false): Promise<{ lie: boolean; role: Role | null }> {
  if (mode === 'jamais') return { lie: false, role: null };
  const etat = await lireEtat();
  if (!etat?.lie) return { lie: false, role: null };
  if (!forcer && etat.role && etat.roleVerifieLe && Date.now() - etat.roleVerifieLe < DUREE_MEMOIRE_ROLE_MS) return { lie: true, role: etat.role };
  try {
    const r = await envoyerSigne(mode, '/actions', 'tmt-action-v1', { v: 1, action: 'role', horodatage: new Date().toISOString() });
    if (r.statut === 200 && typeof r.json?.role === 'string') {
      await ecrireEtat({ ...etat, role: r.json.role as Role, roleVerifieLe: Date.now() });
      return { lie: true, role: r.json.role as Role };
    }
    if (r.statut === 403) await ecrireEtat({ ...etat, lie: r.json?.erreur !== 'non_lie' && etat.lie, role: undefined, roleVerifieLe: undefined });
  } catch {
    // injoignable : pas de rôle affiché, jamais un rôle périmé présenté comme sûr
  }
  return { lie: true, role: null };
}

export type ActionRole = 'valider_officiel' | 'confirmer_frauduleux';

export async function actionRole(
  mode: ModeEnvoi,
  action: ActionRole,
  cible: { hote: string; marque?: string; paiement: boolean },
): Promise<{ ok: boolean; erreur?: string }> {
  try {
    const corps: Record<string, unknown> = { v: 1, action, hote: cible.hote, paiement: cible.paiement, horodatage: new Date().toISOString() };
    if (cible.marque) corps.marque = cible.marque;
    const r = await envoyerSigne(mode, '/actions', 'tmt-action-v1', corps);
    if (r.statut === 200) return { ok: true };
    if (r.statut === 403) {
      const etat = await lireEtat();
      if (etat) await ecrireEtat({ ...etat, role: undefined, roleVerifieLe: undefined });
    }
    return { ok: false, erreur: typeof r.json?.erreur === 'string' ? r.json.erreur : `http-${r.statut}` };
  } catch (e) {
    return { ok: false, erreur: raison(e) };
  }
}

/** Oublie la clé et la liaison de cette installation (aucune requête). Le serveur garde l'ancienne entrée. */
export async function delierInstallation(): Promise<void> {
  await effacerCle();
  await chrome.storage.local.remove('installation');
}

export async function etatLiaison(): Promise<{ lie: boolean; role: Role | null }> {
  const etat = await lireEtat();
  return { lie: !!etat?.lie, role: etat?.role ?? null };
}
