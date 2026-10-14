// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.19 A2, 14.26 : le SEUL endroit de l'extension qui émet une requête vers tourmentin.fr.
// Tout passe par appelerApi, qui refuse avant toute requête quand le réglage est « Ne jamais
// envoyer » — c'est ce qui rend vérifiable (test, et capture réseau en navigateur réel) qu'aucune
// requête ne part dans ce mode. Aucune autre fonction de ce dépôt n'appelle fetch vers cette adresse.
//
// Requêtes : POST JSON, sans cookie (credentials: 'omit'), sans cache, sans en-tête de référent.
export const API_BASE = 'https://tourmentin.fr/api/v1';
export const DELAI_REQUETE_MS = 10000;

export type ModeEnvoi = 'jamais' | 'demander' | 'automatique';
export const MODE_ENVOI_PAR_DEFAUT: ModeEnvoi = 'demander';
export const MODES_ENVOI: readonly ModeEnvoi[] = ['jamais', 'demander', 'automatique'];

export function estModeEnvoi(valeur: unknown): valeur is ModeEnvoi {
  return typeof valeur === 'string' && (MODES_ENVOI as readonly string[]).includes(valeur);
}

export class EnvoiDesactive extends Error {
  constructor() {
    super('envoi-desactive');
    this.name = 'EnvoiDesactive';
  }
}

export interface ReponseApi {
  statut: number;
  json: Record<string, unknown> | null;
}

export interface DependancesReseau {
  fetch: typeof fetch;
}

export async function appelerApi(
  mode: ModeEnvoi,
  chemin: string,
  corps: unknown,
  deps: DependancesReseau = { fetch: (...a) => globalThis.fetch(...a) },
): Promise<ReponseApi> {
  if (mode === 'jamais') throw new EnvoiDesactive();
  const controle = new AbortController();
  const minuteur = setTimeout(() => controle.abort(), DELAI_REQUETE_MS);
  try {
    const reponse = await deps.fetch(API_BASE + chemin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: controle.signal,
    });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await reponse.json()) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { statut: reponse.status, json };
  } finally {
    clearTimeout(minuteur);
  }
}
