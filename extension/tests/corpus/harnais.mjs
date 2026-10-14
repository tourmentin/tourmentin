// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lot L5, livrable 1-4 : harnais Playwright, Chromium, extension chargée en
// contexte persistant. Le verdict est capté depuis l'extension elle-même
// (le message console du content script), jamais recalculé — c'est la
// chaîne complète qu'on mesure, adaptateur DOM compris (spec 12.3).
//
// Conditions d'exécution du harnais lui-même : spec 12.3.1. Headless par
// défaut (channel: 'chromium', requis pour que l'extension se charge),
// concurrence 4, services d'arrière-plan coupés, et un filtrage de
// ressources strictement limité à ce que 12.3.1 autorise — voir
// filtrage-ressources.mjs, qui porte le garde-fou testé.
//
// Recevabilité du rapport, spec 12.3.2 : dix pages d'imitation
// (extension/tests/pages/imitations/) traversent la même passe comme témoin
// positif — si l'une des neuf « fortes » ne remonte pas au moins N1, le
// rapport le dit en tête, avant les taux de faux positifs. Le rapport donne
// aussi la surface de test effective (pages ayant atteint le calcul de
// score) à côté du total analysé, et le motif des pages non joignables.
//
// À exécuter depuis extension/ : npm run harnais
// Options :
//   --limit=N          sous-échantillon, les N premiers hôtes (tests rapides)
//   --aleatoire=N       sous-échantillon de N hôtes tirés au hasard
//   --segment=xxx       filtre par segment du corpus
//   --fenetre           force l'affichage (headless par défaut sinon)
//   --concurrence=N     pages simultanées, 4 par défaut
//   --repartir-de-zero  ignore extension/tests/corpus/resultats.jsonl existant
//   --mesure-latence    spec 12.3.1.3 : campagne de mesure de latence dédiée,
//                       distincte de la passe de faux positifs (voir plus bas)
//   --suffixe=xxx       n'a d'effet qu'avec --mesure-latence (12.3.3.8) : écrit
//                       dans mesure-latence-xxx.jsonl / MESURE-LATENCE-<date>-xxx.md
//                       au lieu des noms par défaut, pour répéter la campagne
//                       plusieurs fois sur le même échantillon sans que la
//                       reprise jsonl ne fasse sauter la répétition suivante
//
// Ne modifie ni ne régénère le corpus (corpus/corpus-legitimes-v3.csv) :
// c'est une donnée déjà constituée, voir corpus/README.md.
//
// Spec 12.3.1.3 : --mesure-latence lance une campagne séparée, écrite dans
// mesure-latence.jsonl et docs/MESURE-LATENCE-<date>.md, jamais dans le
// rapport de faux positifs. Fenêtre d'analyse élargie à 10 s DANS CE MODE
// SEUL, portée par fenetre-analyse.mjs (FENETRE_FP_MS / FENETRE_LATENCE_MS) :
// analyserUneUrl() n'accepte pas de fenêtre en paramètre, elle utilise
// toujours FENETRE_FP_MS en dur — c'est la garantie structurelle (doublée par
// fenetre-analyse.test.ts) que la fenêtre élargie ne peut pas fuir dans la
// passe de faux positifs.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from 'tldts';
import { doitBloquerRessource } from './filtrage-ressources.mjs';
import { HOTES_REGIES_PUBLICITAIRES } from './regies-publicitaires.mjs';
import { FENETRE_FP_MS, FENETRE_LATENCE_MS } from './fenetre-analyse.mjs';
import { decouperLigneCsv } from './csv.mjs';
import { tirerAuHasard } from './tirage.mjs';
import { lireTousLesResultats as lireTousLesResultatsDe, chargerResultatsPourReprise as chargerResultatsPourRepriseDe, ecrireResultat as ecrireResultatDans } from './jsonl.mjs';
import { formaterDuree, traiterEnParallele } from './pool-concurrent.mjs';
import { armerFiletDeSecurite } from './filet-de-securite.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_PROJET = join(ICI, '..', '..', '..');
const DIST = join(ICI, '..', '..', 'dist', 'chrome-mesure');
const CORPUS_CSV_DEFAUT = join(RACINE_PROJET, 'corpus', 'corpus-legitimes-v3.csv');
const DOSSIER_PORTAILS = join(RACINE_PROJET, 'corpus', 'portails-captifs');
const DOSSIER_IMITATIONS = join(RACINE_PROJET, 'extension', 'tests', 'pages', 'imitations');
const DOSSIER_SOCLE = join(RACINE_PROJET, 'listes', 'socle');
const DOSSIER_DOCS = join(RACINE_PROJET, 'docs');

// Témoin positif (spec 12.3.2) : les dix pages d'imitation déjà écrites pour
// le lot L3, servies via page.route() sous leur URL de typosquat plausible
// plutôt que sous une adresse locale — c'est cette URL, pas le contenu seul,
// que le moteur analyse (I3, I4, I7, I8 lisent le domaine). Neuf « fortes »
// doivent produire au moins N1 ; la dixième est délibérément faible et doit
// rester en N0, elle vérifie que le moteur ne bloque pas systématiquement.
const TEMOINS_POSITIFS = [
  { fichier: '01-impots-gouv.html', url: 'https://impots-gouv.fr/connexion', attenduN1Plus: true },
  { fichier: '02-ameli.html', url: 'https://ameli-secure.fr/connexion', attenduN1Plus: true },
  { fichier: '03-caf.html', url: 'https://caf-prestations.fr/connexion', attenduN1Plus: true },
  { fichier: '04-franceconnect.html', url: 'https://franceconnect-secure.fr/connexion', attenduN1Plus: true },
  { fichier: '05-laposte-colis.html', url: 'https://laposte-colis-frais.fr/paiement', attenduN1Plus: true },
  { fichier: '06-urssaf.html', url: 'https://urssaf-declaration.fr/connexion', attenduN1Plus: true },
  { fichier: '07-ants-carte-grise.html', url: 'https://ants-carte-grise.fr/connexion', attenduN1Plus: true },
  { fichier: '08-france-travail.html', url: 'https://francetravail-actualisation.fr/connexion', attenduN1Plus: true },
  { fichier: '09-service-public.html', url: 'https://service-public-demarches.fr/connexion', attenduN1Plus: true },
  { fichier: '10-impots-faible.html', url: 'https://mon-espace-perso.fr/connexion', attenduN1Plus: false },
];

const arguments_ = process.argv.slice(2);
function optionNombre(nom) {
  const brut = arguments_.find((a) => a.startsWith(`--${nom}=`))?.split('=')[1];
  return brut ? Number(brut) : undefined;
}
const LIMITE = optionNombre('limit');
const ALEATOIRE = optionNombre('aleatoire');
const FILTRE_SEGMENT = arguments_.find((a) => a.startsWith('--segment='))?.split('=')[1];
const FENETRE = arguments_.includes('--fenetre');
const CONCURRENCE = optionNombre('concurrence') ?? 4;
const REPARTIR_DE_ZERO = arguments_.includes('--repartir-de-zero');
const MODE_LATENCE = arguments_.includes('--mesure-latence');
const SUFFIXE = arguments_.find((a) => a.startsWith('--suffixe='))?.split('=')[1];
// Comparaison avant/après 12.3.1 uniquement : fait traiter le même
// échantillon (généré par generer-echantillon.mjs) plutôt que le corpus
// complet. Absent en usage normal.
const CORPUS_CSV = arguments_.find((a) => a.startsWith('--fichier-corpus='))?.split('=')[1] ?? CORPUS_CSV_DEFAUT;
// 12.3.1.3 : deux fichiers de sortie distincts, jamais mélangés — la
// campagne de mesure de latence ne doit pas polluer resultats.jsonl ni,
// via lui, RAPPORT-FP-*.md.
const SUFFIXE_FICHIER = SUFFIXE ? `-${SUFFIXE}` : '';
const FICHIER_RESULTATS = join(ICI, MODE_LATENCE ? `mesure-latence${SUFFIXE_FICHIER}.jsonl` : 'resultats.jsonl');

const TIMEOUT_NAVIGATION_MS = 15_000;
// 12.3.1 : ne pas descendre sous 1,5 s sans mesure montrant que le verdict
// arrive plus tôt — le pipeline traverse deux messages (contenu → arrière-plan
// → contenu) et un débounce de 300 ms côté contenu. Constante utilisée en dur
// par analyserUneUrl() uniquement (12.3.1.3) : ne jamais la remplacer par un
// paramètre, c'est ce qui empêche structurellement la fenêtre élargie de
// mesure de latence de s'y substituer.
const ATTENTE_ANALYSE_MS = FENETRE_FP_MS;

// --- CSV -------------------------------------------------------------------

function chargerCorpus() {
  const lignes = readFileSync(CORPUS_CSV, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  const entetes = decouperLigneCsv(lignes[0]);
  const iDomaine = entetes.indexOf('domaine');
  const iHote = entetes.indexOf('hote');
  const iUrl = entetes.indexOf('url');
  const iSegment = entetes.indexOf('segment');
  let lignesCorpus = lignes.slice(1).map((ligne) => {
    const champs = decouperLigneCsv(ligne);
    return { domaine: champs[iDomaine], hote: champs[iHote], url: champs[iUrl], segment: champs[iSegment] };
  });
  if (FILTRE_SEGMENT) lignesCorpus = lignesCorpus.filter((l) => l.segment === FILTRE_SEGMENT);
  if (ALEATOIRE) lignesCorpus = tirerAuHasard(lignesCorpus, ALEATOIRE);
  else if (LIMITE) lignesCorpus = lignesCorpus.slice(0, LIMITE);
  return lignesCorpus;
}

// --- collision des racines typographiques (12.6) ----------------------------

// Même règle que listes/outils/comparaison-racines.ts (spec 12.3.2), dupliquée
// ici en JS simple : ce script n'a pas de chaîne d'import TS vers listes/, au
// même titre que verifierRacinesTypo() lui-même duplique déjà la logique de
// listes/outils/verifier-racines-typo.ts plutôt que de l'importer.
const LONGUEUR_MIN_CORRESPONDANCE_PARTIELLE = 6;

function racineCorrespondAuHote(racine, hote) {
  const racineNormalisee = racine.toLowerCase();
  const etiquettes = hote.toLowerCase().split(/[.-]/);
  return etiquettes.some(
    (etiquette) =>
      etiquette === racineNormalisee ||
      (racineNormalisee.length >= LONGUEUR_MIN_CORRESPONDANCE_PARTIELLE && etiquette.includes(racineNormalisee)),
  );
}

function verifierRacinesTypo(corpus) {
  const empreintes = readdirSync(DOSSIER_SOCLE)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(DOSSIER_SOCLE, f), 'utf8')));
  const collisions = [];
  let nbRacines = 0;
  for (const empreinte of empreintes) {
    for (const racine of empreinte.racines_typo) {
      nbRacines++;
      for (const ligne of corpus) {
        if (racineCorrespondAuHote(racine, ligne.hote)) {
          collisions.push({ racine, marque: empreinte.id, hote: ligne.hote, domaine: ligne.domaine, segment: ligne.segment });
        }
      }
    }
  }
  return { nbRacines, collisions };
}

// --- serveur local pour les portails captifs --------------------------------

const TYPES_MIME = { '.html': 'text/html; charset=utf-8' };

function demarrerServeurPortails() {
  return new Promise((resolve) => {
    const serveur = createServer((req, res) => {
      const fichier = join(DOSSIER_PORTAILS, decodeURIComponent(req.url ?? '').replace(/^\/+/, ''));
      try {
        const contenu = readFileSync(fichier);
        res.writeHead(200, { 'Content-Type': TYPES_MIME[extname(fichier)] ?? 'application/octet-stream' });
        res.end(contenu);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    serveur.listen(0, '127.0.0.1', () => resolve(serveur));
  });
}

// --- reprise : résultats écrits au fil de l'eau (12.3.1) --------------------

const lireTousLesResultats = () => lireTousLesResultatsDe(FICHIER_RESULTATS);
const chargerResultatsPourReprise = () => chargerResultatsPourRepriseDe(FICHIER_RESULTATS, REPARTIR_DE_ZERO);
const ecrireResultat = (entree) => ecrireResultatDans(FICHIER_RESULTATS, entree);

// --- domaine enregistrable, pour détecter une redirection hors domaine -----

/**
 * 12.3.1.1 : compare le domaine enregistrable demandé à celui où la page a
 * réellement atterri. Même bibliothèque que le moteur (moteur/domaine.ts) —
 * tldts, déjà en dépendance — pour rester cohérent avec ce que l'extension
 * elle-même considère comme « le » domaine d'une page.
 */
function domaineEnregistrableDe(urlBrute) {
  try {
    return parse(new URL(urlBrute).hostname.toLowerCase()).domain ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * 12.3.2 : à consigner, pas à corriger tant qu'on ne sait pas ce que c'est.
 * page.goto() rejette avec un message qui porte un code net::ERR_… (ou
 * "Timeout … exceeded" au-delà du délai de navigation) ; on l'extrait tel
 * quel plutôt que de ne garder qu'un « non-joignable » muet.
 */
function extraireMotifNonJoignable(erreur) {
  const message = String(erreur?.message ?? erreur);
  const codeNet = message.match(/net::ERR_[A-Z_]+/)?.[0];
  return codeNet ?? (message.includes('Timeout') ? 'timeout' : message.split('\n')[0].slice(0, 120));
}

/**
 * 12.3.3.8 : une page d'erreur personnalisée répond hors 2xx en servant du
 * HTML normal — page.goto() ne le voit pas comme un échec. Relevé ici comme
 * dans trouver-connexion.mjs, pour le même motif.
 */
function reponseNonAcceptable(reponse) {
  if (!reponse) return false;
  const code = reponse.status();
  return code < 200 || code >= 300;
}

// --- analyse d'une page via l'extension --------------------------------------

async function analyserUneUrl(page, url) {
  const verdicts = [];
  let injectionRecue = false;
  const ecouteur = (msg) => {
    const texte = msg.text();
    if (texte.startsWith('[Tourmentin] injecte')) {
      // 12.3.1.2 : marqueur distinct du verdict, émis à l'exécution du
      // script de contenu — permet de distinguer un script jamais injecté
      // (défaut produit) d'un verdict simplement rendu trop tard (latence).
      injectionRecue = true;
      return;
    }
    if (!texte.startsWith('[Tourmentin] verdict')) return;
    const arg = msg.args()[1];
    // Une page peut rediriger (JS, mur de cookies, détection de locale)
    // pendant la fenêtre d'analyse : le handle devient alors inexploitable
    // avant que jsonValue() ne se résolve. Ce n'est pas une erreur du
    // harnais, juste un verdict qu'on ne peut plus lire — on l'ignore.
    if (arg) verdicts.push({ tempsMs: performance.now(), promesse: arg.jsonValue().catch(() => undefined) });
  };
  page.on('console', ecouteur);

  const debut = performance.now();
  let issue = 'analyse';
  let motifNonJoignable;
  let finNavigationMs;
  let statutReponse;
  try {
    const reponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
    finNavigationMs = performance.now();
    if (reponseNonAcceptable(reponse)) {
      issue = 'reponse-non-2xx';
      statutReponse = reponse.status();
    }
  } catch (erreur) {
    issue = 'non-joignable';
    motifNonJoignable = extraireMotifNonJoignable(erreur);
  }
  if (issue === 'analyse') await page.waitForTimeout(ATTENTE_ANALYSE_MS);
  const dureeMs = performance.now() - debut;
  // 12.3.1.1 : relevée tant que la navigation a réussi, avant tout autre
  // traitement — c'est le second dégât de la page partagée (non mesuré
  // jusqu'ici) : une redirection différée qui gagne la course sans faire
  // échouer page.goto() fait analyser une page différente de celle demandée,
  // sous le nom de l'hôte demandé.
  const urlFinale = issue === 'analyse' ? page.url() : undefined;

  page.off('console', ecouteur);
  const resolus = (
    await Promise.all(verdicts.map(async (v) => ({ tempsMs: v.tempsMs, verdict: await v.promesse })))
  ).filter((r) => r.verdict !== undefined);
  const premier = resolus[0];
  const dernier = resolus.at(-1);
  const dernierVerdict = dernier?.verdict;
  // 12.3.3.10 : C4 porte sur le PREMIER verdict, pas le dernier — c'est ce
  // que l'utilisateur voit en premier. Mesuré ici, dans la passe de faux
  // positifs elle-même (3000+ pages), plutôt que dans la campagne dédiée
  // (300 pages, 95e centile sur treize valeurs, dispersion trop grande pour
  // trancher C4 — la campagne dédiée reste utile pour comparer deux versions
  // du code sur un même tirage, pas pour mesurer C4 lui-même).
  const delaiPremierVerdictMs = premier && finNavigationMs !== undefined ? Math.round(premier.tempsMs - finNavigationMs) : undefined;
  // Délai du dernier verdict, conservé à part : sert au classement N0-N3
  // (dernierVerdict) mais plus à la mesure de C4.
  const delaiVerdictMs = dernier && finNavigationMs !== undefined ? Math.round(dernier.tempsMs - finNavigationMs) : undefined;

  if (issue === 'non-joignable') return { issue, motif: motifNonJoignable, dureeMs };
  if (issue === 'reponse-non-2xx') return { issue, statut: statutReponse, dureeMs };
  if (!dernierVerdict) return { issue: injectionRecue ? 'verdict-tardif' : 'sans-injection', dureeMs };

  if (urlFinale) {
    const domaineDemande = domaineEnregistrableDe(url);
    const domaineFinal = domaineEnregistrableDe(urlFinale);
    if (domaineDemande && domaineFinal && domaineDemande !== domaineFinal) {
      return { issue: 'redirection-hors-domaine', urlFinale, domaineDemande, domaineFinal, verdict: dernierVerdict, delaiVerdictMs, delaiPremierVerdictMs, dureeMs };
    }
  }
  return { issue: 'analyse', urlFinale, verdict: dernierVerdict, delaiVerdictMs, delaiPremierVerdictMs, dureeMs };
}

// --- campagne de mesure de latence (12.3.1.3) --------------------------------

/**
 * Distincte d'analyserUneUrl() à dessein (12.3.1.3) : fenêtre élargie à
 * FENETRE_LATENCE_MS, en dur, jamais partagée avec la fenêtre de la passe de
 * faux positifs. Consigne, par page, le premier ET le dernier verdict rendus
 * pendant la fenêtre (pas seulement le dernier — c'est un des trois défauts
 * de la mesure du 14/09), leur nombre, l'origine du premier (analyse
 * initiale ou réanalyse déclenchée par une mutation du DOM — le point
 * discriminant sur le plancher de 300 ms), et le délai depuis deux départs
 * d'horloge : la fin de la navigation et l'injection du script de contenu.
 *
 * Décomposition en trois temps (collecte DOM / passage du message / exécution
 * du moteur) délibérément absente : performance.now() n'est pas comparable
 * entre le content script et le service worker (deux réalités JS distinctes,
 * sans origine de temps commune fiable), et l'obtenir proprement demanderait
 * d'ajouter des horodatages Date.now() et des console.log dans le chemin
 * chaud du service worker (fusion.ts, service-worker.ts) — au-delà de ce
 * qu'un marqueur de console ponctuel justifie. Trois chiffres justes plutôt
 * que six obtenus en abîmant l'extension.
 */
async function mesurerLatenceUneUrl(page, url) {
  const verdicts = [];
  let injectionRecue = false;
  let tempsInjectionMs;
  const ecouteur = (msg) => {
    const texte = msg.text();
    if (texte.startsWith('[Tourmentin] injecte')) {
      injectionRecue = true;
      tempsInjectionMs = performance.now();
      return;
    }
    const correspondance = texte.match(/^\[Tourmentin\] verdict origine=(\S+) :/);
    if (!correspondance) return;
    const origine = correspondance[1];
    const arg = msg.args()[1];
    if (arg) verdicts.push({ tempsMs: performance.now(), origine, promesse: arg.jsonValue().catch(() => undefined) });
  };
  page.on('console', ecouteur);

  const debut = performance.now();
  let issue = 'analyse';
  let motifNonJoignable;
  let finNavigationMs;
  let statutReponse;
  try {
    const reponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
    finNavigationMs = performance.now();
    if (reponseNonAcceptable(reponse)) {
      issue = 'reponse-non-2xx';
      statutReponse = reponse.status();
    }
  } catch (erreur) {
    issue = 'non-joignable';
    motifNonJoignable = extraireMotifNonJoignable(erreur);
  }
  if (issue === 'analyse') await page.waitForTimeout(FENETRE_LATENCE_MS);
  const dureeMs = performance.now() - debut;

  page.off('console', ecouteur);
  if (issue === 'non-joignable') return { issue, motif: motifNonJoignable, dureeMs };
  if (issue === 'reponse-non-2xx') return { issue, statut: statutReponse, dureeMs };

  const resolus = (
    await Promise.all(verdicts.map(async (v) => ({ tempsMs: v.tempsMs, origine: v.origine, verdict: await v.promesse })))
  ).filter((r) => r.verdict !== undefined);

  if (resolus.length === 0) {
    // 12.3.1.3 : « une mesure dont on ignore la queue n'est pas une mesure » —
    // distinct de sans-injection/verdict-tardif de la passe de faux positifs,
    // parce qu'ici la fenêtre est déjà dix fois plus large ; ne pas confondre
    // les deux notions dans le rapport.
    return { issue: 'censuree', injectionRecue, dureeMs };
  }

  const premier = resolus[0];
  const dernier = resolus.at(-1);
  const calculerDelais = (point) => ({
    depuisNavigationMs: finNavigationMs !== undefined ? Math.round(point.tempsMs - finNavigationMs) : undefined,
    depuisInjectionMs: tempsInjectionMs !== undefined ? Math.round(point.tempsMs - tempsInjectionMs) : undefined,
  });

  return {
    issue: 'mesure',
    nombreVerdicts: resolus.length,
    origineDuPremier: premier.origine,
    premier: { ...calculerDelais(premier), niveau: premier.verdict.niveau },
    dernier: { ...calculerDelais(dernier), niveau: dernier.verdict.niveau },
    dureeMs,
  };
}

/**
 * Sert `temoin.fichier` sous sa propre URL de typosquat via page.route() —
 * une route de page prime sur la route de contexte (filtrage de ressources),
 * et route.fulfill() ne touche jamais le réseau : pas de DNS réel nécessaire
 * pour un domaine qui n'existe pas.
 */
async function analyserTemoin(page, temoin) {
  const contenu = readFileSync(join(DOSSIER_IMITATIONS, temoin.fichier), 'utf8');
  await page.route(temoin.url, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: contenu }));
  try {
    return await analyserUneUrl(page, temoin.url);
  } finally {
    await page.unroute(temoin.url);
  }
}

// --- rapport, reconstruit depuis resultats.jsonl -----------------------------

function tauxPct(nb, total) {
  return total === 0 ? '—' : `${((100 * nb) / total).toFixed(2)} %`;
}

// 12.3.1.2 / 12.3.1.3 : distribution d'une série de délais (navigation →
// verdict, ou l'une des variantes de la campagne de mesure de latence).
function statsDelai(valeurs) {
  if (valeurs.length === 0) return undefined;
  const triees = [...valeurs].sort((a, b) => a - b);
  const percentile = (p) => triees[Math.min(triees.length - 1, Math.ceil((p / 100) * triees.length) - 1)];
  return {
    n: triees.length,
    mediane: percentile(50),
    p90: percentile(90),
    p95: percentile(95),
    p99: percentile(99),
    max: triees[triees.length - 1],
  };
}

// 12.3.2 : les deux motifs qui n'atteignent jamais le calcul de score. Tout
// verdict dont le motif n'est ni l'un ni l'autre a traversé evaluerAxeImitation
// et evaluerAxeExposition — c'est la « surface de test effective ».
const MOTIF_SANS_FORMULAIRE = 'aucun champ de saisie ni formulaire';
const MOTIF_EXPOSITION_NULLE = 'aucune exposition détectée';

function construireRapport({ corpus, resultatsParCle, portailsFichiers, collisionsRacines, nbRacines }) {
  const parHote = new Map(corpus.map((l) => [l.hote, l]));
  const corpusResultats = [];
  for (const [cle, entree] of resultatsParCle) {
    if (!cle.startsWith('corpus:')) continue;
    const ligne = parHote.get(entree.hote);
    if (ligne) corpusResultats.push({ ligne, entree });
  }

  const analyses = corpusResultats.filter((r) => r.entree.issue === 'analyse');
  const nonJoignables = corpusResultats.filter((r) => r.entree.issue === 'non-joignable');
  // 12.3.1.2 : deux issues distinctes là où il n'y en avait qu'une
  // (« erreur-harnais ») — un script jamais injecté est un défaut produit,
  // un script injecté sans verdict dans la fenêtre documente C4.
  const sansInjection = corpusResultats.filter((r) => r.entree.issue === 'sans-injection');
  const verdictsTardifs = corpusResultats.filter((r) => r.entree.issue === 'verdict-tardif');
  // 12.3.1.1 : une redirection vers un autre domaine enregistrable n'est pas
  // un échec — exclue du dénominateur des taux de faux positifs comme des
  // non-joignables, mais consignée à part, nommément.
  const redirectionsHorsDomaine = corpusResultats.filter((r) => r.entree.issue === 'redirection-hors-domaine');
  // 12.3.3.8 : bruit de corpus relevé, non un échec du harnais — une page
  // d'erreur personnalisée qui répond hors 2xx en servant du HTML normal.
  // Hors dénominateur au même titre qu'une redirection hors domaine.
  const reponsesNon2xx = corpusResultats.filter((r) => r.entree.issue === 'reponse-non-2xx');
  const total = analyses.length;

  // 12.3.3.10 : C4 se mesure ici, sur le PREMIER verdict, dans cette passe de
  // 3000+ pages plutôt que dans la campagne dédiée de 300 — le 95e centile y
  // repose sur ~150 valeurs et non 13. Pages sans verdict (sans-injection +
  // verdict-tardif) consignées à part : elles n'entrent pas dans la
  // distribution mais comptent dans ce que C4 doit refléter.
  const delaisPremierVerdict = statsDelai(
    [...analyses, ...redirectionsHorsDomaine].map((r) => r.entree.delaiPremierVerdictMs).filter((v) => typeof v === 'number'),
  );
  const pagesSansVerdict = sansInjection.length + verdictsTardifs.length;

  // 12.3.1.1, critère d'acceptation : si « interrupted by another
  // navigation » réapparaît malgré la page neuve par hôte, l'isolation est
  // incomplète et ça doit être visible en tête de rapport, pas noyé dans la
  // section 6.
  const interruptionsResiduelles = nonJoignables.filter((r) => (r.entree.motif ?? '').includes('is interrupted by another navigation'));

  const parMotifHorsSurface = { [MOTIF_SANS_FORMULAIRE]: 0, [MOTIF_EXPOSITION_NULLE]: 0 };
  const surfaceEffective = [];
  for (const r of analyses) {
    const motif = r.entree.verdict.motif;
    if (motif === MOTIF_SANS_FORMULAIRE || motif === MOTIF_EXPOSITION_NULLE) parMotifHorsSurface[motif]++;
    else surfaceEffective.push(r);
  }

  const parNiveau = { N0: 0, N1: 0, N2: 0, N3: 0 };
  for (const r of analyses) parNiveau[r.entree.verdict.niveau] = (parNiveau[r.entree.verdict.niveau] ?? 0) + 1;

  const parSegment = {};
  for (const r of analyses) {
    const seg = r.ligne.segment;
    parSegment[seg] ??= { N0: 0, N1: 0, N2: 0, N3: 0, total: 0 };
    parSegment[seg][r.entree.verdict.niveau]++;
    parSegment[seg].total++;
  }

  const fauxPositifs = analyses
    .filter((r) => r.entree.verdict.niveau === 'N2' || r.entree.verdict.niveau === 'N3')
    .map((r) => ({ url: r.ligne.url, segment: r.ligne.segment, ...r.entree.verdict }));

  const parMotifNonJoignable = {};
  for (const r of nonJoignables) {
    const motif = r.entree.motif ?? 'inconnu';
    parMotifNonJoignable[motif] = (parMotifNonJoignable[motif] ?? 0) + 1;
  }

  const lignesPortails = portailsFichiers.map((fichier) => {
    const entree = resultatsParCle.get(`portail:${fichier}`);
    return { fichier, niveau: entree?.verdict?.niveau ?? '—', motif: entree?.verdict?.motif ?? entree?.issue ?? 'non exécuté' };
  });
  const portailsEnDefaut = lignesPortails.filter((l) => l.niveau !== 'N0');

  const NIVEAUX_ORDRE = { N0: 0, N1: 1, N2: 2, N3: 3 };
  const lignesTemoins = TEMOINS_POSITIFS.map((t) => {
    const entree = resultatsParCle.get(`temoin:${t.fichier}`);
    const niveau = entree?.verdict?.niveau ?? '—';
    const atteintN1Plus = (NIVEAUX_ORDRE[niveau] ?? 0) >= 1;
    const conforme = t.attenduN1Plus ? atteintN1Plus : niveau === 'N0';
    return { fichier: t.fichier, attendu: t.attenduN1Plus ? '≥ N1' : 'N0', niveau, motif: entree?.verdict?.motif ?? entree?.issue ?? 'non exécuté', conforme };
  });
  const temoinsEnDefaut = lignesTemoins.filter((l) => !l.conforme);
  const chaineMuette = temoinsEnDefaut.some((l) => TEMOINS_POSITIFS.find((t) => t.fichier === l.fichier)?.attenduN1Plus);

  const lignes = [];
  lignes.push(`# Rapport de faux positifs — ${new Date().toISOString().slice(0, 10)}`);
  lignes.push('');
  lignes.push('Généré par `extension/tests/corpus/harnais.mjs` (lot L5), Playwright + Chromium, extension chargée réellement (verdict capté depuis le content script, non recalculé). Construit à partir de `resultats.jsonl`.');
  lignes.push('');

  if (interruptionsResiduelles.length > 0) {
    lignes.push('## ⚠ ISOLATION INCOMPLÈTE (12.3.1.1)');
    lignes.push('');
    lignes.push(
      `**${interruptionsResiduelles.length} page(s) portent encore « interrupted by another navigation » malgré la page neuve par hôte.** ` +
        "Le couplage entre hôtes n'est pas éliminé — la cause n'est plus la page partagée, il faut en trouver une autre avant de faire confiance au reste du rapport.",
    );
    lignes.push('');
  }

  if (chaineMuette) {
    lignes.push('## ⚠ TÉMOIN POSITIF EN ÉCHEC — rapport non probant');
    lignes.push('');
    lignes.push(
      "**Au moins une page d'imitation attendue en N1 ou plus est ressortie en dessous.** " +
        "Un taux de faux positifs à 0 % dans ce rapport ne prouve rien : la chaîne de détection " +
        "peut tout simplement être muette plutôt que juste. Traiter ce point avant de lire le reste.",
    );
    lignes.push('');
  }

  lignes.push('## 0. Témoin positif (12.3.2) — dix pages d\'imitation, même passe');
  lignes.push('');
  lignes.push('| Gabarit | Attendu | Obtenu | Motif | Conforme |');
  lignes.push('|---|---|---|---|---|');
  for (const l of lignesTemoins) lignes.push(`| ${l.fichier} | ${l.attendu} | ${l.niveau} | ${l.motif} | ${l.conforme ? 'oui' : '**NON**'} |`);
  lignes.push('');
  lignes.push(
    temoinsEnDefaut.length === 0
      ? "**Les dix témoins se comportent comme attendu : la chaîne détecte, et ne bloque pas systématiquement.**"
      : `**${temoinsEnDefaut.length} témoin(s) non conforme(s).**`,
  );
  lignes.push('');

  lignes.push('## 1. Corpus de sites légitimes');
  lignes.push('');
  lignes.push(`- Domaines analysés : **${total}** sur ${corpus.length} soumis`);
  lignes.push(`- Non joignables (hors dénominateur) : ${nonJoignables.length}`);
  lignes.push(`- Redirections hors domaine (hors dénominateur, 12.3.1.1) : ${redirectionsHorsDomaine.length}`);
  lignes.push(`- Réponses HTTP hors 2xx (hors dénominateur, 12.3.3.8) : ${reponsesNon2xx.length}`);
  lignes.push(`- Sans injection du script de contenu (12.3.1.2) : ${sansInjection.length}`);
  lignes.push(`- Verdict tardif : injecté, sans verdict dans la fenêtre (12.3.1.2) : ${verdictsTardifs.length}`);
  const totalSansVerdict = nonJoignables.length + sansInjection.length + verdictsTardifs.length;
  lignes.push(`- **Total sans verdict : ${totalSansVerdict} (${tauxPct(totalSansVerdict, corpus.length)} du corpus soumis)**`);
  lignes.push('');
  lignes.push('### 1.1 Répartition des motifs de verdict — surface de test effective');
  lignes.push('');
  lignes.push('| Motif | Pages | Part du total analysé |');
  lignes.push('|---|---|---|');
  lignes.push(`| ${MOTIF_SANS_FORMULAIRE} | ${parMotifHorsSurface[MOTIF_SANS_FORMULAIRE]} | ${tauxPct(parMotifHorsSurface[MOTIF_SANS_FORMULAIRE], total)} |`);
  lignes.push(`| ${MOTIF_EXPOSITION_NULLE} | ${parMotifHorsSurface[MOTIF_EXPOSITION_NULLE]} | ${tauxPct(parMotifHorsSurface[MOTIF_EXPOSITION_NULLE], total)} |`);
  lignes.push(`| Passé par le calcul de score (surface effective) | ${surfaceEffective.length} | ${tauxPct(surfaceEffective.length, total)} |`);
  lignes.push('');
  lignes.push(
    `**Surface de test effective : ${surfaceEffective.length} page(s) sur ${total} analysée(s).** ` +
      "C'est le dénominateur qui compte pour juger si le moteur a vraiment été mis à l'épreuve — " +
      'voir aussi le sous-corpus des pages de connexion (12.3.3), ciblé pour maximiser cette surface.',
  );
  lignes.push('');
  lignes.push('### 1.2 Niveaux d\'alerte');
  lignes.push('');
  lignes.push('| Niveau | Nombre | Taux / total analysé | Taux / surface effective |');
  lignes.push('|---|---|---|---|');
  for (const n of ['N0', 'N1', 'N2', 'N3']) {
    lignes.push(`| ${n} | ${parNiveau[n] ?? 0} | ${tauxPct(parNiveau[n] ?? 0, total)} | ${tauxPct(parNiveau[n] ?? 0, surfaceEffective.length)} |`);
  }
  lignes.push('');
  lignes.push('**Critères (12.3)** : FP_N3 = 0 requis, FP_N2 < 0,5 % requis, FP_N1 < 3 % toléré. Les deux colonnes de taux sont données à dessein : rapporter un taux à la seule taille du corpus soumis masque la faible portée du résultat quand la surface effective est petite (12.3.2).');
  lignes.push(`- FP_N3 : ${tauxPct(parNiveau.N3 ?? 0, total)} / total, ${tauxPct(parNiveau.N3 ?? 0, surfaceEffective.length)} / surface effective — ${(parNiveau.N3 ?? 0) === 0 ? 'TENU' : 'NON TENU'}`);
  lignes.push(`- FP_N2 : ${tauxPct(parNiveau.N2 ?? 0, total)} / total, ${tauxPct(parNiveau.N2 ?? 0, surfaceEffective.length)} / surface effective`);
  lignes.push(`- FP_N1 : ${tauxPct(parNiveau.N1 ?? 0, total)} / total, ${tauxPct(parNiveau.N1 ?? 0, surfaceEffective.length)} / surface effective`);
  lignes.push('');
  lignes.push('### 1.3 Redirections hors domaine (12.3.1.1)');
  lignes.push('');
  lignes.push(
    `${redirectionsHorsDomaine.length} page(s) du corpus ont abouti sur un domaine enregistrable différent de celui demandé. ` +
      "Ce n'est pas un échec : un site légitime qui redirige ailleurs (fusion, changement de nom, prestataire externe) est un " +
      "cas que le calibrage doit connaître — exclues du dénominateur des sections 1.1 et 1.2, le verdict porté ici est attribué " +
      "à la page d'arrivée, pas à l'hôte demandé.",
  );
  lignes.push('');
  if (redirectionsHorsDomaine.length > 0) {
    lignes.push('| Hôte demandé | Domaine final | Niveau obtenu | Motif |');
    lignes.push('|---|---|---|---|');
    for (const r of redirectionsHorsDomaine) {
      lignes.push(`| ${r.ligne.hote} | ${r.entree.domaineFinal} | ${r.entree.verdict.niveau} | ${r.entree.verdict.motif} |`);
    }
    lignes.push('');
  }
  lignes.push('### 1.4 Réponses HTTP hors 2xx (12.3.3.8)');
  lignes.push('');
  lignes.push(
    `${reponsesNon2xx.length} page(s) du corpus ont répondu par un code HTTP hors 2xx (page d'erreur personnalisée ` +
      "servant du HTML, souvent générique) plutôt que par un échec de navigation. Ce n'est pas un échec du harnais : " +
      'la page est écartée du dénominateur des sections 1.1 et 1.2 comme une redirection hors domaine.',
  );
  lignes.push('');
  if (reponsesNon2xx.length > 0) {
    lignes.push('| Hôte demandé | Code HTTP |');
    lignes.push('|---|---|');
    for (const r of reponsesNon2xx) lignes.push(`| ${r.ligne.hote} | ${r.entree.statut} |`);
    lignes.push('');
  }
  lignes.push('### 1.5 Latence du premier verdict (12.3.3.10, mesure de C4)');
  lignes.push('');
  lignes.push(
    "C4 exige un verdict en moins de 150 ms au 95e centile, sur le PREMIER verdict (pas le dernier) — c'est ce que " +
      "l'utilisateur voit en premier. Mesuré ici, dans cette passe de faux positifs elle-même (12.3.3.10) plutôt que " +
      "dans une campagne dédiée à échantillon réduit : le 95e centile porte sur l'essentiel des pages analysées, pas " +
      'sur quelques dizaines. Pages réelles qui rendent un verdict dans la fenêtre de 1,5 s (analyses et redirections ' +
      'hors domaine confondues) — pas les gabarits de test.',
  );
  lignes.push('');
  if (!delaisPremierVerdict) {
    lignes.push('Aucune page avec verdict et horodatage exploitable.');
  } else {
    lignes.push('| n | Médiane | 90e centile | 95e centile | 99e centile | Maximum |');
    lignes.push('|---|---|---|---|---|---|');
    lignes.push(
      `| ${delaisPremierVerdict.n} | ${delaisPremierVerdict.mediane} ms | ${delaisPremierVerdict.p90} ms | ` +
        `${delaisPremierVerdict.p95} ms | ${delaisPremierVerdict.p99} ms | ${delaisPremierVerdict.max} ms |`,
    );
    lignes.push('');
    lignes.push(
      `- C4 (95e centile < 150 ms) : ${delaisPremierVerdict.p95} ms — ${delaisPremierVerdict.p95 < 150 ? 'TENU' : 'NON TENU'}`,
    );
  }
  lignes.push(`- Pages sans verdict dans la fenêtre (sans-injection + verdict-tardif, hors distribution ci-dessus) : ${pagesSansVerdict}`);
  lignes.push('');
  lignes.push('## 2. Par segment');
  lignes.push('');
  lignes.push('| Segment | Analysés | N0 | N1 | N2 | N3 |');
  lignes.push('|---|---|---|---|---|---|');
  for (const [segment, c] of Object.entries(parSegment).sort()) {
    lignes.push(`| ${segment} | ${c.total} | ${c.N0} | ${c.N1} | ${c.N2} | ${c.N3} |`);
  }
  lignes.push('');
  lignes.push('## 3. Faux positifs nommés (N2 et N3)');
  lignes.push('');
  if (fauxPositifs.length === 0) {
    lignes.push('Aucun.');
  } else {
    lignes.push('| URL | Segment | Niveau | Score I | Score E | Marque détectée | Signaux |');
    lignes.push('|---|---|---|---|---|---|---|');
    for (const fp of fauxPositifs) {
      const signaux = [...(fp.signauxImitation ?? []), ...(fp.signauxExposition ?? [])].map((s) => s.code).join(', ');
      lignes.push(`| ${fp.url} | ${fp.segment} | ${fp.niveau} | ${fp.scoreImitation ?? '—'} | ${fp.scoreExposition ?? '—'} | ${fp.marqueDetectee ?? '—'} | ${signaux} |`);
    }
  }
  lignes.push('');
  lignes.push('## 4. Portails captifs (12.1.1) — tous attendus en N0');
  lignes.push('');
  lignes.push('| Gabarit | Niveau | Motif |');
  lignes.push('|---|---|---|');
  for (const l of lignesPortails) lignes.push(`| ${l.fichier} | ${l.niveau} | ${l.motif} |`);
  lignes.push('');
  lignes.push(portailsEnDefaut.length === 0
    ? '**Aucun gabarit n\'alerte : conforme.**'
    : `**${portailsEnDefaut.length} gabarit(s) alertent alors qu'ils devraient rester en N0 — faute de conception (5.6), pas un réglage de seuil.**`);
  lignes.push('');
  lignes.push('## 5. Collision des racines typographiques (12.6)');
  lignes.push('');
  lignes.push(`${nbRacines} racines confrontées à ${corpus.length} hôtes du corpus (comparaison par étiquette, spec 12.3.2).`);
  lignes.push('');
  if (collisionsRacines.length === 0) {
    lignes.push('Aucune collision.');
  } else {
    lignes.push('| Racine | Marque | Hôte légitime touché | Segment |');
    lignes.push('|---|---|---|---|');
    for (const c of collisionsRacines) lignes.push(`| ${c.racine} | ${c.marque} | ${c.hote} | ${c.segment} |`);
  }
  lignes.push('');
  lignes.push('## 6. Motif des pages non joignables (12.3.2, 12.3.1.1)');
  lignes.push('');
  if (nonJoignables.length === 0) {
    lignes.push('Aucune.');
    lignes.push('');
  } else {
    const tableauMotifs = (entrees) => {
      lignes.push('| Motif | Pages | Part des non joignables |');
      lignes.push('|---|---|---|');
      for (const [motif, n] of entrees.sort((a, b) => b[1] - a[1])) lignes.push(`| ${motif} | ${n} | ${tauxPct(n, nonJoignables.length)} |`);
      lignes.push('');
    };
    const codesReseau = Object.entries(parMotifNonJoignable).filter(([m]) => m.startsWith('net::ERR_'));
    const delaisDepasses = Object.entries(parMotifNonJoignable).filter(([m]) => m === 'timeout');
    const autres = Object.entries(parMotifNonJoignable).filter(([m]) => !m.startsWith('net::ERR_') && m !== 'timeout');

    lignes.push('### 6.1 Codes réseau (net::ERR_*)');
    lignes.push('');
    if (codesReseau.length === 0) { lignes.push('Aucun.'); lignes.push(''); } else tableauMotifs(codesReseau);

    lignes.push('### 6.2 Délais dépassés');
    lignes.push('');
    if (delaisDepasses.length === 0) { lignes.push('Aucun.'); lignes.push(''); } else tableauMotifs(delaisDepasses);

    if (autres.length > 0) {
      lignes.push('### 6.3 Autres motifs');
      lignes.push('');
      lignes.push(
        interruptionsResiduelles.length > 0
          ? "**Contient des navigations interrompues — voir le bandeau en tête de rapport.**"
          : "Motifs ne relevant ni d'un code réseau ni d'un dépassement de délai.",
      );
      lignes.push('');
      tableauMotifs(autres);
    }
  }
  lignes.push("Diagnostic seul : aucune correction n'est appliquée à partir de ce tableau (12.3.2).");
  lignes.push('');
  return lignes.join('\n');
}

// --- rapport de la campagne de mesure de latence (12.3.1.3) -----------------

function ms(valeur) {
  return valeur === undefined ? '—' : `${valeur} ms`;
}

function ligneStats(libelle, stats) {
  if (!stats) return `| ${libelle} | — | — | — | — | — | — |`;
  return `| ${libelle} | ${stats.n} | ${ms(stats.mediane)} | ${ms(stats.p90)} | ${ms(stats.p95)} | ${ms(stats.p99)} | ${ms(stats.max)} |`;
}

function construireRapportLatence({ corpus, resultatsParCle }) {
  const parHote = new Map(corpus.map((l) => [l.hote, l]));
  const resultats = [];
  for (const [cle, entree] of resultatsParCle) {
    if (!cle.startsWith('corpus:')) continue;
    if (parHote.has(entree.hote)) resultats.push(entree);
  }

  const mesures = resultats.filter((e) => e.issue === 'mesure');
  const censurees = resultats.filter((e) => e.issue === 'censuree');
  const nonJoignables = resultats.filter((e) => e.issue === 'non-joignable');
  const reponsesNon2xx = resultats.filter((e) => e.issue === 'reponse-non-2xx');

  const parOrigine = {};
  for (const e of mesures) parOrigine[e.origineDuPremier] = (parOrigine[e.origineDuPremier] ?? 0) + 1;

  const lignes = [];
  lignes.push(`# Mesure de latence — ${new Date().toISOString().slice(0, 10)}`);
  lignes.push('');
  lignes.push(
    'Campagne dédiée (12.3.1.3), distincte de la passe de faux positifs : `--mesure-latence`, fenêtre ' +
      "d'analyse élargie à 10 s pour ne plus tronquer la queue, premier ET dernier verdict consignés " +
      "séparément, origine du premier verdict (analyse initiale ou réanalyse déclenchée par une mutation " +
      "du DOM). Généré par `extension/tests/corpus/harnais.mjs`, construit à partir de `mesure-latence.jsonl`.",
  );
  lignes.push('');
  lignes.push(
    "Décomposition en trois temps (collecte DOM / passage du message / exécution du moteur) non fournie : " +
      "performance.now() n'est pas comparable entre le content script et le service worker sans horodatage " +
      "Date.now() ajouté au chemin chaud du service worker, ce qui aurait sali du code de production pour " +
      "un gain incertain. Trois chiffres justes plutôt que six obtenus en abîmant l'extension.",
  );
  lignes.push('');
  lignes.push(`- Pages avec au moins un verdict dans la fenêtre de 10 s : **${mesures.length}**`);
  lignes.push(`- Censurées (aucun verdict à 10 s) : **${censurees.length}**`);
  lignes.push(`- Non joignables : ${nonJoignables.length}`);
  lignes.push(`- Réponses HTTP hors 2xx (12.3.3.8) : ${reponsesNon2xx.length}`);
  lignes.push(`- Total soumis à la campagne : ${corpus.length}`);
  lignes.push('');
  lignes.push('## 1. Délais, par mesure et par départ d\'horloge');
  lignes.push('');
  lignes.push(
    'Deux départs d\'horloge, faute de savoir encore lequel est le bon : depuis la validation de la ' +
      "navigation (domcontentloaded), et depuis l'injection du script de contenu. Aucune conclusion sur C4 " +
      "n'est tirée ici — c'est une mesure, pas une décision (12.3.1.3).",
  );
  lignes.push('');
  lignes.push('| Mesure | n | Médiane | 90e centile | 95e centile | 99e centile | Maximum |');
  lignes.push('|---|---|---|---|---|---|---|');
  lignes.push(ligneStats('Premier verdict, depuis navigation', statsDelai(mesures.map((e) => e.premier.depuisNavigationMs).filter((v) => v !== undefined))));
  lignes.push(ligneStats('Premier verdict, depuis injection', statsDelai(mesures.map((e) => e.premier.depuisInjectionMs).filter((v) => v !== undefined))));
  lignes.push(ligneStats('Dernier verdict, depuis navigation', statsDelai(mesures.map((e) => e.dernier.depuisNavigationMs).filter((v) => v !== undefined))));
  lignes.push(ligneStats('Dernier verdict, depuis injection', statsDelai(mesures.map((e) => e.dernier.depuisInjectionMs).filter((v) => v !== undefined))));
  lignes.push('');
  lignes.push(`Pages censurées (pas de verdict à 10 s), exclues des tableaux ci-dessus : **${censurees.length} sur ${resultats.length}**.`);
  lignes.push('');
  lignes.push('## 2. Origine du premier verdict');
  lignes.push('');
  lignes.push(
    "Point discriminant (12.3.1.3) : si le premier verdict vient presque toujours de l'analyse initiale, " +
      "le plancher de 300 ms du débounce ne le concerne pas et un budget de 150 ms redevient discutable pour " +
      "cette voie. S'il vient majoritairement d'une réanalyse déclenchée par une mutation, le plancher de " +
      "300 ms s'applique à la protection réelle de l'utilisateur.",
  );
  lignes.push('');
  lignes.push('| Origine | Pages | Part des mesures |');
  lignes.push('|---|---|---|');
  for (const [origine, n] of Object.entries(parOrigine).sort((a, b) => b[1] - a[1])) {
    lignes.push(`| ${origine} | ${n} | ${tauxPct(n, mesures.length)} |`);
  }
  lignes.push('');
  lignes.push('## 3. Pages non joignables');
  lignes.push('');
  lignes.push(`${nonJoignables.length} page(s), hors du périmètre de cette mesure — motif détaillé dans le rapport de faux positifs (12.3.2), pas répété ici.`);
  lignes.push('');
  lignes.push("Aucune conclusion sur C4 n'est proposée dans ce rapport : c'est une mesure, la décision revient à la spec (12.3.1.3).");
  lignes.push('');
  return lignes.join('\n');
}

// --- vérification du chargement de l'extension en mode headless ------------

async function verifierExtensionChargee(context, headless) {
  const debut = performance.now();
  while (performance.now() - debut < 10_000) {
    if (context.serviceWorkers().some((s) => s.url().includes('service-worker-loader'))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (headless) {
    let versionPlaywright = '?';
    try {
      versionPlaywright = JSON.parse(readFileSync(join(RACINE_PROJET, 'extension', 'node_modules', 'playwright', 'package.json'), 'utf8')).version;
    } catch {
      // pas critique pour le diagnostic, juste une information manquante.
    }
    console.error(
      "L'extension ne s'est pas chargée en mode headless malgré channel: 'chromium' (aucun service " +
        `worker détecté après 10 s). Playwright ${versionPlaywright}. Si ce message apparaît encore, ` +
        "c'est une contrainte de la plateforme Chromium sur cette machine, pas une négligence du " +
        'harnais — relancez avec --fenetre pour confirmer que le mode fenêtré, lui, fonctionne.',
    );
  }
  return false;
}

// --- programme principal ------------------------------------------------------

async function main() {
  armerFiletDeSecurite();
  const corpus = chargerCorpus();
  const modeEchantillon = ALEATOIRE ? ` (${ALEATOIRE} tirés au hasard)` : LIMITE ? ` (limité à ${LIMITE})` : '';
  console.log(`Corpus chargé : ${corpus.length} hôtes${FILTRE_SEGMENT ? ` (segment ${FILTRE_SEGMENT})` : ''}${modeEchantillon}.`);
  if (MODE_LATENCE) {
    console.log(
      `Mode --mesure-latence (12.3.1.3) : fenêtre d'analyse élargie à ${FENETRE_LATENCE_MS} ms pour cette ` +
        `campagne seule, écrite dans mesure-latence${SUFFIXE_FICHIER}.jsonl. La passe de faux positifs garde ${FENETRE_FP_MS} ms.`,
    );
  }

  // 12.3.1.3 : la campagne de mesure de latence ne porte pas sur les témoins,
  // les portails captifs ni les racines typographiques — hors de son objet,
  // et ça évite de doubler inutilement le temps de la passe.
  const { nbRacines, collisions: collisionsRacines } = MODE_LATENCE
    ? { nbRacines: 0, collisions: [] }
    : verifierRacinesTypo(corpus);
  if (!MODE_LATENCE) {
    console.log(`Racines typographiques : ${collisionsRacines.length} collision(s) sur ${nbRacines} racines vérifiées.`);
  }

  const resultatsExistants = chargerResultatsPourReprise();
  const hotesDejaTraites = new Set(
    [...resultatsExistants.values()].filter((e) => e.cle.startsWith('corpus:')).map((e) => e.hote),
  );
  const aTraiter = corpus.filter((l) => !hotesDejaTraites.has(l.hote));
  if (hotesDejaTraites.size > 0) {
    console.log(`Reprise : ${hotesDejaTraites.size} hôte(s) déjà traité(s) dans ${FICHIER_RESULTATS}, ${aTraiter.length} restant(s).`);
  }

  const serveurPortails = await demarrerServeurPortails();
  const port = serveurPortails.address().port;
  const fichiersPortails = readdirSync(DOSSIER_PORTAILS).filter((f) => f.endsWith('.html')).sort();

  const userDataDir = mkdtempSync(join(tmpdir(), 'tourmentin-harnais-'));
  const headless = !FENETRE;
  const context = await chromium.launchPersistentContext(userDataDir, {
    // 12.3.1 (spec v1.10) : le chargement d'extension en headless n'est
    // possible qu'avec le canal `chromium` de Playwright — sans lui,
    // l'extension ne se charge pas du tout et verifierExtensionChargee()
    // arrête le harnais, ce qui est le comportement voulu plutôt qu'une
    // passe silencieuse sans extension.
    channel: 'chromium',
    headless,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--mute-audio',
      '--disable-background-networking',
      // Volontairement désactivé (pas restauré à sa valeur par défaut) :
      // Chromium ne teste que la présence du commutateur, pas une valeur
      // après le signe égal, donc "=false" désactiverait quand même la
      // limitation. On la désactive donc explicitement et sans ambiguïté —
      // une page dont les minuteurs sont bridés en arrière-plan pourrait
      // rendre son verdict après notre fenêtre d'attente.
      '--disable-background-timer-throttling',
      '--disable-features=Translate,MediaRouter,OptimizationHints,AcceptCHFrame',
    ],
  });

  const extensionChargee = await verifierExtensionChargee(context, headless);
  if (!extensionChargee) {
    await context.close();
    serveurPortails.close();
    process.exitCode = 1;
    return;
  }

  // Filtrage de ressources, spec 12.3.1 : le garde-fou testé
  // (filtrage-ressources.test.ts) garantit qu'image, stylesheet, font et la
  // navigation d'un cadre ne peuvent jamais être bloqués ici.
  await context.route('**/*', (route) => {
    const requete = route.request();
    let hote = '';
    try {
      hote = new URL(requete.url()).hostname;
    } catch {
      // URL non standard (data:, blob:...) : jamais une régie, on laisse passer.
    }
    if (doitBloquerRessource(hote, requete.resourceType(), HOTES_REGIES_PUBLICITAIRES)) {
      void route.abort();
    } else {
      void route.continue();
    }
  });

  if (!MODE_LATENCE) {
    console.log('Témoin positif : 10 pages d\'imitation, même passe...');
    const pageTemoins = await context.newPage();
    let temoinsEchecs = 0;
    for (const temoin of TEMOINS_POSITIFS) {
      const resultat = await analyserTemoin(pageTemoins, temoin);
      ecrireResultat({ cle: `temoin:${temoin.fichier}`, fichier: temoin.fichier, horodatage: new Date().toISOString(), ...resultat });
      const niveau = resultat.verdict?.niveau ?? resultat.issue;
      const conforme = temoin.attenduN1Plus ? ['N1', 'N2', 'N3'].includes(niveau) : niveau === 'N0';
      if (!conforme) temoinsEchecs++;
    }
    await pageTemoins.close();
    if (temoinsEchecs > 0) {
      console.error(
        `ATTENTION : ${temoinsEchecs} témoin(s) positif(s) non conforme(s) — voir la section 0 du rapport. ` +
          'Un rapport de faux positifs à 0 % ne prouve rien tant que ce point n\'est pas résolu (12.3.2).',
      );
    } else {
      console.log('Témoin positif : conforme, les 10 pages se comportent comme attendu.');
    }
  }

  if (aTraiter.length > 0) {
    console.log(
      `${MODE_LATENCE ? 'Mesure de latence sur' : 'Analyse de'} ${aTraiter.length} hôte(s), concurrence ${CONCURRENCE}, ${headless ? 'headless' : 'fenêtré'}...`,
    );
    const debut = performance.now();
    await traiterEnParallele(
      context,
      aTraiter,
      CONCURRENCE,
      async (page, ligne) => {
        const resultat = MODE_LATENCE ? await mesurerLatenceUneUrl(page, ligne.url) : await analyserUneUrl(page, ligne.url);
        ecrireResultat({ cle: `corpus:${ligne.hote}`, hote: ligne.hote, horodatage: new Date().toISOString(), ...resultat });
      },
      {
        surProgression: ({ termines, restants, ecouleS, estimeeS }) => {
          const finEstimee = new Date(Date.now() + estimeeS * 1000);
          console.log(
            `  ${termines} traité(s), ${restants} restant(s), écoulé ${formaterDuree(ecouleS)}, ` +
              `fin estimée dans ${formaterDuree(estimeeS)} (~${finEstimee.toLocaleTimeString('fr-FR')}).`,
          );
        },
      },
    );
    console.log(`Corpus traité en ${formaterDuree((performance.now() - debut) / 1000)}.`);
  } else {
    console.log(`Rien à traiter : tous les hôtes demandés sont déjà dans ${FICHIER_RESULTATS}.`);
  }

  if (!MODE_LATENCE) {
    console.log('Analyse des 10 portails captifs...');
    const pagePortails = await context.newPage();
    for (const fichier of fichiersPortails) {
      const resultat = await analyserUneUrl(pagePortails, `http://127.0.0.1:${port}/${fichier}`);
      ecrireResultat({ cle: `portail:${fichier}`, fichier, horodatage: new Date().toISOString(), ...resultat });
    }
    await pagePortails.close();
  }

  await context.close();
  serveurPortails.close();

  const resultatsFinaux = lireTousLesResultats();
  mkdirSync(DOSSIER_DOCS, { recursive: true });
  if (MODE_LATENCE) {
    const rapport = construireRapportLatence({ corpus, resultatsParCle: resultatsFinaux });
    const cheminRapport = join(DOSSIER_DOCS, `MESURE-LATENCE-${new Date().toISOString().slice(0, 10)}${SUFFIXE_FICHIER}.md`);
    writeFileSync(cheminRapport, rapport, 'utf8');
    console.log(`Rapport écrit : ${cheminRapport}`);
  } else {
    const rapport = construireRapport({ corpus, resultatsParCle: resultatsFinaux, portailsFichiers: fichiersPortails, collisionsRacines, nbRacines });
    const cheminRapport = join(DOSSIER_DOCS, `RAPPORT-FP-${new Date().toISOString().slice(0, 10)}.md`);
    writeFileSync(cheminRapport, rapport, 'utf8');
    console.log(`Rapport écrit : ${cheminRapport}`);
  }
}

// Node n'exécute main() que si le fichier est lancé directement (npm run
// harnais / npm run mesure-latence), jamais quand un test importe une
// fonction ou une constante du module — ce qui rend fenetre-analyse.mjs
// suffisant sans avoir besoin d'importer harnais.mjs depuis un test.
const ESTAPPELEDIRECTEMENT = fileURLToPath(import.meta.url) === process.argv[1];
if (ESTAPPELEDIRECTEMENT) {
  main().catch((erreur) => {
    console.error(erreur);
    process.exitCode = 1;
  });
}
