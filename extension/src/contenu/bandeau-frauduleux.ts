// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.37 point 4 : le bandeau rouge d'un site confirmé frauduleux (liste signée, Z1). Premier bandeau rendu pour un N3.
// Texte de Ph (même que la popup) : « Site frauduleux signalé : quittez cette page ». Fermable sans condition, sans effet
// sur une visite ultérieure ; aucun bouton ne l'atténue. Aucune valeur de champ n'est lue. Racine Shadow DOM fermée.
import { ID_HOTE_FRAUDULEUX } from './bandeau.js';

export const TEXTE_FRAUDULEUX = 'Site frauduleux signalé : quittez cette page';

export function construireContenuBandeauFrauduleux(racine: ShadowRoot, hoteReel: string, fermer: () => void, ouvrirAide: () => void = () => {}): void {
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .bandeau {
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
      background: #fdecea; border-bottom: 4px solid #B42318;
      font: 14px/1.5 system-ui, sans-serif; color: #1a1a1a;
      padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
    }
    .texte { flex: 1 1 320px; }
    .texte strong { display: block; font-size: 16px; color: #8a1a10; margin-bottom: 4px; }
    .adresse { font-family: monospace; }
    .boutons { display: flex; gap: 12px; align-items: center; flex: 0 0 auto; }
    button { cursor: pointer; font: inherit; }
    .aide { background: none; border: none; padding: 0; color: #1a4fa0; text-decoration: underline; }
    .fermer { background: none; border: 1px solid #999; border-radius: 4px; padding: 6px 12px; }
  `;
  const bandeau = document.createElement('div');
  bandeau.className = 'bandeau';
  bandeau.setAttribute('role', 'alert');

  const texte = document.createElement('div');
  texte.className = 'texte';
  const titre = document.createElement('strong');
  titre.textContent = TEXTE_FRAUDULEUX;
  const detail = document.createElement('div');
  const adresse = document.createElement('span');
  adresse.className = 'adresse';
  adresse.textContent = hoteReel;
  detail.append('Cette adresse figure dans la liste des sites frauduleux de Tourmentin : ', adresse);
  texte.append(titre, detail);

  const boutons = document.createElement('div');
  boutons.className = 'boutons';
  const aide = document.createElement('button');
  aide.className = 'aide';
  aide.textContent = 'Comment vérifier une adresse';
  aide.addEventListener('click', ouvrirAide);
  const bouton = document.createElement('button');
  bouton.className = 'fermer';
  bouton.textContent = 'Fermer';
  bouton.addEventListener('click', fermer);
  boutons.append(aide, bouton);

  bandeau.append(texte, boutons);
  racine.append(style, bandeau);
}

let cleAffichee: string | undefined;

export function retirerBandeauFrauduleux(): void {
  document.getElementById(ID_HOTE_FRAUDULEUX)?.remove();
  cleAffichee = undefined;
}

/** Idempotent pour un même hôte (ne touche pas au DOM s'il est déjà là, pour ne pas relancer d'analyse). */
export function afficherBandeauFrauduleux(hoteReel: string, ouvrirAide: () => void = () => {}, surFermeture: () => void = () => {}): void {
  if (cleAffichee === hoteReel && document.getElementById(ID_HOTE_FRAUDULEUX)) return;
  retirerBandeauFrauduleux();
  const hote = document.createElement('div');
  hote.id = ID_HOTE_FRAUDULEUX;
  const racine = hote.attachShadow({ mode: 'closed' });
  construireContenuBandeauFrauduleux(racine, hoteReel, () => { retirerBandeauFrauduleux(); surFermeture(); }, ouvrirAide);
  document.documentElement.append(hote);
  cleAffichee = hoteReel;
}
