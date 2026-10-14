// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.11 (rang 1) : le bandeau N2, seul organe de sortie du palier de test
// puisque N3 y est éteint (14.5). Texte et structure validés avant code
// (14.11/14.12) : gabarit de 9.2 (ce qui est détecté / adresse réelle /
// action sûre en premier), adresse officielle = domainePrincipal (14.12,
// jamais un sous-domaine), fermeture sans condition. Aucun bouton n'éteint ni
// n'atténue l'alerte affichée (14.8 : une déclaration de l'usager ne ferme
// jamais l'alerte en cours). Le bouton « signaler ce site comme officiel » est
// absent parce que 14.10 n'est pas codé et qu'il n'aurait nulle part où
// envoyer (14.13 point 5) — pas parce que 14.8 l'interdirait ; il reviendra
// avec 14.10, sans jamais fermer ni atténuer le bandeau.
//
// Rendu dans une racine Shadow DOM fermée : la page hostile ne doit ni lire
// ni manipuler le contenu du bandeau via son propre script (6.5, même
// principe d'isolement que la collecte).
import { analyserHote } from '../moteur/domaine.js';
import type { EmpreinteMarque } from '../moteur/types.js';

const ID_HOTE = 'tourmentin-bandeau-n2';
/** 14.22 B : le bandeau de connexion est un second hôte de Tourmentin ; ses insertions et retraits sont aussi internes. */
export const ID_HOTE_CONNEXION = 'tourmentin-bandeau-connexion';
/** 14.37 point 4 : le bandeau rouge d'un site frauduleux signalé est un troisième hôte de Tourmentin. */
export const ID_HOTE_FRAUDULEUX = 'tourmentin-bandeau-frauduleux';
const IDS_INTERNES = new Set([ID_HOTE, ID_HOTE_CONNEXION, ID_HOTE_FRAUDULEUX]);

/** 14.12 : « et d'autres adresses » seulement si la marque a plusieurs domaines enregistrables distincts. */
export function adresseOfficielle(marque: EmpreinteMarque): { principal: string; aDautresDomaines: boolean } {
  const distincts = new Set(marque.domaines.map((d) => analyserHote(d).domaineEnregistrable));
  return { principal: marque.domainePrincipal, aDautresDomaines: distincts.size > 1 };
}

/**
 * Construit le contenu du bandeau dans une racine donnée (ouverte ou fermée
 * : cette fonction ne dépend que de l'API DOM commune aux deux). Exportée
 * séparément d'`afficherBandeauN2` pour être testable sur une racine
 * ouverte, sans dépendre du mode `closed` retenu en production (6.5).
 */
export function construireContenuBandeau(
  racine: ShadowRoot,
  marque: EmpreinteMarque,
  hoteReel: string,
  retirer: () => void,
  ouvrirAide: () => void = () => {},
): void {
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .bandeau {
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
      background: #fff4e5; border-bottom: 3px solid #E8A33D;
      font: 14px/1.5 system-ui, sans-serif; color: #1a1a1a;
      padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
    }
    .texte { flex: 1 1 320px; }
    .texte strong { display: block; margin-bottom: 4px; }
    .adresse { font-family: monospace; }
    .boutons { display: flex; gap: 8px; flex: 0 0 auto; }
    button { cursor: pointer; padding: 8px 14px; border-radius: 4px; border: 1px solid #999; font: inherit; }
    .officiel { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
    .aide { background: none; border: none; padding: 0; margin-top: 6px; color: #1a4fa0; text-decoration: underline; }
  `;

  const { principal, aDautresDomaines } = adresseOfficielle(marque);

  const bandeau = document.createElement('div');
  bandeau.className = 'bandeau';

  const texte = document.createElement('div');
  texte.className = 'texte';
  const titre = document.createElement('strong');
  titre.textContent = `Cette page ressemble au site ${marque.libelle}, mais son adresse est différente.`;
  const ligneReelle = document.createElement('div');
  ligneReelle.append('Adresse de cette page : ', spanAdresse(hoteReel));
  const ligneOfficielle = document.createElement('div');
  ligneOfficielle.append(
    `Adresse officielle de ${marque.libelle} : `,
    spanAdresse(principal),
    aDautresDomaines ? ' (et d\'autres adresses)' : '',
  );
  // 14.13 point 3 : « Comment vérifier une adresse ». Ne ferme rien, ne
  // navigue pas la page : ouvre la vue #verifier des options, dans un onglet.
  const aide = document.createElement('button');
  aide.className = 'aide';
  aide.textContent = 'Comment vérifier une adresse';
  aide.addEventListener('click', ouvrirAide);
  texte.append(titre, ligneReelle, ligneOfficielle, aide);

  const boutons = document.createElement('div');
  boutons.className = 'boutons';

  const boutonOfficiel = document.createElement('button');
  boutonOfficiel.className = 'officiel';
  boutonOfficiel.textContent = 'Aller sur le site officiel';
  boutonOfficiel.addEventListener('click', () => {
    window.open(`https://${principal}/`, '_blank', 'noopener,noreferrer');
  });

  const boutonFermer = document.createElement('button');
  // 14.13 point 2 : « Fermer ce message », pas « Rester ici et continuer » —
  // un libellé qui sonne comme une permission augmente le passage outre.
  boutonFermer.textContent = 'Fermer ce message';
  // Fermeture sans condition, rien d'autre. Aucune écriture, aucun ajout à une
  // exclusion, aucun effet sur une prochaine visite.
  boutonFermer.addEventListener('click', retirer);

  boutons.append(boutonOfficiel, boutonFermer);
  bandeau.append(texte, boutons);
  racine.append(style, bandeau);
}

function spanAdresse(texte: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'adresse';
  span.textContent = texte;
  return span;
}

// Ce que le bandeau affiche actuellement (marque + hôte). Une variable de
// module, pas un attribut du DOM : la page hostile ne doit pas pouvoir lire
// quelle marque a été détectée.
let cleAffichee: string | undefined;

/** Retire le bandeau s'il est affiché ; sans effet sinon. */
export function retirerBandeau(): void {
  document.getElementById(ID_HOTE)?.remove();
  cleAffichee = undefined;
}

/**
 * Vrai si toutes les mutations observées ne sont que l'insertion ou le
 * retrait de notre propre hôte. Sans ce filtre, afficher le bandeau modifie le
 * DOM, ce qui relance une analyse, qui réaffiche le bandeau : une boucle
 * (relevée en navigateur réel le 28/09/2026, ~9 réaffichages en 3 s), et un
 * bandeau fermé qui revient (14.15). Les mutations à l'intérieur de la
 * racine fermée ne sont pas vues d'un observateur placé sur le document.
 */
export function mutationsInternes(mutations: MutationRecord[]): boolean {
  if (mutations.length === 0) return false;
  return mutations.every((m) => {
    const noeuds = [...m.addedNodes, ...m.removedNodes];
    return noeuds.length > 0 && noeuds.every((n) => n.nodeType === 1 && IDS_INTERNES.has((n as Element).id));
  });
}

/**
 * Affiche le bandeau N2, en remplaçant un bandeau déjà affiché (jamais deux
 * empilés — 14.6 point b). `hoteReel` : l'hôte de la page au moment de
 * l'analyse qui a produit ce verdict, pas relu depuis `location` pour rester
 * cohérent avec ce qui a été effectivement soumis à `analyser()`.
 */
export function afficherBandeauN2(
  marque: EmpreinteMarque,
  hoteReel: string,
  ouvrirAide: () => void = () => {},
  surFermeture: () => void = () => {},
): void {
  const cle = `${marque.id}|${hoteReel}`;
  // Déjà affiché à l'identique : ne rien toucher au DOM (idempotent).
  if (cleAffichee === cle && document.getElementById(ID_HOTE)) return;
  retirerBandeau();
  const hote = document.createElement('div');
  hote.id = ID_HOTE;
  const racine = hote.attachShadow({ mode: 'closed' });
  construireContenuBandeau(racine, marque, hoteReel, () => { retirerBandeau(); surFermeture(); }, ouvrirAide);
  document.documentElement.append(hote);
  cleAffichee = cle;
}
