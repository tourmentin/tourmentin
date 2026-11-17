// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.22 B : le bandeau de connexion. Discret, non bloquant, en haut de page,
// sur une page à champ mot de passe d'un site absent de la base et non signalé
// par le moteur. La décision d'afficher est prise par le service worker
// (arriere-plan/bandeau-connexion.ts) ; ce fichier ne fait que rendre.
//
// Texte de Ph : « Vérifiez l'adresse avant de saisir vos identifiants. Adresse
// de cette page : {hôte} ». Deux boutons — « C'est le bon site » (déclaration
// « officiel », même aperçu et même confirmation que dans la popup, 14.7 point
// 3) et « Comment vérifier une adresse ». Il se ferme sans rien déclarer : le
// contrôle « × » est une proposition de Claude (Ph n'a nommé que deux boutons).
//
// Aucune valeur de champ n'est lue ici. Racine Shadow DOM fermée, comme le
// bandeau N2 : la page ne lit ni ne manipule ce contenu.
import { construireConfirmation, messageResultat, TEXTE_NON_TRANSMIS, type ApercuDeclaration, type ResultatConfirmation } from '../ui/confirmation.js';
import { ID_HOTE_CONNEXION } from './bandeau.js';

export interface ActionsBandeauConnexion {
  fermer: () => void;
  ouvrirAide: () => void;
  /** Texte exact qui sera écrit (et, selon le réglage d'envoi, le corps exact qui partirait), ou `null` s'il n'y a rien à déclarer. Ne construit rien de définitif. */
  demanderApercu: () => Promise<ApercuDeclaration | null>;
  /** Écrit l'entrée montrée par l'aperçu, et elle seule ; l'envoyer ou non selon le réglage et le choix de l'usager. */
  confirmer: (envoyer: boolean) => Promise<ResultatConfirmation>;
}

export const TEXTE_ENREGISTRE = TEXTE_NON_TRANSMIS;

export function construireContenuBandeauConnexion(racine: ShadowRoot, hoteReel: string, actions: ActionsBandeauConnexion): void {
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .bandeau {
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483646;
      background: #eef4ff; border-bottom: 2px solid #2563EB;
      font: 13px/1.45 system-ui, sans-serif; color: #1a1a1a;
      padding: 8px 16px; display: flex; flex-direction: column; gap: 6px;
    }
    .bandeau.efface { opacity: 0; transition: opacity 1s linear; }
    .ligne { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .texte { flex: 1 1 300px; }
    .adresse { font-family: monospace; font-weight: 600; }
    .boutons { display: flex; gap: 8px; align-items: center; flex: 0 0 auto; }
    button { cursor: pointer; font: inherit; }
    .action { padding: 5px 12px; border-radius: 4px; border: 1px solid #1a1a1a; background: #1a1a1a; color: #fff; }
    .aide { background: none; border: none; padding: 0; color: #1a4fa0; text-decoration: underline; }
    .fermer { background: none; border: none; font-size: 18px; line-height: 1; padding: 0 4px; color: #444; }
    .apercu { white-space: pre-line; border: 1px solid #b6c6e6; background: #fff; border-radius: 4px; padding: 8px; }
    .apercu button { margin-top: 6px; margin-right: 6px; padding: 5px 12px; border-radius: 4px; border: 1px solid #1a1a1a; background: #1a1a1a; color: #fff; }
    .apercu pre { white-space: pre-wrap; word-break: break-word; max-height: 11em; overflow: auto; background: #f4f4f4; padding: 6px; margin: 6px 0; font: 12px/1.4 monospace; }
  `;

  const bandeau = document.createElement('div');
  bandeau.className = 'bandeau';

  const ligne = document.createElement('div');
  ligne.className = 'ligne';

  const texte = document.createElement('div');
  texte.className = 'texte';
  const adresse = document.createElement('span');
  adresse.className = 'adresse';
  adresse.textContent = hoteReel;
  texte.append('Vérifiez l\'adresse avant de saisir vos identifiants. Adresse de cette page : ', adresse);

  const boutons = document.createElement('div');
  boutons.className = 'boutons';

  const zone = document.createElement('div');
  zone.className = 'apercu';
  zone.hidden = true;

  // Une fois la réponse donnée : 1 s de lecture, puis fondu de 1 s, puis le bandeau est retiré. Un échec d'envoi reste affiché.
  const disparaitre = (): void => {
    setTimeout(() => {
      bandeau.classList.add('efface');
      setTimeout(actions.fermer, 1000);
    }, 1000);
  };

  const bonSite = document.createElement('button');
  bonSite.className = 'action';
  bonSite.textContent = 'C\'est le bon site';
  bonSite.addEventListener('click', async () => {
    const apercu = await actions.demanderApercu().catch(() => null);
    zone.replaceChildren();
    zone.hidden = false;
    if (!apercu) {
      zone.textContent = 'Rien à déclarer sur cette page.';
      return;
    }
    // Réglage « Envoyer automatiquement » : le choix est déjà fait dans les options, pas de seconde validation.
    // Le texte dit toujours la vérité sur ce qui s'est passé (envoyé, échec).
    if (apercu.envoi?.mode === 'automatique') {
      bonSite.hidden = true;
      zone.textContent = 'Envoi en cours…';
      const resultat = await actions.confirmer(true).catch((): ResultatConfirmation => ({ envoi: 'non' }));
      zone.textContent = resultat.envoi === 'ok' ? 'Merci ! Votre déclaration a été envoyée à tourmentin.fr.' : messageResultat(resultat);
      if (resultat.envoi !== 'echec') disparaitre();
      return;
    }
    zone.append(
      ...construireConfirmation(apercu, (envoyer) => actions.confirmer(envoyer), (resultat) => {
        zone.replaceChildren();
        zone.textContent = messageResultat(resultat);
        bonSite.hidden = true;
        if (resultat.envoi !== 'echec') disparaitre();
      }),
    );
  });

  const aide = document.createElement('button');
  aide.className = 'aide';
  aide.textContent = 'Comment vérifier une adresse';
  aide.addEventListener('click', actions.ouvrirAide);

  const fermer = document.createElement('button');
  fermer.className = 'fermer';
  fermer.textContent = '×';
  fermer.setAttribute('aria-label', 'Fermer ce message');
  // Fermeture sans rien déclarer, sans écrire, sans effet sur une visite ultérieure.
  fermer.addEventListener('click', actions.fermer);

  boutons.append(bonSite, aide, fermer);
  ligne.append(texte, boutons);
  bandeau.append(ligne, zone);
  racine.append(style, bandeau);
}

let cleAffichee: string | undefined;

export function retirerBandeauConnexion(): void {
  document.getElementById(ID_HOTE_CONNEXION)?.remove();
  cleAffichee = undefined;
}

/** Affiche le bandeau ; idempotent pour un même hôte (ne touche pas au DOM s'il est déjà là, pour ne pas relancer d'analyse). */
export function afficherBandeauConnexion(hoteReel: string, actions: ActionsBandeauConnexion): void {
  if (cleAffichee === hoteReel && document.getElementById(ID_HOTE_CONNEXION)) return;
  retirerBandeauConnexion();
  const hote = document.createElement('div');
  hote.id = ID_HOTE_CONNEXION;
  const racine = hote.attachShadow({ mode: 'closed' });
  construireContenuBandeauConnexion(racine, hoteReel, {
    ...actions,
    fermer: () => { retirerBandeauConnexion(); actions.fermer(); },
  });
  document.documentElement.append(hote);
  cleAffichee = hoteReel;
}
