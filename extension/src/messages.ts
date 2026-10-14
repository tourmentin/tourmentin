// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Messages échangés entre content script/popup/options et service worker
// (chrome.runtime).
import type { Verdict } from './moteur/types.js';
import type { EntreeAnalyse } from './moteur/types.js';
import type { EntreeJournal } from './arriere-plan/journal.js';
import type { EntreeSignalement, TypeDeclaration } from './arriere-plan/signalements.js';
import type { StatutAffiche } from './arriere-plan/statut.js';
import type { ModeAvertissement } from './arriere-plan/bandeau-connexion.js';
import type { ModeEnvoi } from './arriere-plan/reseau.js';
import type { ActionRole, Role } from './arriere-plan/envoi.js';

export type MessageDepuisContenu =
  | { type: 'ANALYSE_FRAME'; entree: EntreeAnalyse }
  /** 14.6, point a : popup ou content script demandent le dernier verdict connu de l'onglet. */
  | { type: 'DEMANDER_VERDICT_ONGLET' }
  /** 14.6 point c : lecture/effacement du journal et des signalements, depuis la page d'options. */
  | { type: 'LIRE_JOURNAL' }
  | { type: 'EFFACER_JOURNAL' }
  | { type: 'LIRE_SIGNALEMENTS' }
  | { type: 'LIRE_REGLAGES' }
  | { type: 'ECRIRE_REGLAGES'; journalActif?: boolean; avertirConnexion?: ModeAvertissement; modeEnvoi?: ModeEnvoi }
  /** 14.7 point 3 : deux temps — l'aperçu ne construit rien de définitif, la confirmation seule écrit. */
  | { type: 'DEMANDER_APERCU_DECLARATION'; declaration?: TypeDeclaration; ongletUrl?: string }
  /** 14.20 F : statut affiché par la popup, calculé par le service worker (verdict, listes, déclarations locales). */
  | { type: 'DEMANDER_STATUT_ONGLET'; relancer?: boolean; ongletUrl?: string }
  /** `envoyer` : en mode « Me demander avant chaque envoi », la réponse de l'usager à la question posée dans l'aperçu (14.19 A2). */
  | { type: 'CONFIRMER_DECLARATION'; envoyer?: boolean; ongletUrl?: string }
  | { type: 'EFFACER_SIGNALEMENT'; horodatage: string }
  /** 14.15 point 2 : lien « Comment vérifier une adresse » du bandeau — un contenu ne peut pas ouvrir une page d'extension (non exposée), le service worker le fait. */
  | { type: 'OUVRIR_VERIFIER' }
  /** 14.20 G : rôle tel que le serveur le dit (mémoire de 15 minutes). */
  | { type: 'LIRE_ROLE'; forcer?: boolean }
  /** 14.20 G : liaison du compte par le code généré sur tourmentin.fr/gestion, collé une seule fois. */
  | { type: 'LIER_COMPTE'; code: string }
  | { type: 'DELIER_COMPTE' }
  | { type: 'LIRE_LIAISON' }
  /** 14.20 G : actions de rôle ; le serveur revérifie le rôle à chaque action. */
  | { type: 'ACTION_ROLE'; action: ActionRole; ongletUrl?: string }
  /** « Voir les sites de la base » : ouvre l'adresse fixe du back-office, sans aucun paramètre venu de la page (C6). */
  | { type: 'OUVRIR_GESTION' }
  /** 14.43 : les pages demandent la version de construction du service worker (détecte un service worker pas rechargé après une mise à jour). */
  | { type: 'LIRE_VERSION' };

export type MessageDepuisArrierePlan =
  /** `bandeauConnexion` : 14.22 B, décidé par le service worker ; le script de contenu ne fait que rendre. */
  | { type: 'VERDICT'; verdict: Verdict; bandeauConnexion?: { hote: string } }
  | { type: 'REANALYSER' }
  /** Le service worker demande à la page de quoi nourrir une déclaration : texte visible et adresses d'images (jamais une valeur de champ). */
  | { type: 'COLLECTER_RAPPORT' }
  /** Réponse à DEMANDER_VERDICT_ONGLET ; `verdict: null` si aucune analyse n'a encore abouti sur cet onglet. */
  | { type: 'VERDICT_ONGLET'; verdict: Verdict | null }
  | { type: 'JOURNAL'; entrees: EntreeJournal[] }
  | { type: 'SIGNALEMENTS'; entrees: EntreeSignalement[] }
  | { type: 'REGLAGES'; journalActif: boolean; avertirConnexion: ModeAvertissement; modeEnvoi: ModeEnvoi }
  /**
   * 14.7 point 3 : texte exact qui sera écrit, montré avant tout accord — ou `null` si l'onglet n'a pas de verdict à déclarer.
   * `envoi` : quand le réglage n'est pas « Ne jamais envoyer », ce qui partirait vers tourmentin.fr, EXACTEMENT (14.19 B).
   */
  | { type: 'APERCU_DECLARATION'; texte: string | null; envoi?: { mode: ModeEnvoi; corps: string } }
  /** Résultat de la confirmation : l'entrée est toujours écrite ici ; l'envoi est `non` (réglage ou choix), `ok` ou `echec`. */
  | { type: 'DECLARATION_ENREGISTREE'; envoi: 'non' | 'ok' | 'echec'; erreur?: string }
  /** `statut: null` : onglet http(s) dont l'analyse n'est pas encore arrivée. */
  | { type: 'STATUT_ONGLET'; statut: StatutAffiche | null }
  | { type: 'ROLE'; lie: boolean; role: Role | null }
  | { type: 'LIAISON'; ok: boolean; role?: Role; erreur?: string }
  | { type: 'LIAISON_ETAT'; lie: boolean; role: Role | null }
  | { type: 'ACTION'; ok: boolean; erreur?: string }
  | { type: 'RAPPORT_PAGE'; textes: string; images: string[] }
  /** 14.43 : version de construction du service worker en cours d'exécution. */
  | { type: 'VERSION'; build: string }
  /** 14.43 : réponse à ECRIRE_REGLAGES (avant : aucune, donc indiscernable d'un service worker muet). */
  | { type: 'REGLAGES_ECRITS'; ok: boolean }
  /** 14.43 : le service worker ne connaît pas ce type de message (page plus récente que lui). */
  | { type: 'INCONNU' }
  /** 14.43 : le service worker a échoué ou n'a pas répondu à temps ; jamais le détail de l'erreur. */
  | { type: 'ERREUR_SW'; raison: 'exception' | 'delai' };
