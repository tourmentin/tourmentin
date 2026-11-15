// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.13 point 5 : vérification de l'interface dans un vrai Chromium avec le
// vrai build d'essai (dist/chrome-essai), pas une variante ouverte. Le bandeau est dans une
// racine Shadow DOM FERMÉE : Playwright ne la perce pas par sélecteur (et la
// page hostile non plus, c'est le but). On passe par le protocole DevTools —
// DOM.getDocument avec pierce:true expose les racines fermées au niveau du
// moteur, comme le panneau Éléments — pour lire la boîte de chaque bouton,
// puis on clique par coordonnées avec la souris réelle (page.mouse.click).
//
// Vérifie, dans l'ordre :
//   1. onInstalled ouvre l'écran de premier lancement, une fois et une seule ;
//   2. bandeau N2 : les deux boutons, cliqués à la souris (« Aller sur le site
//      officiel » ouvre bien le domaine principal ; « Fermer ce message »
//      retire le bandeau) ;
//   3. plafond de la version d'essai (14.5) : une page qui est N3 par score
//      rend un bandeau N2 dans ce build — pas le silence ;
//   4. export : journal activé, une page N2 visitée avec requête et fragment,
//      export téléchargé, relu : ni requête ni fragment dans le fichier.
//
// Aucune saisie dans aucune page, aucun champ rempli. Réseau : toutes les
// adresses visitées sont servies localement (route), rien ne sort.
//
// À exécuter depuis extension/, après `npm run build:chrome` ET `npm run build:mesure` :
//   node tests/e2e/verifier-interface.mjs
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const DIST = join(ICI, '..', '..', 'dist', 'chrome-essai');
const PAGES = join(ICI, '..', 'pages');
const ID_HOTE = 'tourmentin-bandeau-n2';

const PAGE_N2 = `<!doctype html><html><head><title>Espace Particulier</title></head>
<body><p>Espace Particulier — DGFiP, avis d'imposition, taxe d'habitation</p>
<form><input type="password" name="mdp"></form></body></html>`;

let echecs = 0;
function verifier(libelle, condition, detail = '') {
  console.log(`${condition ? 'OK    ' : 'ÉCHEC '} ${libelle}${detail ? ' — ' + detail : ''}`);
  if (!condition) echecs++;
}

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tourmentin-e2e-')), {
  channel: 'chromium',
  headless: false,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});

// Pages d'un niveau connu, servies localement (mêmes fixtures que tests/integration).
const PAGES_PAR_HOTE = {
  'mairie-exemple.fr': join('legitimes', '01-mairie-contact.html'), // N0
  'ameli-secure.fr': join('imitations', '02-ameli.html'), // N1
  'impots-gouv.fr': null, // N2 par défaut, N3 par score sur /imitation-n3 (géré plus bas)
};
async function servirPages(ctx) {
  await ctx.route('https://impots-gouv.fr/**', (route) => {
    const url = new URL(route.request().url());
    const corps = url.pathname === '/imitation-n3' ? readFileSync(join(PAGES, 'imitations', '01-impots-gouv.html'), 'utf8') : PAGE_N2;
    return route.fulfill({ status: 200, contentType: 'text/html', body: corps });
  });
  for (const [hote, fichier] of Object.entries(PAGES_PAR_HOTE)) {
    if (!fichier) continue;
    await ctx.route(`https://${hote}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(PAGES, fichier), 'utf8') }));
  }
}
async function badgeDe(sw, prefixeUrl) {
  return sw.evaluate(async (pre) => {
    const onglets = await chrome.tabs.query({});
    const onglet = onglets.find((o) => o.url && o.url.startsWith(pre));
    if (!onglet) return null;
    return { texte: await chrome.action.getBadgeText({ tabId: onglet.id }), couleur: await chrome.action.getBadgeBackgroundColor({ tabId: onglet.id }) };
  }, prefixeUrl);
}
const hex = ([r, g, b]) => '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
async function verifierBadge(page, sw, url, attenduTexte, attenduCouleur, libelle) {
  await page.goto(url);
  await page.waitForTimeout(1800);
  const b = await badgeDe(sw, url.split('?')[0]);
  const ok = !!b && b.texte === attenduTexte && (attenduCouleur === null || hex(b.couleur) === attenduCouleur);
  verifier(libelle, ok, b ? `badge « ${b.texte} » ${hex(b.couleur)}` : 'onglet introuvable');
}

const nouveauxOnglets = [];
context.on('page', (p) => nouveauxOnglets.push(p));

// Tout ce qui est visité est servi localement.
await context.route('https://impots-gouv.fr/**', (route) => {
  const url = new URL(route.request().url());
  const corps = url.pathname === '/imitation-n3'
    ? readFileSync(join(PAGES, 'imitations', '01-impots-gouv.html'), 'utf8')
    : PAGE_N2;
  return route.fulfill({ status: 200, contentType: 'text/html', body: corps });
});
await context.route('https://impots.gouv.fr/**', (route) =>
  route.fulfill({ status: 200, contentType: 'text/html', body: '<title>officiel</title><p>site officiel factice</p>' }),
);

// --- 1. onInstalled ---------------------------------------------------------
await new Promise((r) => setTimeout(r, 3000));
const ouverts = context.pages().filter((p) => p.url().includes('options.html#premier-lancement'));
verifier('onInstalled ouvre l\'écran de premier lancement, une fois et une seule', ouverts.length === 1, `${ouverts.length} onglet(s)`);
const idExtension = new URL(context.serviceWorkers()[0].url()).host;
const urlOptions = `chrome-extension://${idExtension}/src/options/options.html`;
await Promise.all(ouverts.map((p) => p.close()));

// --- utilitaires CDP ------------------------------------------------------------
async function boitesDesBoutons(page) {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const parcourir = (n, f) => {
    f(n);
    for (const e of [...(n.children ?? []), ...(n.shadowRoots ?? []), ...(n.contentDocument ? [n.contentDocument] : [])]) parcourir(e, f);
  };
  let hote;
  parcourir(root, (n) => {
    if (n.attributes && n.attributes.includes(ID_HOTE)) hote = n;
  });
  if (!hote) return { hote: false, boutons: {} };
  const boutons = {};
  parcourir(hote, (n) => {
    if (n.nodeName === 'BUTTON') {
      const texte = (n.children ?? []).map((c) => c.nodeValue ?? '').join('');
      boutons[texte] = n.backendNodeId;
    }
  });
  const centres = {};
  for (const [texte, backendNodeId] of Object.entries(boutons)) {
    const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId });
    const q = model.content;
    centres[texte] = { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 };
  }
  await cdp.detach();
  return { hote: true, boutons: centres };
}

const aUnBandeau = (page) => page.evaluate((id) => !!document.getElementById(id), ID_HOTE);

// --- 2. bandeau N2 : clics souris réels ---------------------------------------------
const page = await context.newPage();
// Verdicts issus d'une mutation : le script de contenu les journalise (12.3.1.3).
const verdictsParMutation = [];
page.on('console', (m) => { if (m.text().includes('verdict origine=mutation')) verdictsParMutation.push(m.text()); });
await page.goto('https://impots-gouv.fr/connexion');
await page.waitForFunction((id) => !!document.getElementById(id), ID_HOTE, { timeout: 8000 }).catch(() => {});
let etat = await boitesDesBoutons(page);
verifier('bandeau N2 rendu dans la page', etat.hote);
// Pas de boucle de réaffichage : afficher le bandeau modifiait le DOM, ce qui
// relançait une analyse, qui le réaffichait (18 mutations en 3 s avant 14.15).
await page.waitForTimeout(1500);
const mutations = await page.evaluate(() => new Promise((resolve) => {
  let n = 0;
  new MutationObserver((r) => { n += r.length; }).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => resolve(n), 3000);
}));
verifier('le bandeau affiché ne se recrée pas en boucle (0 mutation du document en 3 s)', mutations === 0, `${mutations} mutation(s)`);
verifier('trois boutons présents, libellés attendus (aide, action sûre, fermeture)',
  Object.keys(etat.boutons).sort().join('|') === ['Aller sur le site officiel', 'Comment vérifier une adresse', 'Fermer ce message'].sort().join('|'),
  Object.keys(etat.boutons).join(' | '));
verifier('« Rester ici et continuer » n\'existe plus', !('Rester ici et continuer' in etat.boutons));

const avant = nouveauxOnglets.length;
const ouverture = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
await page.mouse.click(etat.boutons['Aller sur le site officiel'].x, etat.boutons['Aller sur le site officiel'].y);
const onglet = await ouverture;
if (onglet) await onglet.waitForLoadState('domcontentloaded').catch(() => {});
verifier('clic souris « Aller sur le site officiel » : nouvel onglet sur le domaine principal',
  !!onglet && onglet.url() === 'https://impots.gouv.fr/', onglet ? onglet.url() : 'aucun onglet ouvert');
verifier('l\'onglet d\'origine n\'a pas bougé et le bandeau y est toujours (l\'action sûre ne ferme rien)',
  page.url() === 'https://impots-gouv.fr/connexion' && (await aUnBandeau(page)));
if (onglet) await onglet.close();
void avant;

// 14.15 point 2 : le lien d'aide ouvre #verifier dans un onglet, sans fermer le bandeau.
await page.bringToFront();
etat = await boitesDesBoutons(page);
const ouvertureAide = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
await page.mouse.click(etat.boutons['Comment vérifier une adresse'].x, etat.boutons['Comment vérifier une adresse'].y);
const aide = await ouvertureAide;
if (aide) await aide.waitForLoadState('domcontentloaded').catch(() => {});
verifier("clic souris « Comment vérifier une adresse » : la vue #verifier s'ouvre dans un onglet",
  !!aide && aide.url().endsWith('/src/options/options.html#verifier'), aide ? aide.url() : 'aucun onglet ouvert');
if (aide) {
  const texte = await aide.evaluate(() => document.getElementById('vue-verifier')?.innerText ?? '');
  verifier('la vue #verifier affiche les six lignes, sans les autres vues',
    (await aide.locator('#vue-verifier li').count()) === 6 && (await aide.locator('#vue-verifier').isVisible()) && !(await aide.locator('#vue-parametres').isVisible()),
    `${await aide.locator('#vue-verifier li').count()} lignes`);
  verifier('ligne 1 corrigée (après « https:// »), ligne du cadenas présente',
    texte.includes('après « https:// » et avant la barre oblique suivante') && texte.includes('Le cadenas ne prouve rien'));
  await aide.close();
}
verifier("le bandeau est toujours là après l'ouverture de l'aide", await aUnBandeau(page));

await page.bringToFront();
etat = await boitesDesBoutons(page);
await page.mouse.click(etat.boutons['Fermer ce message'].x, etat.boutons['Fermer ce message'].y);
verifier('clic souris « Fermer ce message » : le bandeau est retiré', !(await aUnBandeau(page)));
// Le débounce de réanalyse est de 300 ms : un contrôle à 300 ms ne voit pas un
// bandeau qui revient après. Bug relevé le 28/09/2026 (14.15) : la fermeture
// déclenchait une mutation, donc une analyse, donc un réaffichage.
await page.waitForTimeout(2500);
verifier('« Fermer ce message » ferme pour de bon : toujours fermé 2,5 s plus tard', !(await aUnBandeau(page)));

// 14.17 : la fermeture porte sur le verdict fermé. La même page fait apparaître un
// moyen de paiement (E8) : le verdict s'aggrave, le bandeau doit revenir.
await page.evaluate(() => {
  const carte = document.createElement('input');
  carte.setAttribute('autocomplete', 'cc-number');
  carte.name = 'carte';
  document.querySelector('form').append(carte);
});
await page.waitForFunction((id) => !!document.getElementById(id), ID_HOTE, { timeout: 5000 }).catch(() => {});
verifier('fermé, puis un formulaire de paiement apparaît sur la même page : le bandeau revient', await aUnBandeau(page));

// 14.17 : le filtre de l'observateur ne rend pas aveugle pendant l'affichage. Bandeau
// affiché, la page ajoute un champ mot de passe : la réanalyse a lieu.
await page.waitForTimeout(1500);
const avantAjout = verdictsParMutation.length;
await page.evaluate(() => {
  const mdp = document.createElement('input');
  mdp.type = 'password';
  mdp.name = 'mdp-substitue';
  document.querySelector('form').append(mdp);
});
await page.waitForTimeout(1500);
verifier('bandeau affiché, la page ajoute un champ mot de passe : la réanalyse a lieu',
  verdictsParMutation.length > avantAjout, `${verdictsParMutation.length - avantAjout} verdict(s) issu(s) de la mutation`);
verifier('...et le bandeau reste affiché (verdict identique)', await aUnBandeau(page));

// Fermer à nouveau : la fermeture repart du verdict désormais affiché.
etat = await boitesDesBoutons(page);
await page.mouse.click(etat.boutons['Fermer ce message'].x, etat.boutons['Fermer ce message'].y);
await page.waitForTimeout(2000);
verifier('fermé à nouveau, verdict inchangé : reste fermé', !(await aUnBandeau(page)));

// --- 3. plafond : N3 par score => bandeau N2 dans le build d'essai --------------------
await page.goto('https://impots-gouv.fr/imitation-n3');
await page.waitForFunction((id) => !!document.getElementById(id), ID_HOTE, { timeout: 8000 }).catch(() => {});
verifier('page N3 par score : le build d\'essai rend un bandeau N2 (pas le silence)', await aUnBandeau(page));

// --- 3 bis. badge par niveau, dans le build d'essai --------------------------------------
await servirPages(context);
const swEssai = context.serviceWorkers()[0];
await verifierBadge(page, swEssai, 'https://mairie-exemple.fr/contact', '', null, 'badge N0 (page légitime) : aucun badge');
await verifierBadge(page, swEssai, 'https://ameli-secure.fr/connexion', '!', '#E8A33D', 'badge N1 : « ! » orange');
await verifierBadge(page, swEssai, 'https://impots-gouv.fr/connexion', '!!', '#D9822B', 'badge N2 : « !! » orange foncé');
await verifierBadge(page, swEssai, 'https://impots-gouv.fr/imitation-n3', '!!', '#D9822B', "badge d'une page N3 par score, build d'essai : « !! » (plafond N2, pas « !!! »)");

// --- 4. export ------------------------------------------------------------------------
const options = await context.newPage();
await options.goto(urlOptions + '#parametres');
await options.check('#interrupteur-journal');
await options.waitForTimeout(500);
await page.goto('https://impots-gouv.fr/connexion?jeton=abc123&adresse=jean%40mail.fr#secret-de-session');
await page.waitForFunction((id) => !!document.getElementById(id), ID_HOTE, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(800);

await options.reload();
await options.waitForTimeout(500);
const [telechargement] = await Promise.all([
  options.waitForEvent('download', { timeout: 8000 }).catch(() => null),
  options.click('#exporter-journal'),
]);
verifier('l\'export du journal télécharge un fichier', !!telechargement);
if (telechargement) {
  const chemin = await telechargement.path();
  const texte = readFileSync(chemin, 'utf8');
  const objet = JSON.parse(texte);
  verifier('nom de fichier daté', /^tourmentin-journal-\d{4}-\d{2}-\d{2}\.json$/.test(telechargement.suggestedFilename()), telechargement.suggestedFilename());
  verifier('le journal contient l\'entrée N2 de la page visitée',
    objet.entrees.some((e) => e.hote === 'impots-gouv.fr' && e.chemin === '/connexion' && e.niveau === 'N2' && e.requetePresente === true));
  verifier('ni requête, ni fragment, ni jeton dans le fichier',
    !texte.includes('abc123') && !texte.includes('jean') && !texte.includes('secret-de-session'));
  verifier('versions présentes dans l\'export', !!objet.version_extension && !!objet.version_socle, `${objet.version_extension} / ${objet.version_socle}`);
}
verifier("build d'essai : aucune annonce « Build de mesure » sur la page d'options",
  !(await options.locator('#annonce-mesure').isVisible()));
const badgeEssai = await context.serviceWorkers()[0].evaluate(() => chrome.action.getBadgeText({}));
verifier("build d'essai : aucune marque « M » sur le badge global", badgeEssai === '', JSON.stringify(badgeEssai));
await context.close();

// --- 5. le build de mesure s'annonce (14.15 point 1) ----------------------------
const DIST_MESURE = join(ICI, '..', '..', 'dist', 'chrome-mesure');
try {
  readFileSync(join(DIST_MESURE, 'manifest.json'));
  const ctxMesure = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tourmentin-e2e-mesure-')), {
    channel: 'chromium', headless: false,
    args: [`--disable-extensions-except=${DIST_MESURE}`, `--load-extension=${DIST_MESURE}`],
  });
  await new Promise((r) => setTimeout(r, 2500));
  const sw = ctxMesure.serviceWorkers()[0];
  const idMesure = new URL(sw.url()).host;
  await servirPages(ctxMesure);
  const pageBadges = await ctxMesure.newPage();
  await verifierBadge(pageBadges, sw, 'https://mairie-exemple.fr/contact', 'M', '#6D28D9', 'build de mesure, N0 : « M » violet');
  await verifierBadge(pageBadges, sw, 'https://ameli-secure.fr/connexion', 'M!', '#E8A33D', 'build de mesure, N1 : « M! »');
  await verifierBadge(pageBadges, sw, 'https://impots-gouv.fr/connexion', 'M!!', '#D9822B', 'build de mesure, N2 : « M!! »');
  await verifierBadge(pageBadges, sw, 'https://impots-gouv.fr/imitation-n3', 'M!!!', '#C0392B', 'build de mesure, page N3 par score : « M!!! » rouge (N3 actif)');
  const pageOptions = await ctxMesure.newPage();
  await pageOptions.goto(`chrome-extension://${idMesure}/src/options/options.html#parametres`);
  const annonce = pageOptions.locator('#annonce-mesure');
  verifier('build de mesure : « Build de mesure — ne pas distribuer » en tête des options',
    (await annonce.isVisible()) && (await annonce.innerText()).includes('ne pas distribuer'));
  const badgeMesure = await sw.evaluate(() => chrome.action.getBadgeText({}));
  verifier('build de mesure : marque « M » sur le badge', badgeMesure === 'M', JSON.stringify(badgeMesure));
  await ctxMesure.close();
} catch (e) {
  verifier('build de mesure présent (npm run build:mesure) pour vérifier son annonce', false, String(e.message).slice(0, 80));
}
console.log(echecs === 0 ? '\nTout est conforme.' : `\n${echecs} vérification(s) en échec.`);
process.exit(echecs === 0 ? 0 : 1);
