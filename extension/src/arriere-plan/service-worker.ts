// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Livrable 5 du lot L3. Reçoit les EntreeAnalyse de chaque frame, agrège par
// tabId dans chrome.storage.session (jamais de variable de module : le
// service worker meurt après 30 s d'inactivité, 4.2), appelle analyser(),
// journalise le verdict. Fichier de liaison, non testé unitairement — la
// logique qu'il orchestre (fusion.ts, chargement.ts, analyser(), journal.ts,
// signalements.ts) l'est séparément ; ce fichier lui-même sera exercé pour de
// vrai au lot L5 (Playwright, extension chargée), comme les blocs CLI de
// listes/outils/.
//
// 14.6, point a : le dernier verdict de chaque onglet est conservé sous une
// clé distincte de celle des rapports de frames (`verdict:{tabId}`), pour
// que le popup (b) et « Cette page est frauduleuse » (d, 14.7) puissent le
// relire sans redéclencher d'analyse. Les deux clés vivent et meurent
// ensemble : tout événement qui vide les rapports vide aussi le verdict.
//
// 14.6, point c : journal (chrome.storage.local, `journal`) et signalements
// (`signalements`) sont deux clés distinctes, jamais la même liste sous deux
// filtres (14.2.3) — effacer l'une ne touche jamais l'autre. Le réglage
// `reglages.journalActif` gouverne l'écriture automatique du journal
// (désactivé par défaut, 14.1) mais jamais celle des signalements (14.4
// point 3 : un acte délibéré n'est pas gouverné par cet interrupteur).
import { analyser } from '../moteur/analyser.js';
import { imitationARetenir } from '../moteur/memoire-imitation.js';
import { CLE_MEMOIRE_IMITATION, lireImitationRetenue, retenirImitation, type TableMemoireImitation } from './memoire-imitation.js';
import { configParDefaut } from '../listes/chargement.js';
import { NOM_ALARME, actualiserListesSignees, listesCourantes, planifierActualisation } from './publication.js';
import type { MessageDepuisArrierePlan, MessageDepuisContenu } from '../messages.js';
import { fusionnerFrames, type RapportFrame } from './fusion.js';
import type { EntreeAnalyse, Verdict } from '../moteur/types.js';
import { construireEntreeJournal, estEligibleAuJournalAutomatique, purgerJournal, type EntreeJournal } from './journal.js';
import { apercuSignalement, construireEntreeSignalement, type EntreeSignalement } from './signalements.js';
import { determinerStatut, statutSansVerdict, type StatutAffiche } from './statut.js';
import {
  MODE_AVERTISSEMENT_PAR_DEFAUT,
  ajouterHoteVu,
  incrementerCompteur,
  type CompteurBandeaux,
  doitAfficherBandeauConnexion,
  empreinteHote,
  estModeAvertissement,
  type ModeAvertissement,
} from './bandeau-connexion.js';
import { BUILD_DE_MESURE } from '../version-essai.js';
import { BUILD_ID } from '../version-build.js';
import { MODE_ENVOI_PAR_DEFAUT, estModeEnvoi, type ModeEnvoi } from './reseau.js';
import { actionRole, delierInstallation, envoyerDeclaration, etatLiaison, lierCompte, lireProposition, lireRole } from './envoi.js';
import { construireRapport, type RapportDeclaration } from './rapport.js';

// 14.6 point e : l'écran de premier lancement s'affiche une fois, à
// l'installation -- pas un document externe, un onglet ouvert par
// l'extension elle-même (14.9), sous forme d'une vue de la page d'options
// sélectionnée par le hash (options.ts).
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') + '#premier-lancement' });
  }
  planifierActualisation();
});

// 14.33 F : listes signées, toutes les heures et au démarrage (sans adresse de publication : rien).
chrome.runtime.onStartup.addListener(() => planifierActualisation());
chrome.alarms.onAlarm.addListener((alarme) => {
  if (alarme.name === NOM_ALARME) void actualiserListesSignees();
});

const config = configParDefaut();

interface EtatOnglet {
  verdict: Verdict;
  href: string;
  /** 14.20 F : ce dont le statut de la popup a besoin sur l'adresse (le verdict ne porte pas l'hôte). */
  cible?: { hote: string; schema: string; domaineEnregistrable: string };
}

interface Reglages {
  journalActif: boolean;
  /** 14.22 B : « Avertir sur les pages de connexion inconnues ». */
  avertirConnexion: ModeAvertissement;
  /** 14.19 A2 : « Ne jamais envoyer » / « Me demander avant chaque envoi » (défaut) / « Envoyer automatiquement ». */
  modeEnvoi: ModeEnvoi;
}

const REGLAGES_PAR_DEFAUT: Reglages = { journalActif: false, avertirConnexion: MODE_AVERTISSEMENT_PAR_DEFAUT, modeEnvoi: MODE_ENVOI_PAR_DEFAUT }; // 14.1 : journal désactivé par défaut ; 14.22 B : une fois par site

function cleRapports(tabId: number): string {
  return `frames:${tabId}`;
}

function cleEtat(tabId: number): string {
  return `verdict:${tabId}`;
}

function cleDeclarationEnAttente(tabId: number): string {
  return `declaration-en-attente:${tabId}`;
}

interface DeclarationEnAttente {
  entree: EntreeSignalement;
  /** Le corps exact qui partirait ; absent si le réglage est « Ne jamais envoyer ». */
  rapport?: RapportDeclaration;
}

/** Texte visible et adresses d'images de la page, demandés au script de contenu (3 s au plus). */
async function collecterRapportPage(tabId: number): Promise<{ textes: string; images: string[] } | undefined> {
  try {
    const demande: MessageDepuisArrierePlan = { type: 'COLLECTER_RAPPORT' };
    const reponse = (await Promise.race([
      chrome.tabs.sendMessage(tabId, demande),
      new Promise((resolve) => setTimeout(() => resolve(undefined), 3000)),
    ])) as Extract<MessageDepuisArrierePlan, { type: 'RAPPORT_PAGE' }> | undefined;
    return reponse && reponse.type === 'RAPPORT_PAGE' ? { textes: reponse.textes, images: reponse.images } : undefined;
  } catch {
    return undefined;
  }
}

async function lireRapports(tabId: number): Promise<RapportFrame[]> {
  const stocke = await chrome.storage.session.get(cleRapports(tabId));
  return (stocke[cleRapports(tabId)] as RapportFrame[] | undefined) ?? [];
}

async function ecrireRapports(tabId: number, rapports: RapportFrame[]): Promise<void> {
  await chrome.storage.session.set({ [cleRapports(tabId)]: rapports });
}

async function lireEtatOnglet(tabId: number): Promise<EtatOnglet | null> {
  const stocke = await chrome.storage.session.get(cleEtat(tabId));
  return (stocke[cleEtat(tabId)] as EtatOnglet | undefined) ?? null;
}

async function ecrireEtatOnglet(tabId: number, etat: EtatOnglet): Promise<void> {
  await chrome.storage.session.set({ [cleEtat(tabId)]: etat });
}

async function viderEtatOnglet(tabId: number): Promise<void> {
  await chrome.storage.session.remove([cleRapports(tabId), cleEtat(tabId), cleDeclarationEnAttente(tabId)]);
  // Une navigation efface l'état : le badge de la page précédente ne doit pas
  // rester affiché sur la nouvelle, même avant que son propre verdict n'arrive.
  void chrome.action.setBadgeText({ tabId, text: BUILD_DE_MESURE ? 'M' : '' }).catch(() => {});
}

async function resoudreTabId(sender: chrome.runtime.MessageSender, motifUrl?: string): Promise<number | undefined> {
  // 14.48 : une PAGE DE L'EXTENSION (sender.url dans l'origine de l'extension : jamais une page web ni un script de contenu, dont l'adresse
  // est celle de la page) ouverte dans un onglet avec « ?url=<motif> » désigne l'onglet à examiner par son adresse (motif de correspondance des
  // extensions, sans port, ex. « https://exemple.fr/* »). Sert au diagnostic et aux essais sous Firefox, où une popup ne peut pas être ouverte
  // par programme : sinon l'onglet serait la page de l'extension elle-même. Testé AVANT sender.tab, qu'une page d'extension en onglet possède.
  if (typeof motifUrl === 'string' && motifUrl.length < 300 && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    const trouves = await chrome.tabs.query({ url: motifUrl }).catch(() => []);
    if (trouves[0]?.id !== undefined) return trouves[0].id;
  }
  // Depuis un popup, sender.tab est absent : c'est tabs.query, pas sender, qui donne l'onglet actif.
  if (sender.tab?.id !== undefined) return sender.tab.id;
  const onglets = await chrome.tabs.query({ active: true, currentWindow: true });
  return onglets[0]?.id;
}

async function lireReglages(): Promise<Reglages> {
  const stocke = await chrome.storage.local.get('reglages');
  const lus = (stocke.reglages ?? {}) as Partial<Reglages>;
  return {
    journalActif: typeof lus.journalActif === 'boolean' ? lus.journalActif : REGLAGES_PAR_DEFAUT.journalActif,
    avertirConnexion: estModeAvertissement(lus.avertirConnexion) ? lus.avertirConnexion : REGLAGES_PAR_DEFAUT.avertirConnexion,
    modeEnvoi: estModeEnvoi(lus.modeEnvoi) ? lus.modeEnvoi : REGLAGES_PAR_DEFAUT.modeEnvoi,
  };
}

async function lireSignalements(): Promise<EntreeSignalement[]> {
  const stocke = await chrome.storage.local.get('signalements');
  return (stocke.signalements as EntreeSignalement[] | undefined) ?? [];
}

// 14.22 B : mémoire « déjà vu », locale, par hôte — l'empreinte tronquée, jamais l'hôte.
async function hoteDejaVu(hote: string): Promise<boolean> {
  const stocke = await chrome.storage.local.get('hotesVus');
  return ((stocke.hotesVus as string[] | undefined) ?? []).includes(await empreinteHote(hote));
}

async function memoriserHoteVu(hote: string): Promise<void> {
  const stocke = await chrome.storage.local.get('hotesVus');
  const existants = (stocke.hotesVus as string[] | undefined) ?? [];
  await chrome.storage.local.set({ hotesVus: ajouterHoteVu(existants, await empreinteHote(hote)) });
}

async function ajouterAuJournal(entree: EntreeJournal): Promise<void> {
  const stocke = await chrome.storage.local.get('journal');
  const existant = (stocke.journal as EntreeJournal[] | undefined) ?? [];
  await chrome.storage.local.set({ journal: purgerJournal([...existant, entree]) });
}

async function ajouterAuxSignalements(entree: EntreeSignalement): Promise<void> {
  const stocke = await chrome.storage.local.get('signalements');
  const existant = (stocke.signalements as EntreeSignalement[] | undefined) ?? [];
  // 14.4 point 3 : aucune expiration automatique, on ne purge jamais cette liste.
  await chrome.storage.local.set({ signalements: [...existant, entree] });
}

async function traiterAnalyseFrame(entree: EntreeAnalyse, tabId: number, frameId: number): Promise<void> {
  const rapports = await lireRapports(tabId);
  const misAJour = [...rapports.filter((r) => r.frameId !== frameId), { frameId, entree }];
  await ecrireRapports(tabId, misAJour);

  const entreeFusionnee = fusionnerFrames(misAJour);
  if (!entreeFusionnee) return; // la frame principale n'a pas encore rapporté

  const listes = await listesCourantes();
  // 14.57 : imitation retenue d'une page précédente du MÊME hôte (session, 15 minutes), passée au moteur en entrée.
  const hotePage = entreeFusionnee.url?.hote;
  const tableMemoire = ((await chrome.storage.session.get(CLE_MEMOIRE_IMITATION))[CLE_MEMOIRE_IMITATION] as TableMemoireImitation | undefined) ?? undefined;
  const imitationRetenue = hotePage ? lireImitationRetenue(tableMemoire, hotePage, Date.now()) : undefined;
  const verdict = analyser(entreeFusionnee, listes, config, imitationRetenue ? { imitationRetenue } : {});
  const aRetenir = hotePage ? imitationARetenir(entreeFusionnee, verdict, listes) : null;
  if (hotePage && aRetenir) await chrome.storage.session.set({ [CLE_MEMOIRE_IMITATION]: retenirImitation(tableMemoire, hotePage, aRetenir, Date.now()) });
  console.log(`[Tourmentin] onglet ${tabId} : ${verdict.niveau} — ${verdict.motif}`, verdict);

  const href = entreeFusionnee.url?.href;
  if (href) {
    const url = entreeFusionnee.url;
    await ecrireEtatOnglet(tabId, {
      verdict,
      href,
      cible: url ? { hote: url.hote, schema: url.schema, domaineEnregistrable: url.domaineEnregistrable } : undefined,
    });
    if (estEligibleAuJournalAutomatique(verdict.niveau)) {
      const reglages = await lireReglages();
      if (reglages.journalActif) await ajouterAuJournal(construireEntreeJournal(href, verdict));
    }
  }

  appliquerBadge(tabId, verdict.niveau);

  // 14.22 B : la décision d'afficher le bandeau de connexion est prise ici.
  let bandeauConnexion: { hote: string } | undefined;
  const urlAnalysee = entreeFusionnee.url;
  if (urlAnalysee && verdict.niveau === 'N0') {
    const reglages = await lireReglages();
    if (reglages.avertirConnexion !== 'jamais') {
      const cible = { hote: urlAnalysee.hote, schema: urlAnalysee.schema, domaineEnregistrable: urlAnalysee.domaineEnregistrable };
      const statut = determinerStatut(verdict, cible, listes, await lireSignalements(), reglages.modeEnvoi);
      if (doitAfficherBandeauConnexion(statut, reglages.avertirConnexion, await hoteDejaVu(cible.hote))) {
        bandeauConnexion = { hote: cible.hote };
        await memoriserHoteVu(cible.hote);
        // 14.24 A1 : un entier par jour, jamais l'hôte.
        const compteur = ((await chrome.storage.local.get('bandeauxParJour')).bandeauxParJour ?? {}) as CompteurBandeaux;
        await chrome.storage.local.set({ bandeauxParJour: incrementerCompteur(compteur) });
      }
    }
  }

  const reponse: MessageDepuisArrierePlan = { type: 'VERDICT', verdict, ...(bandeauConnexion ? { bandeauConnexion } : {}) };
  chrome.tabs.sendMessage(tabId, reponse).catch(() => {
    // L'onglet a pu se fermer entre l'analyse et l'envoi : pas une erreur à remonter.
  });
}

// 14.6 point b : les fichiers d'icône par niveau n'existent pas encore
// (14.2.2, manque listé) — le badge de l'action est un intermédiaire
// fonctionnel qui ne bloque pas sur la conception graphique, pas le rendu
// final. N0 : aucun badge, silence complet (5.7). N1 à N3 : texte et couleur
// distincts, l'interstitiel N3 restant par ailleurs désactivé dans le build
// d'essai (14.5).
const BADGE_PAR_NIVEAU: Record<Verdict['niveau'], { texte: string; couleur: string } | null> = {
  N0: null,
  N1: { texte: '!', couleur: '#E8A33D' },
  N2: { texte: '!!', couleur: '#D9822B' },
  N3: { texte: '!!!', couleur: '#C0392B' },
};

// 14.15 point 1 : le build de mesure s'annonce sur le badge, à tous les
// niveaux, N0 compris — une marque « M » violette que le build d'essai ne
// porte jamais.
const COULEUR_BADGE_MESURE = '#6D28D9';

function appliquerBadge(tabId: number, niveau: Verdict['niveau']): void {
  const badge = BADGE_PAR_NIVEAU[niveau];
  const texte = (BUILD_DE_MESURE ? 'M' : '') + (badge?.texte ?? '');
  void chrome.action.setBadgeText({ tabId, text: texte }).catch(() => {});
  const couleur = BUILD_DE_MESURE && !badge ? COULEUR_BADGE_MESURE : badge?.couleur;
  if (couleur) void chrome.action.setBadgeBackgroundColor({ tabId, color: couleur }).catch(() => {});
}

if (BUILD_DE_MESURE) {
  // Aussi sur les onglets jamais analysés (chrome://, avant le premier verdict).
  void chrome.action.setBadgeText({ text: 'M' }).catch(() => {});
  void chrome.action.setBadgeBackgroundColor({ color: COULEUR_BADGE_MESURE }).catch(() => {});
}

/**
 * 14.43 : types de message qui n'attendent AUCUNE réponse (le contenu ou une page lance et passe). Tous les autres reçoivent
 * toujours une réponse : celle du traitement, ou « ERREUR_SW », ou « INCONNU » : jamais un silence, qui laissait les pages
 * lire une propriété d'un objet absent.
 */
const TYPES_SANS_REPONSE = new Set<string>(['ANALYSE_FRAME', 'OUVRIR_VERIFIER', 'OUVRIR_GESTION', 'EFFACER_JOURNAL', 'EFFACER_SIGNALEMENT']);
const DELAI_REPONSE_MS = 8000;

function traiterMessage(message: MessageDepuisContenu, sender: chrome.runtime.MessageSender, sendResponse: (reponse?: unknown) => void): boolean | undefined {
  if (message.type === 'LIRE_VERSION') {
    sendResponse({ type: 'VERSION', build: BUILD_ID } satisfies MessageDepuisArrierePlan);
    return;
  }

  if (message.type === 'ANALYSE_FRAME') {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;
    if (tabId === undefined || frameId === undefined) return;
    void traiterAnalyseFrame(message.entree, tabId, frameId);
    return;
  }

  if (message.type === 'DEMANDER_VERDICT_ONGLET') {
    void resoudreTabId(sender).then(async (tabId) => {
      const etat = tabId === undefined ? null : await lireEtatOnglet(tabId);
      const reponse: MessageDepuisArrierePlan = { type: 'VERDICT_ONGLET', verdict: etat?.verdict ?? null };
      sendResponse(reponse);
    });
    return true; // réponse asynchrone (chrome.runtime.onMessage)
  }

  if (message.type === 'DEMANDER_STATUT_ONGLET') {
    void resoudreTabId(sender, message.ongletUrl).then(async (tabId) => {
      const etat = tabId === undefined ? null : await lireEtatOnglet(tabId);
      let statut: StatutAffiche | null = null;
      if (etat?.cible) {
        statut = determinerStatut(etat.verdict, etat.cible, await listesCourantes(), await lireSignalements(), (await lireReglages()).modeEnvoi);
      } else if (tabId !== undefined) {
        const onglet = await chrome.tabs.get(tabId).catch(() => undefined);
        statut = statutSansVerdict(onglet?.url);
        // 14.22 A : sans verdict, on redemande une analyse au script de contenu s'il est là ; s'il n'y est pas
        // (onglet ouvert avant l'installation), l'envoi échoue sans conséquence et la popup affichera son repli.
        if (statut === null && message.relancer) {
          const relance: MessageDepuisArrierePlan = { type: 'REANALYSER' };
          void chrome.tabs.sendMessage(tabId, relance).catch(() => {});
        }
      }
      const reponse: MessageDepuisArrierePlan = { type: 'STATUT_ONGLET', statut };
      sendResponse(reponse);
    });
    return true;
  }

  if (message.type === 'OUVRIR_VERIFIER') {
    // Aucun paramètre venu de la page : l'adresse ouverte est fixe (C6).
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') + '#verifier' });
    return;
  }

  if (message.type === 'LIRE_REGLAGES') {
    void lireReglages().then((reglages) => {
      const reponse: MessageDepuisArrierePlan = { type: 'REGLAGES', journalActif: reglages.journalActif, avertirConnexion: reglages.avertirConnexion, modeEnvoi: reglages.modeEnvoi };
      sendResponse(reponse);
    });
    return true;
  }

  if (message.type === 'ECRIRE_REGLAGES') {
    void lireReglages().then(async (actuels) => {
      const suivants: Reglages = {
        journalActif: message.journalActif ?? actuels.journalActif,
        avertirConnexion: estModeAvertissement(message.avertirConnexion) ? message.avertirConnexion : actuels.avertirConnexion,
        modeEnvoi: estModeEnvoi(message.modeEnvoi) ? message.modeEnvoi : actuels.modeEnvoi,
      };
      await chrome.storage.local.set({ reglages: suivants });
      sendResponse({ type: 'REGLAGES_ECRITS', ok: true } satisfies MessageDepuisArrierePlan);
    }).catch(() => sendResponse({ type: 'REGLAGES_ECRITS', ok: false } satisfies MessageDepuisArrierePlan));
    return true;
  }

  if (message.type === 'LIRE_JOURNAL') {
    void chrome.storage.local.get('journal').then((stocke) => {
      const reponse: MessageDepuisArrierePlan = { type: 'JOURNAL', entrees: (stocke.journal as EntreeJournal[] | undefined) ?? [] };
      sendResponse(reponse);
    });
    return true;
  }

  if (message.type === 'EFFACER_JOURNAL') {
    void chrome.storage.local.set({ journal: [] }).then(() => sendResponse());
    return true;
  }

  if (message.type === 'LIRE_SIGNALEMENTS') {
    void chrome.storage.local.get('signalements').then((stocke) => {
      const reponse: MessageDepuisArrierePlan = { type: 'SIGNALEMENTS', entrees: (stocke.signalements as EntreeSignalement[] | undefined) ?? [] };
      sendResponse(reponse);
    });
    return true;
  }

  if (message.type === 'EFFACER_SIGNALEMENT') {
    void chrome.storage.local.get('signalements').then(async (stocke) => {
      const existant = (stocke.signalements as EntreeSignalement[] | undefined) ?? [];
      await chrome.storage.local.set({ signalements: existant.filter((e) => e.horodatage !== message.horodatage) });
      sendResponse();
    });
    return true;
  }

  // 14.7 point 3 : l'aperçu ne construit rien de définitif, l'entrée exacte
  // qu'il montre est mise de côté (session, par onglet) pour que la
  // confirmation n'écrive jamais autre chose que ce qui a été montré.
  // 14.19 B : quand le réglage n'est pas « Ne jamais envoyer », l'aperçu montre aussi, mot pour mot,
  // le corps qui partirait vers tourmentin.fr.
  if (message.type === 'DEMANDER_APERCU_DECLARATION') {
    void resoudreTabId(sender, message.ongletUrl).then(async (tabId) => {
      const etat = tabId !== undefined ? await lireEtatOnglet(tabId) : null;
      if (!etat || tabId === undefined) {
        const reponse: MessageDepuisArrierePlan = { type: 'APERCU_DECLARATION', texte: null };
        sendResponse(reponse);
        return;
      }
      const declaration = message.declaration ?? 'frauduleuse';
      const entree = construireEntreeSignalement(etat.href, etat.verdict, undefined, declaration);
      const { modeEnvoi } = await lireReglages();
      let rapport: RapportDeclaration | undefined;
      if (modeEnvoi !== 'jamais') {
        const page = await collecterRapportPage(tabId);
        rapport = construireRapport({
          type: declaration,
          href: etat.href,
          verdict: etat.verdict,
          textes: page?.textes,
          images: page?.images,
          versionExtension: chrome.runtime.getManifest().version,
        });
      }
      await chrome.storage.session.set({ [cleDeclarationEnAttente(tabId)]: { entree, rapport } satisfies DeclarationEnAttente });
      const reponse: MessageDepuisArrierePlan = {
        type: 'APERCU_DECLARATION',
        texte: apercuSignalement(entree),
        ...(rapport ? { envoi: { mode: modeEnvoi, corps: JSON.stringify(rapport, null, 2) } } : {}),
      };
      sendResponse(reponse);
    });
    return true;
  }

  // La confirmation écrit toujours l'entrée ici. Elle n'envoie que si le réglage l'autorise : « automatique » envoie,
  // « me demander » envoie seulement si l'usager a répondu oui à la question de l'aperçu, « jamais » n'envoie jamais.
  if (message.type === 'CONFIRMER_DECLARATION') {
    void resoudreTabId(sender, message.ongletUrl).then(async (tabId) => {
      if (tabId === undefined) {
        sendResponse({ type: 'DECLARATION_ENREGISTREE', envoi: 'non' } satisfies MessageDepuisArrierePlan);
        return;
      }
      const stocke = await chrome.storage.session.get(cleDeclarationEnAttente(tabId));
      const attente = stocke[cleDeclarationEnAttente(tabId)] as DeclarationEnAttente | undefined;
      if (!attente) {
        sendResponse({ type: 'DECLARATION_ENREGISTREE', envoi: 'non' } satisfies MessageDepuisArrierePlan);
        return;
      }
      const { modeEnvoi } = await lireReglages();
      const doitEnvoyer = attente.rapport !== undefined && (modeEnvoi === 'automatique' || (modeEnvoi === 'demander' && message.envoyer === true));
      let envoi: 'non' | 'ok' | 'echec' = 'non';
      let erreur: string | undefined;
      const entree = { ...attente.entree };
      if (doitEnvoyer && attente.rapport) {
        const resultat = await envoyerDeclaration(modeEnvoi, attente.rapport);
        envoi = resultat.ok ? 'ok' : 'echec';
        erreur = resultat.erreur;
        entree.envoi = envoi;
      }
      await ajouterAuxSignalements(entree);
      await chrome.storage.session.remove(cleDeclarationEnAttente(tabId));
      sendResponse({ type: 'DECLARATION_ENREGISTREE', envoi, ...(erreur ? { erreur } : {}) } satisfies MessageDepuisArrierePlan);
    }).catch(() => {
      // Toute exception : l'interface ne reste jamais suspendue à une réponse qui ne viendra pas.
      sendResponse({ type: 'DECLARATION_ENREGISTREE', envoi: 'echec', erreur: 'erreur-interne' } satisfies MessageDepuisArrierePlan);
    });
    return true;
  }

  // 14.20 G : rôle, liaison et actions. Rien de tout cela ne part si le réglage est « Ne jamais envoyer » (appelerApi refuse).
  if (message.type === 'LIRE_ROLE') {
    void lireReglages().then(async ({ modeEnvoi }) => {
      const r = await lireRole(modeEnvoi, message.forcer === true);
      sendResponse({ type: 'ROLE', lie: r.lie, role: r.role } satisfies MessageDepuisArrierePlan);
    }).catch(() => sendResponse({ type: 'ROLE', lie: false, role: null } satisfies MessageDepuisArrierePlan));
    return true;
  }

  if (message.type === 'LIRE_LIAISON') {
    void etatLiaison().then((r) => sendResponse({ type: 'LIAISON_ETAT', lie: r.lie, role: r.role } satisfies MessageDepuisArrierePlan)).catch(() => sendResponse({ type: 'ERREUR_SW', raison: 'exception' } satisfies MessageDepuisArrierePlan));
    return true;
  }

  // 14.84 : « Vous avez déclaré N sites » vient de la liste locale ; l'appel au serveur n'a lieu que si au moins une déclaration « officiel » a été envoyée.
  if (message.type === 'LIRE_CONTRIBUTION') {
    void (async () => {
      const stocke = await chrome.storage.local.get('signalements');
      const officiels = ((stocke.signalements as EntreeSignalement[] | undefined) ?? []).filter((e) => (e.type ?? 'frauduleuse') === 'officiel');
      const envoyees = new Set(officiels.filter((e) => e.envoi === 'ok').map((e) => e.hote)).size;
      const declarees = new Set(officiels.map((e) => e.hote)).size;
      const { modeEnvoi } = await lireReglages();
      const p = envoyees > 0 ? await lireProposition(modeEnvoi) : { proposee: false, code: null };
      sendResponse({ type: 'CONTRIBUTION', declarees, envoyees, proposee: p.proposee, code: p.code } satisfies MessageDepuisArrierePlan);
    })().catch(() => sendResponse({ type: 'CONTRIBUTION', declarees: 0, envoyees: 0, proposee: false, code: null } satisfies MessageDepuisArrierePlan));
    return true;
  }

  if (message.type === 'LIER_COMPTE') {
    void lireReglages().then(async ({ modeEnvoi }) => {
      const r = await lierCompte(modeEnvoi, message.code.trim().slice(0, 40));
      sendResponse({ type: 'LIAISON', ...r } satisfies MessageDepuisArrierePlan);
    }).catch(() => sendResponse({ type: 'LIAISON', ok: false, erreur: 'erreur-interne' } satisfies MessageDepuisArrierePlan));
    return true;
  }

  if (message.type === 'DELIER_COMPTE') {
    void delierInstallation().then(() => sendResponse({ type: 'LIAISON_ETAT', lie: false, role: null } satisfies MessageDepuisArrierePlan)).catch(() => sendResponse({ type: 'ERREUR_SW', raison: 'exception' } satisfies MessageDepuisArrierePlan));
    return true;
  }

  if (message.type === 'ACTION_ROLE') {
    void resoudreTabId(sender, message.ongletUrl).then(async (tabId) => {
      const etat = tabId !== undefined ? await lireEtatOnglet(tabId) : null;
      if (!etat) {
        sendResponse({ type: 'ACTION', ok: false, erreur: 'pas-d-analyse' } satisfies MessageDepuisArrierePlan);
        return;
      }
      const { modeEnvoi } = await lireReglages();
      const rapport = construireRapport({ type: 'officiel', href: etat.href, verdict: etat.verdict });
      const r = await actionRole(modeEnvoi, message.action, { hote: rapport.hote, marque: rapport.marque, paiement: rapport.paiement });
      sendResponse({ type: 'ACTION', ...r } satisfies MessageDepuisArrierePlan);
    }).catch(() => sendResponse({ type: 'ACTION', ok: false, erreur: 'erreur-interne' } satisfies MessageDepuisArrierePlan));
    return true;
  }

  if (message.type === 'OUVRIR_GESTION') {
    // Adresse fixe : aucun paramètre venu de la page (C6, 9.4).
    void chrome.tabs.create({ url: 'https://tourmentin.fr/gestion' });
    return;
  }

  // Type inconnu de CE service worker (page plus récente que lui) : on le dit, on ne se tait pas.
  sendResponse({ type: 'INCONNU' } satisfies MessageDepuisArrierePlan);
  return;
}

// 14.43 : le seul écouteur. Il garantit une réponse unique à tout message qui en attend une.
chrome.runtime.onMessage.addListener((message: MessageDepuisContenu, sender, sendResponse) => {
  if (typeof message !== 'object' || message === null || TYPES_SANS_REPONSE.has(message.type)) return traiterMessage(message, sender, sendResponse);
  let repondu = false;
  const unique = (reponse?: unknown): void => {
    if (repondu) return;
    repondu = true;
    clearTimeout(minuteur);
    try {
      sendResponse(reponse);
    } catch {
      // le canal est déjà fermé (page fermée) : rien à faire
    }
  };
  const minuteur = setTimeout(() => unique({ type: 'ERREUR_SW', raison: 'delai' } satisfies MessageDepuisArrierePlan), DELAI_REPONSE_MS);
  try {
    const asynchrone = traiterMessage(message, sender, unique);
    if (asynchrone !== true && !repondu) {
      // traitement synchrone sans réponse : on répond quand même
      unique({ type: 'ERREUR_SW', raison: 'exception' } satisfies MessageDepuisArrierePlan);
    }
    return true;
  } catch {
    unique({ type: 'ERREUR_SW', raison: 'exception' } satisfies MessageDepuisArrierePlan);
    return false;
  }
});

// SPA : l'URL change sans rechargement (6.5). Les anciens rapports de frames
// ne valent plus rien ; on les jette et on redemande une analyse immédiate,
// en complément du MutationObserver côté content script (secours mutuel).
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  void viderEtatOnglet(details.tabId).then(() => {
    const message: MessageDepuisArrierePlan = { type: 'REANALYSER' };
    return chrome.tabs.sendMessage(details.tabId, message).catch(() => {});
  });
});

// Navigation complète du frame principal : les frames enfants vont se
// recharger et rapporter à neuf, mais si la nouvelle page a moins d'iframes
// que l'ancienne, un rapport enfant obsolète resterait sinon indéfiniment.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) void viderEtatOnglet(details.tabId);
});

// Nettoyage explicite (4.2) : sans lui, chrome.storage.session fuit une
// entrée par onglet fermé pour toute la durée de vie du navigateur.
chrome.tabs.onRemoved.addListener((tabId) => {
  void viderEtatOnglet(tabId);
});
