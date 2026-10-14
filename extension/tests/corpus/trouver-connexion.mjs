// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3 et 12.3.3.3 : localise la page de connexion d'un hôte comme le
// ferait un navigateur ordinaire — charger la page d'accueil, y chercher un
// lien d'identification, le suivre. Le sondage de chemins usuels reste un
// repli, seulement quand aucun lien n'a été trouvé, avec un agent explicite et
// le respect de robots.txt.
//
// Une page se juge « de connexion » avec l'adaptateur DOM de l'EXTENSION
// (bundle de src/adaptateurs/dom.ts), jamais avec une détection propre à ce
// script (12.3.3.3) : le premier parcours lisait la page immédiatement après
// domcontentloaded et manquait les formulaires construits par script (ANTS,
// France Travail). Attente du harnais (1,5 s), puis relecture périodique
// jusqu'à ATTENTE_MAX_MS — un formulaire peut n'apparaître qu'après.
//
// Chaque page examinée (accueil, page de connexion) passe aussi par l'axe
// d'imitation du moteur : c'est ce qui permet de repérer, sans aucune requête
// de plus, les pages officielles qui affichent une marque du socle hors de ses
// domaines (segment socle-affiche, 12.3.3.3).
//
// Aucune saisie, aucune soumission de formulaire : on regarde une page, on ne
// la remplit jamais.
import { FENETRE_FP_MS } from './fenetre-analyse.mjs';

const TIMEOUT_NAVIGATION_MS = 15_000;
const TIMEOUT_SONDAGE_MS = 8_000;
const ATTENTE_MAX_MS = 8_000;
const PAS_RELECTURE_MS = 500;

// Libellé, title, aria-label ou href évoquant une identification — recherche
// de sous-chaîne insensible à la casse, volontairement simple : un faux
// positif ici coûte une page vérifiée en trop, pas une alerte utilisateur.
const MOTS_CLES_CONNEXION = ['connexion', 'se connecter', 'mon compte', 'espace client', 'identifiez-vous', 'espace personnel', 'login', 'sign in'];

// Titre ou chemin d'une page évoquant la connexion : distingue un écran
// d'identifiant d'un simple champ e-mail (newsletter) quand aucun mot de passe
// n'est présent.
const MOTS_PAGE_CONNEXION = [...MOTS_CLES_CONNEXION, 'connecter', 'identification', 'authentification', 'signin', 'log in'];

const LEXIQUE_IDENTIFIANT = [
  'identifiant',
  'adresse e-mail',
  'adresse email',
  'adresse electronique',
  'adresse mail',
  'courriel',
  'e-mail',
  'email',
  "nom d'utilisateur",
  'login',
  'username',
  'numero fiscal',
  'numero de securite sociale',
];

// 12.3.3.2 : écrans d'administration de CMS, jamais rencontrés par le public
// ni imités par le hameçonnage — catégorie distincte, plafonnée côté appelant.
// Liste limitée aux chemins sans ambiguïté : /user/login (Drupal) sert aussi
// aux membres, il n'y figure pas.
const MOTIF_BACK_OFFICE = /\/wp-login\.php|\/wp-admin(\/|$)|\/administrator(\/|$)|\/typo3(\/|$)|\/admin(\/|$)/i;

export function estBackOffice(urlOuChemin) {
  let chemin = urlOuChemin;
  try {
    chemin = new URL(urlOuChemin).pathname;
  } catch {
    // déjà un chemin
  }
  return MOTIF_BACK_OFFICE.test(chemin);
}

const CHEMINS_SONDAGE = ['/login', '/connexion', '/mon-compte', '/espace-client', '/wp-login.php', '/user/login'];

const AGENT_SONDAGE =
  'TourmentinCorpusBot/1.0 (recherche de pages de connexion legitimes pour un corpus de test anti-hameconnage ; usage interne, non public)';

const normaliser = (t) =>
  (t ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
const evoque = (texte, mots) => mots.some((m) => normaliser(texte).includes(normaliser(m)));

/**
 * Jugement d'une analyse de page produite par l'adaptateur de l'extension
 * (__tourmentinAnalyse) : fonction pure, testée sans navigateur. 'mot-de-passe'
 * si un formulaire porte un champ password ; 'identifiant' si un formulaire
 * porte un champ d'identifiant (autocomplete username/email, ou libellé du
 * lexique) ET que le titre ou le chemin de la page évoque la connexion ; sinon
 * null. Seuls comptent les champs que l'extension voit, c'est-à-dire ceux d'un
 * <form> : ceux qui n'y sont pas sont comptés à part (champsHorsFormulaire).
 */
export function jugerAnalyse(analyse) {
  const champs = analyse.formulaires.flatMap((f) => f.champs);
  if (champs.some((c) => c.type === 'password')) return 'mot-de-passe';
  const aUnIdentifiant = champs.some((c) => {
    const ac = (c.autocomplete ?? '').toLowerCase().split(/\s+/);
    if (ac.includes('username') || ac.includes('email')) return true;
    return evoque([c.nom, c.libelle, c.placeholder].join(' '), LEXIQUE_IDENTIFIANT);
  });
  if (aUnIdentifiant && evoque(`${analyse.titre ?? ''} ${analyse.chemin ?? ''}`, MOTS_PAGE_CONNEXION)) return 'identifiant';
  return null;
}

/**
 * Liens d'identification de la page. page.$$eval() est l'API Playwright
 * standard pour lire le DOM via CDP (pas un eval() JavaScript sur une chaîne
 * non fiable) : seule la fonction fléchée littérale ci-dessous est exécutée,
 * dans le contexte isolé de la page.
 */
export async function trouverLiensConnexion(page) {
  const liens = await page.$$eval('a[href]', (elements) =>
    elements.map((a) => ({
      href: a.getAttribute('href') ?? '',
      texte: a.textContent ?? '',
      title: a.getAttribute('title') ?? '',
      ariaLabel: a.getAttribute('aria-label') ?? '',
    })),
  );
  const evoqueConnexion = (t) => MOTS_CLES_CONNEXION.some((mot) => (t ?? '').toLowerCase().includes(mot));
  return liens.filter((l) => evoqueConnexion(l.texte) || evoqueConnexion(l.title) || evoqueConnexion(l.ariaLabel) || evoqueConnexion(l.href));
}

/** Analyse de la page courante par le bundle de l'extension ; null si la page change sous nos pieds. */
export async function analyserPage(page, bundle) {
  try {
    await page.evaluate(bundle);
    return await page.evaluate(() => globalThis.__tourmentinAnalyse());
  } catch {
    return null;
  }
}

/** Origine + chemin, sans chaîne de requête ni fragment (12.3.3.2 : state, nonce... à usage unique). */
function origineEtChemin(url) {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
}

/**
 * Résumé consigné d'une page pour le repérage socle-affiche : structure et
 * résultats de signaux seulement, jamais de texte de page.
 */
export function resumerImitation(analyse) {
  if (!analyse) return null;
  const nbChamps = analyse.formulaires.reduce((n, f) => n + f.champs.length, 0);
  return {
    url: origineEtChemin(analyse.href),
    aFormulaire: nbChamps > 0,
    etape: jugerAnalyse(analyse),
    scoreImitation: analyse.axe.score,
    marqueDetectee: analyse.axe.marqueDetectee,
    signaux: analyse.axe.signaux,
    marqueurs: analyse.marqueurs,
  };
}

/**
 * Attend, sans jamais y saisir quoi que ce soit, qu'une page révèle un
 * formulaire de connexion : attente du harnais (1,5 s) puis relecture toutes
 * les 500 ms jusqu'à ATTENTE_MAX_MS. Renvoie la dernière analyse et l'étape.
 */
async function attendreConnexion(page, bundle) {
  const debut = Date.now();
  await page.waitForTimeout(FENETRE_FP_MS);
  let analyse = await analyserPage(page, bundle);
  while (Date.now() - debut < ATTENTE_MAX_MS) {
    if (analyse && jugerAnalyse(analyse)) break;
    await page.waitForTimeout(PAS_RELECTURE_MS);
    analyse = (await analyserPage(page, bundle)) ?? analyse;
  }
  return { analyse, etape: analyse ? jugerAnalyse(analyse) : null };
}

function extraireMotifErreur(erreur) {
  const message = String(erreur?.message ?? erreur);
  const codeNet = message.match(/net::ERR_[A-Z_]+/)?.[0];
  return codeNet ?? (message.includes('Timeout') ? 'timeout' : message.split('\n')[0].slice(0, 120));
}

/**
 * 12.3.3.8 : une page d'erreur personnalisée répond hors 2xx tout en servant
 * du HTML normal — page.goto() ne le voit pas comme un échec. Deux sites Wix
 * distincts, tous deux en 404, aboutissaient ainsi à la même mire générique
 * users.wix.com/signin, entrée dans le corpus comme une page ordinaire. Une
 * réponse sans code exploitable (about:blank, réponse interceptée) n'est pas
 * écartée ici : ce n'est pas le cas qu'on cherche à filtrer.
 */
function reponseNonAcceptable(reponse) {
  if (!reponse) return false;
  const code = reponse.status();
  return code < 200 || code >= 300;
}

/** Règles Disallow du bloc User-agent: * — repli minimal, adapté à six chemins connus. */
function analyserRobotsTxt(texte) {
  const lignes = texte.split('\n').map((l) => l.trim());
  const interdits = [];
  let dansBlocEtoile = false;
  for (const ligne of lignes) {
    const [cle, ...reste] = ligne.split(':');
    const valeur = reste.join(':').trim();
    if (/^user-agent$/i.test(cle)) dansBlocEtoile = valeur === '*';
    else if (dansBlocEtoile && /^disallow$/i.test(cle) && valeur) interdits.push(valeur);
  }
  return interdits;
}

/**
 * GET avec agent explicite ; le délai couvre l'en-tête ET la lecture du corps
 * (un serveur qui goutte-à-goutte suspendait sinon le script indéfiniment).
 */
async function lireTexte(url) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_SONDAGE_MS);
  try {
    const reponse = await fetch(url, { signal: controleur.signal, redirect: 'follow', headers: { 'User-Agent': AGENT_SONDAGE } });
    if (!reponse.ok) return null;
    return { url: reponse.url, texte: await reponse.text() };
  } catch {
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Repli : chemins usuels, robots.txt lu une fois. Un chemin qui répond 2xx est
 * ensuite chargé dans le navigateur et jugé par l'adaptateur de l'extension —
 * le HTML brut ne contient pas les formulaires construits par script.
 */
async function sonderChemins(page, hote, bundle) {
  const robots = await lireTexte(`https://${hote}/robots.txt`);
  const interdits = robots ? analyserRobotsTxt(robots.texte) : [];
  let auMoinsUnAutorise = false;
  let imitation = null;
  for (const chemin of CHEMINS_SONDAGE) {
    if (interdits.some((prefixe) => chemin.startsWith(prefixe))) continue;
    auMoinsUnAutorise = true;
    if (!(await lireTexte(`https://${hote}${chemin}`))) continue;
    let reponseChemin;
    try {
      reponseChemin = await page.goto(`https://${hote}${chemin}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
    } catch {
      continue;
    }
    if (reponseNonAcceptable(reponseChemin)) continue;
    const { analyse, etape } = await attendreConnexion(page, bundle);
    imitation = resumerImitation(analyse) ?? imitation;
    if (etape) {
      return {
        issue: 'retenue',
        mode: 'chemin-sonde',
        etape,
        url: `https://${hote}${chemin}`,
        urlFinale: origineEtChemin(page.url()),
        chemin,
        imitationConnexion: imitation,
      };
    }
  }
  return { issue: auMoinsUnAutorise ? 'sondage-sans-resultat' : 'sondage-interdit-par-robots', imitationConnexion: imitation };
}

/**
 * Localise la page de connexion d'un hôte à partir de sa page d'accueil.
 * `page` est une page Playwright neuve (12.3.1.1), déjà sous filtrage de
 * ressources ; `bundle` est le code de l'adaptateur de l'extension
 * (bundle-adaptateur.mjs). Ne fait que naviguer et lire le DOM, jamais saisir
 * ni soumettre. Le résultat porte toujours imitationAccueil quand l'accueil
 * a pu être lu.
 */
export async function trouverPageConnexion(page, urlAccueil, bundle) {
  let hote;
  try {
    hote = new URL(urlAccueil).hostname;
  } catch {
    return { issue: 'url-invalide' };
  }

  let reponseAccueil;
  try {
    reponseAccueil = await page.goto(urlAccueil, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
  } catch (erreur) {
    return { issue: 'accueil-non-joignable', motif: extraireMotifErreur(erreur) };
  }
  if (reponseNonAcceptable(reponseAccueil)) {
    return { issue: 'accueil-reponse-non-2xx', statut: reponseAccueil.status() };
  }

  // Attente du harnais avant de lire l'accueil : la navigation d'un site
  // construit par script n'existe pas plus tôt.
  await page.waitForTimeout(FENETRE_FP_MS);
  const imitationAccueil = resumerImitation(await analyserPage(page, bundle));
  const avec = (r) => ({ ...r, imitationAccueil });

  let liens;
  try {
    liens = await trouverLiensConnexion(page);
  } catch (erreur) {
    return avec({ issue: 'page-instable', motif: extraireMotifErreur(erreur) });
  }
  const lien = liens[0];
  if (!lien) return avec(await sonderChemins(page, hote, bundle));

  let urlLien;
  try {
    urlLien = new URL(lien.href, page.url()).href;
  } catch {
    return avec({ issue: 'lien-href-invalide', libelle: lien.texte || lien.title || lien.ariaLabel });
  }

  let reponseLien;
  try {
    reponseLien = await page.goto(urlLien, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
  } catch (erreur) {
    return avec({ issue: 'lien-non-joignable', urlLien, motif: extraireMotifErreur(erreur) });
  }
  if (reponseNonAcceptable(reponseLien)) {
    return avec({ issue: 'lien-reponse-non-2xx', urlLien, statut: reponseLien.status() });
  }

  const { analyse, etape } = await attendreConnexion(page, bundle);
  const imitationConnexion = resumerImitation(analyse);
  const urlFinale = origineEtChemin(page.url());

  if (!etape) {
    // Champs de connexion présents mais hors de tout <form> : invisibles pour
    // la règle Z5 de l'extension — candidat d'angle mort du produit, à ne pas
    // confondre avec une page sans formulaire.
    const horsForm = analyse?.champsHorsFormulaire ?? 0;
    return avec({
      issue: horsForm > 0 ? 'champs-hors-formulaire' : 'lien-sans-champ-de-connexion',
      urlLien: urlFinale,
      champsHorsFormulaire: horsForm,
      imitationConnexion,
    });
  }

  // url : l'URL du lien suivi depuis l'accueil — point d'entrée stable
  // (12.3.3.2). urlFinale : où la navigation a réellement abouti, sans
  // paramètres volatils.
  return avec({ issue: 'retenue', mode: 'lien-suivi', etape, url: urlLien, urlFinale, chemin: new URL(urlFinale).pathname, imitationConnexion });
}
