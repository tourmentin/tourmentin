// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.43 : dialogue des pages (popup, options) avec le service worker. Une réponse vide ou inattendue n'est plus lue comme un
// objet : elle devient une erreur typée, et un texte clair pour l'utilisateur. Cause constatée des erreurs « Cannot read
// properties of undefined (reading 'lie' / 'ok') » : un service worker qui ne répond pas comme la page l'attend (page plus
// récente que le service worker en cours d'exécution, ou service worker en échec) ; les pages lisaient la réponse sans la tester.
import type { MessageDepuisArrierePlan, MessageDepuisContenu } from '../messages.js';
import { BUILD_ID } from '../version-build.js';

export const TEXTE_SW_MUET = 'Tourmentin ne reçoit pas de réponse de son service interne. Ouvrez chrome://extensions, cliquez sur ↻ sur la carte de Tourmentin, puis rouvrez cette fenêtre.';
export const TEXTE_SW_PAS_RECHARGE = 'Tourmentin vient d\'être mis à jour mais n\'a pas été rechargé. Ouvrez chrome://extensions, cliquez sur ↻ sur la carte de Tourmentin, puis rouvrez cette fenêtre.';

export type RaisonEchecSW = 'muet' | 'inconnu' | 'erreur';

export class ErreurSW extends Error {
  constructor(public readonly raison: RaisonEchecSW) {
    super(`service-worker-${raison}`);
    this.name = 'ErreurSW';
  }
}

/** Texte à montrer à l'utilisateur pour une erreur de dialogue ; jamais le détail technique. */
export function texteErreur(e: unknown): string {
  return e instanceof ErreurSW && e.raison === 'inconnu' ? TEXTE_SW_PAS_RECHARGE : TEXTE_SW_MUET;
}

type Transport = (message: MessageDepuisContenu) => Promise<unknown>;
const transportParDefaut: Transport = (message) => chrome.runtime.sendMessage(message);

/**
 * Envoie `message` et rend la réponse SI son type est `attendu`. Une réponse absente, un rejet ou une erreur du service worker
 * donnent un nouvel essai (un service worker qui démarre peut manquer le premier message) ; « INCONNU » (le service worker
 * ne connaît pas ce message) n'en donne pas : refaire ne changerait rien.
 */
export async function demander<T extends MessageDepuisArrierePlan['type']>(
  message: MessageDepuisContenu,
  attendu: T,
  options: { essais?: number; pauseMs?: number; delaiMs?: number; transport?: Transport } = {},
): Promise<Extract<MessageDepuisArrierePlan, { type: T }>> {
  const { essais = 2, pauseMs = 400, delaiMs = 3000, transport = transportParDefaut } = options;
  let raison: RaisonEchecSW = 'muet';
  for (let i = 0; i < essais; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, pauseMs));
    let reponse: unknown;
    try {
      // un service worker qui ne répond jamais ne fige pas la page : au-delà de `delaiMs`, c'est « muet »
      reponse = await Promise.race([transport(message), new Promise<undefined>((r) => setTimeout(() => r(undefined), delaiMs))]);
    } catch {
      raison = 'muet';
      continue;
    }
    const type = typeof reponse === 'object' && reponse !== null ? (reponse as { type?: unknown }).type : undefined;
    if (type === attendu) return reponse as Extract<MessageDepuisArrierePlan, { type: T }>;
    if (type === 'INCONNU') throw new ErreurSW('inconnu');
    raison = type === 'ERREUR_SW' ? 'erreur' : 'muet';
  }
  throw new ErreurSW(raison);
}

/** Vérifie, à l'ouverture d'une page, que le service worker répond ET qu'il est de la même construction que la page. */
export async function verifierService(options: { transport?: Transport; buildAttendu?: string } = {}): Promise<{ ok: true } | { ok: false; texte: string }> {
  try {
    const r = await demander({ type: 'LIRE_VERSION' }, 'VERSION', options.transport ? { transport: options.transport } : {});
    return r.build === (options.buildAttendu ?? BUILD_ID) ? { ok: true } : { ok: false, texte: TEXTE_SW_PAS_RECHARGE };
  } catch (e) {
    return { ok: false, texte: texteErreur(e) };
  }
}
