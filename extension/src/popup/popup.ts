// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.6 point d (déclaration « Cette page est frauduleuse », 14.7) et 14.20 F/G
// (statut en langue de l'utilisateur, « Signaler comme site officiel »).
// Le statut est calculé par le service worker à partir du verdict conservé par
// onglet (14.6 point a) : la popup ne redéclenche jamais d'analyse et ne lit
// jamais le DOM de la page. Le niveau N0 à N3 n'est plus affiché ici ; il
// reste dans le journal.
//
// 14.22 A : la popup ne reste jamais plus de 2 s sur « Analyse en cours… ».
// Sans statut au bout de ce délai — onglet ouvert avant l'installation, état
// de session perdu, service worker qui ne répond pas — elle le dit.
import type { TypeDeclaration } from '../arriere-plan/signalements.js';
import type { StatutAffiche } from '../arriere-plan/statut.js';
import type { MessageDepuisArrierePlan, MessageDepuisContenu } from '../messages.js';
import { construireConfirmation, messageResultat } from '../ui/confirmation.js';
import { demander, texteErreur, verifierService } from '../ui/service-worker.js';

// 14.48 : « popup.html?url=<motif> » (page ouverte dans un onglet) désigne l'onglet à examiner par son adresse ; sans ce paramètre,
// comportement normal (la popup examine l'onglet actif). Les essais sous Firefox, où une popup ne s'ouvre pas par programme, s'en servent.
const parametreUrl = new URLSearchParams(location.search).get('url');
const ongletExplicite = parametreUrl !== null && parametreUrl !== '' ? { ongletUrl: parametreUrl } : {};

/** Message sans réponse attendue (ouvrir une page). */
function lancer(message: MessageDepuisContenu): void {
  void chrome.runtime.sendMessage(message).catch(() => {});
}

/** 14.22 A : délai maximal sur « Analyse en cours… ». */
export const DELAI_ANALYSE_MS = 2000;
const INTERVALLE_RELANCE_MS = 300;
export const MESSAGE_NON_ANALYSEE = 'Tourmentin n\'a pas encore analysé cette page : rechargez-la';

const contenu = document.getElementById('contenu')!;
const boutonOfficiel = document.getElementById('bouton-officiel') as HTMLButtonElement;
const boutonFrauduleuse = document.getElementById('bouton-frauduleuse') as HTMLButtonElement;
const zoneConfirmation = document.getElementById('confirmation')!;
const zoneRole = document.getElementById('zone-role')!;
const boutonValider = document.getElementById('bouton-valider') as HTMLButtonElement;
const boutonConfirmerFrauduleux = document.getElementById('bouton-confirmer-frauduleux') as HTMLButtonElement;
const boutonGestion = document.getElementById('bouton-gestion') as HTMLButtonElement;

function afficherBloc(texte: string, couleur: string, code: string): HTMLElement {
  const bloc = document.createElement('p');
  bloc.id = 'statut';
  bloc.className = `statut statut-${couleur}`;
  bloc.dataset.code = code;
  bloc.textContent = texte;
  return bloc;
}

function detailsDe(statut: StatutAffiche): HTMLElement | null {
  if (!statut.details) return null;
  const { marque, motif, signaux } = statut.details;
  const lien = document.createElement('button');
  lien.id = 'lien-details';
  lien.className = 'lien';
  lien.textContent = 'Détails';
  lien.setAttribute('aria-expanded', 'false');
  const zone = document.createElement('dl');
  zone.id = 'details';
  zone.hidden = true;
  const ajouter = (terme: string, valeur: string): void => {
    const dt = document.createElement('dt');
    dt.textContent = terme;
    const dd = document.createElement('dd');
    dd.textContent = valeur;
    zone.append(dt, dd);
  };
  ajouter('Marque évoquée', marque);
  ajouter('Motif', motif);
  if (signaux.length > 0) ajouter('Signaux', signaux.join('\n'));
  lien.addEventListener('click', () => {
    zone.hidden = !zone.hidden;
    lien.setAttribute('aria-expanded', String(!zone.hidden));
  });
  const conteneur = document.createElement('div');
  conteneur.append(lien, zone);
  return conteneur;
}

function afficherStatut(statut: StatutAffiche): void {
  contenu.replaceChildren(afficherBloc(statut.texte, statut.couleur, statut.code));
  const details = detailsDe(statut);
  if (details) contenu.append(details);
  boutonOfficiel.style.display = statut.peutSignalerOfficiel ? 'block' : 'none';
  boutonFrauduleuse.style.display = statut.peutDeclarerFrauduleuse ? 'block' : 'none';
  void afficherRoles(statut);
}

// 14.20 G : boutons de rôle. Le rôle est celui que le SERVEUR dit (mémoire de 15 minutes) ; sans réponse, aucun bouton.
// « Valider comme officiel » : jamais sur un site déjà vérifié ni sur une page de paiement (14.24 A5).
async function afficherRoles(statut: StatutAffiche): Promise<void> {
  zoneRole.style.display = 'none';
  let reponse: Extract<MessageDepuisArrierePlan, { type: 'ROLE' }> | undefined;
  try {
    reponse = await Promise.race([
      demander({ type: 'LIRE_ROLE' }, 'ROLE', { essais: 1 }),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4000)),
    ]);
  } catch {
    reponse = undefined; // sans réponse du service worker : aucun bouton de rôle (le problème est dit par verifierService)
  }
  if (!reponse || (reponse.role !== 'confiance' && reponse.role !== 'super')) return;
  const horsPerimetre = statut.code === 'hors-perimetre';
  boutonValider.style.display = !horsPerimetre && !statut.pagePaiement && statut.code !== 'officiel-verifie' ? 'block' : 'none';
  boutonConfirmerFrauduleux.style.display = horsPerimetre ? 'none' : 'block';
  boutonGestion.style.display = 'block';
  zoneRole.style.display = 'block';
}

function afficherNonAnalysee(): void {
  contenu.replaceChildren(afficherBloc(MESSAGE_NON_ANALYSEE, 'gris', 'non-analysee'));
  boutonOfficiel.style.display = 'none';
  boutonFrauduleuse.style.display = 'none';
}

async function demanderStatut(relancer: boolean, delaiRestantMs: number): Promise<StatutAffiche | null> {
  const reponse = demander({ type: 'DEMANDER_STATUT_ONGLET', relancer, ...ongletExplicite }, 'STATUT_ONGLET', { essais: 1 });
  const abandon = new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(0, delaiRestantMs)));
  // Un service worker qui ne répond pas, ou une erreur de message : traités comme « pas de statut ».
  return Promise.race([reponse.then((r) => r.statut).catch(() => null), abandon]);
}

/** 14.43 : le service worker ne répond pas, ou n'est pas de la même construction que cette page. Dit clairement, sans bouton. */
function afficherProbleme(texte: string): void {
  contenu.replaceChildren(afficherBloc(texte, 'orange', 'service-interne'));
  boutonOfficiel.style.display = 'none';
  boutonFrauduleuse.style.display = 'none';
  zoneRole.style.display = 'none';
}

async function rafraichir(): Promise<void> {
  const debut = Date.now();
  let premier = true;
  while (Date.now() - debut < DELAI_ANALYSE_MS) {
    const statut = await demanderStatut(premier, DELAI_ANALYSE_MS - (Date.now() - debut));
    premier = false;
    if (statut) {
      afficherStatut(statut);
      return;
    }
    await new Promise((r) => setTimeout(r, Math.min(INTERVALLE_RELANCE_MS, Math.max(0, DELAI_ANALYSE_MS - (Date.now() - debut)))));
  }
  afficherNonAnalysee();
}

// 14.7 point 3 : deux temps, jamais un seul clic qui écrit. L'aperçu montre exactement ce qui sera
// consigné — et, selon le réglage d'envoi, exactement ce qui partirait vers tourmentin.fr (14.19 B).
function brancher(bouton: HTMLButtonElement, declaration: TypeDeclaration): void {
  bouton.addEventListener('click', async () => {
    zoneConfirmation.replaceChildren();
    zoneConfirmation.style.display = 'block';
    let reponse: Extract<MessageDepuisArrierePlan, { type: 'APERCU_DECLARATION' }>;
    try {
      reponse = await demander({ type: 'DEMANDER_APERCU_DECLARATION', declaration, ...ongletExplicite }, 'APERCU_DECLARATION', { delaiMs: 8000 });
    } catch (e) {
      zoneConfirmation.textContent = texteErreur(e);
      return;
    }
    if (!reponse.texte) {
      zoneConfirmation.textContent = 'Rien à déclarer sur cet onglet.';
      return;
    }
    zoneConfirmation.append(
      ...construireConfirmation(
        { texte: reponse.texte, ...(reponse.envoi ? { envoi: reponse.envoi } : {}) },
        async (envoyerMaintenant) => {
          // 25 s au plus : la requête vers le serveur est bornée à 10 s ; au-delà, l'interface ne reste pas suspendue.
          const r = await Promise.race([
            // un seul essai : une confirmation ne se rejoue pas (elle écrit)
            demander({ type: 'CONFIRMER_DECLARATION', envoyer: envoyerMaintenant, ...ongletExplicite }, 'DECLARATION_ENREGISTREE', { essais: 1, delaiMs: 30000 }).catch(() => ({ envoi: 'echec' as const, erreur: 'service-interne' })),
            new Promise<{ envoi: 'echec'; erreur: string }>((resolve) => setTimeout(() => resolve({ envoi: 'echec', erreur: 'delai-depasse' }), 25000)),
          ]);
          return { envoi: r.envoi, ...(r.erreur ? { erreur: r.erreur } : {}) };
        },
        async (resultat) => {
          zoneConfirmation.textContent = messageResultat(resultat);
          await rafraichir();
        },
      ),
    );
  });
}

// 14.20 G : « Valider comme officiel » et « Confirmer frauduleux » agissent dans la base, effet immédiat ; une
// confirmation précède. Le serveur revérifie le rôle et refuse « officiel » sur une page de paiement.
function brancherAction(bouton: HTMLButtonElement, action: 'valider_officiel' | 'confirmer_frauduleux', libelle: string): void {
  bouton.addEventListener('click', () => {
    zoneConfirmation.replaceChildren();
    zoneConfirmation.style.display = 'block';
    const texte = document.createElement('p');
    texte.textContent = `${libelle} : décision immédiate dans la base de tourmentin.fr, diffusée aux autres utilisateurs à la prochaine publication de liste signée. Le serveur revérifie votre rôle.`;
    const confirmer = document.createElement('button');
    confirmer.id = 'bouton-confirmer-action';
    confirmer.textContent = 'Confirmer';
    confirmer.addEventListener('click', async () => {
      confirmer.disabled = true;
      try {
        // un seul essai : une décision ne se rejoue pas
        const r = await demander({ type: 'ACTION_ROLE', action, ...ongletExplicite }, 'ACTION', { essais: 1, delaiMs: 15000 });
        zoneConfirmation.textContent = r.ok ? 'Décision enregistrée dans la base de tourmentin.fr.' : `Refusé par le serveur (${r.erreur ?? 'raison inconnue'}).`;
      } catch (e) {
        zoneConfirmation.textContent = texteErreur(e);
        confirmer.disabled = false;
      }
    });
    zoneConfirmation.append(texte, confirmer);
  });
}

brancher(boutonOfficiel, 'officiel');
brancher(boutonFrauduleuse, 'frauduleuse');
brancherAction(boutonValider, 'valider_officiel', 'Valider comme officiel');
brancherAction(boutonConfirmerFrauduleux, 'confirmer_frauduleux', 'Confirmer frauduleux');
boutonGestion.addEventListener('click', () => {
  lancer({ type: 'OUVRIR_GESTION' });
});

// 14.43 : d'abord, le service worker répond-il, et est-il de la même construction que cette page ?
void (async () => {
  const service = await verifierService();
  if (!service.ok) {
    afficherProbleme(service.texte);
    return;
  }
  await rafraichir();
})();
