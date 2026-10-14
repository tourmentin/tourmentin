// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.33 F : téléchargement, vérification et conservation des listes signées. C'est, avec reseau.ts, l'autre
// seul endroit de l'extension qui émet une requête (CLAUDE.md règle 2), et il se justifie ligne par ligne :
//   - méthode GET, sur `URL_PUBLICATION + « officiels.json » | « frauduleux.json »` : une adresse fixée à la
//     construction, sans paramètre ;
//   - credentials 'omit' (aucun cookie), referrerPolicy 'no-referrer' (aucun référent), aucun en-tête ajouté,
//     aucun corps ; ni URL visitée, ni contenu de page, ni saisie, ni identifiant d'installation ;
//   - l'hôte des listes voit une adresse IP et un agent navigateur, rien d'autre ;
//   - indépendant du réglage d'envoi : il gouverne ce qui part DE l'utilisateur ; ce GET n'emporte rien de lui.
// Sans adresse de publication (builds d'aujourd'hui), rien n'est téléchargé et aucune alarme n'existe.
// Stateless (règle 7) : tout l'état est dans chrome.storage.local.
import type { Listes } from '../moteur/types.js';
import { construireListes } from '../listes/chargement.js';
import { listesAvecPublication, type EtatPublication } from '../listes/publication.js';
import { verifierListeSignee, type NomListe } from '../listes/verification.js';
import { CLE_PUBLIQUE_LISTES, URL_PUBLICATION } from '../version-publication.js';

const CLE_STOCKAGE = 'listes_signees';
export const NOM_ALARME = 'listes-signees';
const NOMS: NomListe[] = ['officiels', 'frauduleux'];

export async function lireEtatPublication(): Promise<EtatPublication> {
  try {
    const r = await chrome.storage.local.get(CLE_STOCKAGE);
    const v = r[CLE_STOCKAGE];
    return typeof v === 'object' && v !== null ? (v as EtatPublication) : {};
  } catch {
    return {};
  }
}

/** Listes du moteur : socle embarqué + hôtes officiels signés et vérifiés. */
export async function listesCourantes(): Promise<Listes> {
  return listesAvecPublication(construireListes(), await lireEtatPublication());
}

async function telecharger(nom: NomListe): Promise<string | null> {
  try {
    const r = await fetch(`${URL_PUBLICATION}${nom}.json`, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    const taille = Number(r.headers.get('content-length') ?? '0');
    if (taille > 2_000_000) return null;
    return await r.text();
  } catch {
    return null;
  }
}

/** Une passe : les deux listes, l'une après l'autre. Une liste invalide laisse la précédente en place (7.10). */
export async function actualiserListesSignees(): Promise<void> {
  if (URL_PUBLICATION === '') return;
  for (const nom of NOMS) {
    const etat = await lireEtatPublication();
    const texte = await telecharger(nom);
    const rejets = { ...etat.rejets };
    const verifieLe = { ...etat.verifieLe };
    let suivant: EtatPublication = etat;
    if (texte === null) {
      rejets[nom] = 'reseau';
    } else {
      const r = await verifierListeSignee(texte, nom, CLE_PUBLIQUE_LISTES, etat[nom]?.version ?? null);
      if (r.ok) {
        suivant = { ...etat, [nom]: r.liste };
        delete rejets[nom];
        verifieLe[nom] = new Date().toISOString();
      } else if (r.code === 'identique') {
        delete rejets[nom];
        verifieLe[nom] = new Date().toISOString();
      } else {
        rejets[nom] = r.code;
      }
    }
    await chrome.storage.local.set({ [CLE_STOCKAGE]: { ...suivant, rejets, verifieLe } satisfies EtatPublication });
  }
}

/** Toutes les heures (14.20 F, cadence de revocation.json) ; recréée à chaque démarrage, une alarme ne survivant pas toujours au navigateur. */
export function planifierActualisation(): void {
  if (URL_PUBLICATION === '') return;
  chrome.alarms.create(NOM_ALARME, { delayInMinutes: 1, periodInMinutes: 60 });
  void actualiserListesSignees();
}
