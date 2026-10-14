// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Livrable 4 du lot L3. Collecte via l'adaptateur DOM, envoie au service
// worker, journalise le verdict reçu. S'exécute dans chaque frame
// (all_frames, 6.5), monde ISOLATED exclusivement (règle 6 de CLAUDE.md —
// c'est le monde par défaut d'un content script, jamais changé ici).
import { construireEntreeAnalyse } from '../adaptateurs/dom.js';
import { collecterAdressesImages } from '../adaptateurs/images.js';
import type { MessageDepuisArrierePlan, MessageDepuisContenu } from '../messages.js';
import { chargerSocle } from '../listes/chargement.js';
import { afficherBandeauN2, mutationsInternes, retirerBandeau } from './bandeau.js';
import { afficherBandeauConnexion, retirerBandeauConnexion } from './bandeau-connexion.js';
import { afficherBandeauFrauduleux, retirerBandeauFrauduleux } from './bandeau-frauduleux.js';
import { fermetureResteValable, memoriserFermeture, type VerdictFerme } from './fermeture.js';
import type { Verdict } from '../moteur/types.js';

// 14.11 (rang 1) : le socle est une donnée statique embarquée (pas d'API
// chrome.*), chargée ici pour résoudre l'id de marque du verdict vers son
// EmpreinteMarque complète (libellé, domainePrincipal) — le verdict lui-même
// ne porte que l'id (moteur/types.ts), jamais l'objet entier.
const socle = chargerSocle();

// Spec 12.3.1.2 : marqueur d'injection, distinct du verdict, émis dès
// l'exécution du script — pas depuis demarrer(), qui peut attendre
// DOMContentLoaded. C'est ce qui permet au harnais de distinguer un script
// jamais injecté d'un verdict simplement tardif.
console.log(`[Tourmentin] injecte : ${document.location.href}`);

const DEBOUNCE_MUTATION_MS = 300;
let minuteurDebounce: ReturnType<typeof setTimeout> | undefined;

// Spec 12.3.1.3 : origine de la dernière analyse envoyée, reportée dans le
// journal du verdict qui en découle. C'est le point discriminant de la
// mesure de latence — un premier verdict presque toujours « initiale »
// signifie que l'amortissement de 300 ms du MutationObserver ne le concerne
// pas. Une variable de module suffit ici (pas d'état à travers un redémarrage
// du service worker, contrairement à la règle 7 de CLAUDE.md : ce fichier
// s'exécute dans le content script, pas dans le service worker).
type OrigineAnalyse = 'initiale' | 'mutation' | 'reanalyse-forcee';
let origineEnCours: OrigineAnalyse = 'initiale';
// 14.11 (rang 1) : hôte de la page au moment de l'analyse qui a produit le
// dernier verdict — le bandeau l'affiche tel quel, pas relu depuis
// `location` au moment du clic, pour rester cohérent avec ce qui a
// effectivement été soumis à analyser().
let derniereUrlHote: string | undefined;
// 14.15/14.17 : « Fermer ce message » ferme le verdict qui était affiché, pas
// la page. Un verdict identique ou moins grave reste fermé (sinon le bandeau
// revenait ~350 ms après le clic) ; un verdict plus grave — niveau supérieur,
// signal d'exposition nouveau comme un moyen de paiement, autre marque — le
// réaffiche. Remis à zéro à la navigation SPA (REANALYSER) ; une nouvelle page
// charge un nouveau script — aucune mémoire au-delà de la page (14.8 : une
// fermeture, rien d'autre).
let dernierVerdictAffiche: Verdict | undefined;
let fermeture: VerdictFerme | undefined;
// 14.22 B : « × » ferme le bandeau de connexion pour cette page seulement (comme 14.17) ; remis à zéro à la navigation SPA.
let connexionFermee = false;
/** 14.37 point 4 : le bandeau rouge fermé ne revient pas sur cette page ; une autre visite le réaffiche. */
let frauduleuxFerme = false;

function envoyerAnalyse(origine: OrigineAnalyse): void {
  origineEnCours = origine;
  const entree = construireEntreeAnalyse(document);
  derniereUrlHote = entree.url?.hote;
  const message: MessageDepuisContenu = { type: 'ANALYSE_FRAME', entree };
  chrome.runtime.sendMessage(message).catch(() => {
    // Le service worker peut ne pas être encore prêt à document_start ; sans
    // conséquence, le MutationObserver ou la prochaine navigation redéclenchera un envoi.
  });
}

function planifierNouvelleAnalyse(): void {
  if (minuteurDebounce !== undefined) clearTimeout(minuteurDebounce);
  minuteurDebounce = setTimeout(() => envoyerAnalyse('mutation'), DEBOUNCE_MUTATION_MS);
}

chrome.runtime.onMessage.addListener((message: MessageDepuisArrierePlan, _expediteur, repondre) => {
  // 14.19 B : de quoi nourrir une déclaration — le texte visible (qui vient de construireEntreeAnalyse : jamais une valeur de champ)
  // et les adresses d'images. Seule la frame principale répond.
  if (message.type === 'COLLECTER_RAPPORT') {
    if (window.self !== window.top) return;
    const reponse: MessageDepuisArrierePlan = {
      type: 'RAPPORT_PAGE',
      textes: construireEntreeAnalyse(document).texteVisible,
      images: collecterAdressesImages(document),
    };
    repondre(reponse);
    return;
  }

  if (message.type === 'VERDICT') {
    console.log(`[Tourmentin] verdict origine=${origineEnCours} : ${message.verdict.niveau} — ${message.verdict.motif}`, message.verdict);
    // 14.11 (rang 1) : seul N2 rend le bandeau dans la page (N3 est écrit
    // séparément, 14.11 rang 3, et éteint dans le build d'essai, 14.5).
    // Frame principale seulement : un bandeau par iframe n'a pas de sens.
    if (message.verdict.niveau === 'N2' && window.self === window.top && derniereUrlHote && !(fermeture && fermetureResteValable(fermeture, message.verdict))) {
      const marque = socle.find((m) => m.id === message.verdict.marqueDetectee);
      if (marque) {
        const ouvrirAide = (): void => {
          const demande: MessageDepuisContenu = { type: 'OUVRIR_VERIFIER' };
          void chrome.runtime.sendMessage(demande).catch(() => {});
        };
        // Ce verdict est maintenant celui qui est affiché : une éventuelle
        // fermeture antérieure (plus légère) ne vaut plus.
        fermeture = undefined;
        dernierVerdictAffiche = message.verdict;
        afficherBandeauN2(marque, derniereUrlHote, ouvrirAide, () => {
          if (dernierVerdictAffiche) fermeture = memoriserFermeture(dernierVerdictAffiche);
        });
      }
    } else if (message.verdict.niveau !== 'N2') {
      retirerBandeau();
    }

    // 14.37 point 4 : bandeau rouge d'un site confirmé frauduleux (liste signée, Z1). Frame principale seulement.
    if (message.verdict.signaleParListe && window.self === window.top && derniereUrlHote) {
      if (!frauduleuxFerme) {
        const ouvrirAide = (): void => {
          const demande: MessageDepuisContenu = { type: 'OUVRIR_VERIFIER' };
          void chrome.runtime.sendMessage(demande).catch(() => {});
        };
        afficherBandeauFrauduleux(derniereUrlHote, ouvrirAide, () => { frauduleuxFerme = true; });
      }
    } else {
      retirerBandeauFrauduleux();
    }

    // 14.22 B : bandeau de connexion. Décidé par le service worker ; jamais avec une alerte N1 à N3.
    if (message.verdict.niveau !== 'N0') {
      retirerBandeauConnexion();
    } else if (message.bandeauConnexion && window.self === window.top && !connexionFermee) {
      const ouvrirAide = (): void => {
        const demande: MessageDepuisContenu = { type: 'OUVRIR_VERIFIER' };
        void chrome.runtime.sendMessage(demande).catch(() => {});
      };
      afficherBandeauConnexion(message.bandeauConnexion.hote, {
        fermer: () => { connexionFermee = true; },
        ouvrirAide,
        // Même aperçu, même confirmation que la popup (14.7 point 3, 14.22 B).
        demanderApercu: async () => {
          const demande: MessageDepuisContenu = { type: 'DEMANDER_APERCU_DECLARATION', declaration: 'officiel' };
          const reponse = (await chrome.runtime.sendMessage(demande)) as Extract<MessageDepuisArrierePlan, { type: 'APERCU_DECLARATION' }>;
          return reponse.texte === null ? null : { texte: reponse.texte, ...(reponse.envoi ? { envoi: reponse.envoi } : {}) };
        },
        confirmer: async (envoyer) => {
          const demande: MessageDepuisContenu = { type: 'CONFIRMER_DECLARATION', envoyer };
          const reponse = (await chrome.runtime.sendMessage(demande)) as Extract<MessageDepuisArrierePlan, { type: 'DECLARATION_ENREGISTREE' }>;
          return { envoi: reponse.envoi, ...(reponse.erreur ? { erreur: reponse.erreur } : {}) };
        },
      });
    }
  } else if (message.type === 'REANALYSER') {
    fermeture = undefined;
    dernierVerdictAffiche = undefined;
    connexionFermee = false;
    frauduleuxFerme = false;
    retirerBandeau();
    retirerBandeauConnexion();
    envoyerAnalyse('reanalyse-forcee');
  }
});

function demarrer(): void {
  envoyerAnalyse('initiale');

  // SPA sans mise à jour de l'historique (6.5) : secours du
  // webNavigation.onHistoryStateUpdated du service worker. Un seul
  // observateur sur <html> couvre à la fois document.title (dans <head>) et
  // document.body, avec le debounce de 300 ms demandé.
  new MutationObserver((mutations) => {
    if (!mutationsInternes(mutations)) planifierNouvelleAnalyse();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', demarrer, { once: true });
} else {
  demarrer();
}
