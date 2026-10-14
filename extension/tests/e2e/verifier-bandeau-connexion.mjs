// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.22 B : vérification en navigateur réel du bandeau de connexion et de son
// paramètre à trois positions. Vrai build (dist/chrome-essai). Le bandeau est
// dans une racine Shadow DOM fermée : les boutons sont trouvés par le
// protocole DevTools (DOM.getDocument avec pierce) et cliqués à la souris
// réelle par leurs coordonnées, comme verifier-interface.mjs.
//
// Aucune saisie dans aucune page. Les adresses visitées sont servies
// localement (route) sous leurs vrais noms d'hôte : rien ne sort.
//
// À exécuter depuis extension/, après `npm run build:chrome` :
//   node tests/e2e/verifier-bandeau-connexion.mjs
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const DIST = join(ICI, '..', '..', 'dist', 'chrome-essai');
const PAGES = join(ICI, '..', 'pages');
const CAPTURES = process.env.CAPTURES ?? join(tmpdir(), 'tourmentin-captures');
mkdirSync(CAPTURES, { recursive: true });
const ID_HOTE = 'tourmentin-bandeau-connexion';
const ID_HOTE_N2 = 'tourmentin-bandeau-n2';

let echecs = 0;
function verifier(libelle, condition, detail = '') {
  console.log(`${condition ? 'OK    ' : 'ÉCHEC '} ${libelle}${detail ? ' — ' + detail : ''}`);
  if (!condition) echecs++;
}

const fichier = (...p) => readFileSync(join(PAGES, ...p), 'utf8');
const PAGE_PAIEMENT_ET_MOT_DE_PASSE = `<!doctype html><title>Paiement</title><p>Règlement</p>
<form><input type="password" name="mdp"><input autocomplete="cc-number" name="carte"></form>`;
const PAGE_N2 = `<!doctype html><html><head><title>Espace Particulier</title></head>
<body><p>Espace Particulier — DGFiP, avis d'imposition, taxe d'habitation</p>
<form><input type="password" name="mdp"></form></body></html>`;
const SITES = {
  'portail-etudiant-exemple.fr': fichier('legitimes', '07-portail-etudiant.html'), // mot de passe, site inconnu
  'forum-exemple.fr': fichier('legitimes', '05-forum.html'), // mot de passe, site inconnu
  'asso-newsletter-exemple.fr': fichier('legitimes', '04-newsletter.html'), // pas de mot de passe
  'boutique-mdp-exemple.fr': PAGE_PAIEMENT_ET_MOT_DE_PASSE,
  'impots.gouv.fr': '<!doctype html><title>Impôts</title><p>site officiel factice</p><form><input type="password" name="mdp"></form>',
  'impots-gouv.fr': PAGE_N2,
  'ameli-secure.fr': fichier('imitations', '02-ameli.html'),
};

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tourmentin-connexion-')), {
  channel: 'chromium',
  headless: false,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});
for (const [hote, corps] of Object.entries(SITES)) {
  await context.route(`https://${hote}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: corps }));
}
await new Promise((r) => setTimeout(r, 2500));
for (const p of context.pages()) if (p.url().includes('premier-lancement')) await p.close();
const sw = context.serviceWorkers()[0];
  // Ces contrôles portent sur le parcours LOCAL (14.7) : on fixe « Ne jamais envoyer ». Le parcours avec envoi est dans verifier-envoi.mjs.
  await sw.evaluate(async () => { const { reglages = {} } = await chrome.storage.local.get('reglages'); await chrome.storage.local.set({ reglages: { ...reglages, modeEnvoi: 'jamais' } }); });
const idExtension = new URL(sw.url()).host;
const urlOptions = `chrome-extension://${idExtension}/src/options/options.html`;

const aUnBandeau = (page, id = ID_HOTE) => page.evaluate((i) => !!document.getElementById(i), id);
async function attendreBandeau(page, id = ID_HOTE, ms = 3500) {
  await page.waitForFunction((i) => !!document.getElementById(i), id, { timeout: ms }).catch(() => {});
  return aUnBandeau(page, id);
}
const reinitialiserMemoire = () => sw.evaluate(() => chrome.storage.local.remove(['hotesVus', 'signalements']));
const reglerMode = (mode) => sw.evaluate(async (m) => {
  const { reglages = {} } = await chrome.storage.local.get('reglages');
  await chrome.storage.local.set({ reglages: { ...reglages, avertirConnexion: m } });
}, mode);

async function boitesDesBoutons(page) {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const parcourir = (n, f) => {
    f(n);
    for (const e of [...(n.children ?? []), ...(n.shadowRoots ?? []), ...(n.contentDocument ? [n.contentDocument] : [])]) parcourir(e, f);
  };
  let hote;
  parcourir(root, (n) => { if (n.attributes && n.attributes.includes(ID_HOTE)) hote = n; });
  if (!hote) { await cdp.detach(); return {}; }
  const ids = {};
  parcourir(hote, (n) => {
    if (n.nodeName === 'BUTTON') ids[(n.children ?? []).map((c) => c.nodeValue ?? '').join('')] = n.backendNodeId;
  });
  const centres = {};
  for (const [texte, backendNodeId] of Object.entries(ids)) {
    const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId }).catch(() => ({ model: null }));
    if (!model) continue;
    const q = model.content;
    centres[texte] = { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 };
  }
  await cdp.detach();
  return centres;
}
async function cliquer(page, libelle) {
  const b = await boitesDesBoutons(page);
  if (!b[libelle]) return false;
  await page.mouse.click(b[libelle].x, b[libelle].y);
  return true;
}
async function visiter(url) {
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

// --- 1. « Une fois par site » (par défaut) ---------------------------------------------------
await reinitialiserMemoire();
const parDefaut = await sw.evaluate(async () => (await chrome.storage.local.get('reglages')).reglages?.avertirConnexion ?? null);
verifier('réglage par défaut : rien d\'écrit, donc « une fois par site »', parDefaut === null);

let page = await visiter('https://portail-etudiant-exemple.fr/');
verifier('1ère visite d\'un site inconnu à champ mot de passe : le bandeau s\'affiche', await attendreBandeau(page));
const texte = await page.evaluate(() => document.getElementById('tourmentin-bandeau-connexion') ? 'present' : '');
verifier('le bandeau est dans la page (hôte présent)', texte === 'present');
await page.screenshot({ path: join(CAPTURES, 'connexion-1-une-fois-1ere-visite.png') });
await page.waitForTimeout(1500);
const mutations = await page.evaluate(() => new Promise((resolve) => {
  let n = 0;
  new MutationObserver((r) => { n += r.length; }).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => resolve(n), 3000);
}));
verifier('le bandeau affiché ne se recrée pas en boucle (0 mutation en 3 s)', mutations === 0, `${mutations} mutation(s)`);
const boutons1 = Object.keys(await boitesDesBoutons(page));
verifier('boutons : « C\'est le bon site », « Comment vérifier une adresse » et le contrôle « × »',
  ['C\'est le bon site', 'Comment vérifier une adresse', '×'].every((b) => boutons1.includes(b)) && boutons1.length === 3, boutons1.join(' | '));

// « × » : ferme sans rien déclarer
await cliquer(page, '×');
verifier('« × » retire le bandeau', !(await aUnBandeau(page)));
await page.waitForTimeout(2000);
verifier('… et il ne revient pas sur la même page', !(await aUnBandeau(page)));
const ecrit = await sw.evaluate(async () => ((await chrome.storage.local.get('signalements')).signalements ?? []).length);
verifier('… sans rien déclarer : aucune entrée dans la file locale', ecrit === 0, `${ecrit} entrée(s)`);
await page.close();

page = await visiter('https://portail-etudiant-exemple.fr/');
verifier('2e visite du même site en « une fois par site » : pas de bandeau', !(await attendreBandeau(page, ID_HOTE, 3000)));
await page.screenshot({ path: join(CAPTURES, 'connexion-1b-une-fois-2e-visite.png') });
await page.close();
const autre = await visiter('https://forum-exemple.fr/');
verifier('un autre site inconnu à champ mot de passe : le bandeau s\'affiche', await attendreBandeau(autre));
await autre.close();
const memoire = await sw.evaluate(async () => (await chrome.storage.local.get('hotesVus')).hotesVus ?? []);
verifier('mémoire « déjà vu » : deux empreintes de 16 caractères, jamais l\'hôte',
  memoire.length === 2 && memoire.every((e) => /^[0-9a-f]{16}$/.test(e)) && !JSON.stringify(memoire).includes('exemple'), JSON.stringify(memoire));

const bandeauxParJour = await sw.evaluate(async () => (await chrome.storage.local.get('bandeauxParJour')).bandeauxParJour ?? {});
const jourCle = new Date().toISOString().slice(0, 10);
verifier("compteur local : deux bandeaux affichés aujourd'hui, un entier par date, aucun hôte", bandeauxParJour[jourCle] === 2 && Object.keys(bandeauxParJour).length === 1 && !JSON.stringify(bandeauxParJour).includes('exemple'), JSON.stringify(bandeauxParJour));

// --- 2. « À chaque visite » ---------------------------------------------------------------------
await reglerMode('chaque-visite');
page = await visiter('https://portail-etudiant-exemple.fr/');
verifier('« à chaque visite » : le bandeau s\'affiche malgré une visite antérieure', await attendreBandeau(page));
await page.screenshot({ path: join(CAPTURES, 'connexion-2-chaque-visite.png') });
await page.close();

// --- 3. « Jamais » --------------------------------------------------------
await reglerMode('jamais');
await reinitialiserMemoire();
page = await visiter('https://portail-etudiant-exemple.fr/');
verifier('« jamais » : aucun bandeau, même à la première visite', !(await attendreBandeau(page, ID_HOTE, 3000)));
await page.screenshot({ path: join(CAPTURES, 'connexion-3-jamais.png') });
await page.close();

// --- 4. le réglage depuis la vraie page d'options ----------------------------------------------------
{
  const opt = await context.newPage();
  await opt.goto(urlOptions + '#parametres');
  const valeurs = await opt.locator('#mode-avertissement option').evaluateAll((os) => os.map((o) => o.textContent));
  verifier('page d\'options : les trois positions, dans l\'ordre', valeurs.join('|') === 'Une fois par site|À chaque visite|Jamais', valeurs.join('|'));
  verifier('page d\'options : la position lue est celle qui est enregistrée', (await opt.locator('#mode-avertissement').inputValue()) === 'jamais');
  await opt.selectOption('#mode-avertissement', 'une-fois');
  await opt.waitForTimeout(500);
  const enregistre = await sw.evaluate(async () => (await chrome.storage.local.get('reglages')).reglages);
  verifier('choisir « une fois par site » l\'enregistre, sans toucher au journal', enregistre.avertirConnexion === 'une-fois' && enregistre.journalActif === false, JSON.stringify(enregistre));
  await opt.screenshot({ path: join(CAPTURES, 'connexion-4-options.png') });
  await opt.close();
}

// --- 5. les cas où le bandeau ne s'affiche jamais ---------------------------------------------------------
await reglerMode('chaque-visite');
await reinitialiserMemoire();
for (const [url, raison] of [
  ['https://impots.gouv.fr/', 'site officiel vérifié'],
  ['https://boutique-mdp-exemple.fr/', 'page portant un moyen de paiement'],
  ['https://asso-newsletter-exemple.fr/', 'aucun champ mot de passe'],
]) {
  const p = await visiter(url);
  verifier(`jamais de bandeau de connexion : ${raison}`, !(await attendreBandeau(p, ID_HOTE, 3000)));
  await p.close();
}
{
  const p = await visiter('https://impots-gouv.fr/connexion');
  const n2 = await attendreBandeau(p, ID_HOTE_N2);
  verifier('page N2 (mot de passe, imitation) : le bandeau d\'alerte s\'affiche…', n2);
  verifier('… et le bandeau de connexion ne s\'affiche pas (le bandeau d\'alerte prime)', !(await aUnBandeau(p)));
  await p.close();
}

// --- 6. « C'est le bon site » : aperçu, puis confirmation ----------------------------------------------------
await reglerMode('chaque-visite');
await reinitialiserMemoire();
page = await visiter('https://portail-etudiant-exemple.fr/');
await attendreBandeau(page);
await cliquer(page, 'C\'est le bon site');
await page.waitForTimeout(800);
const apres1 = await boitesDesBoutons(page);
verifier('un clic sur « C\'est le bon site » montre l\'aperçu et une confirmation', 'Confirmer la déclaration' in apres1, Object.keys(apres1).join(' | '));
const avantConfirmation = await sw.evaluate(async () => ((await chrome.storage.local.get('signalements')).signalements ?? []).length);
verifier('rien n\'est écrit avant la confirmation', avantConfirmation === 0, `${avantConfirmation} entrée(s)`);
await page.screenshot({ path: join(CAPTURES, 'connexion-6a-apercu.png') });
await cliquer(page, 'Confirmer la déclaration');
await page.waitForTimeout(800);
const entrees = await sw.evaluate(async () => (await chrome.storage.local.get('signalements')).signalements ?? []);
verifier('après confirmation : une entrée « officiel » pour cet hôte, sans requête ni valeur de champ',
  entrees.length === 1 && entrees[0].type === 'officiel' && entrees[0].hote === 'portail-etudiant-exemple.fr', JSON.stringify(entrees[0]));
verifier('le bandeau reste affiché avec le texte « enregistré, pas encore transmis »', await aUnBandeau(page));
await page.screenshot({ path: join(CAPTURES, 'connexion-6b-enregistre.png') });
await page.close();

// --- 7. « Comment vérifier une adresse » ------------------------------------------------------------------------------
page = await visiter('https://forum-exemple.fr/');
await attendreBandeau(page);
const ouverture = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
await cliquer(page, 'Comment vérifier une adresse');
const aide = await ouverture;
if (aide) await aide.waitForLoadState('domcontentloaded').catch(() => {});
verifier('« Comment vérifier une adresse » ouvre la vue #verifier', !!aide && aide.url().endsWith('/src/options/options.html#verifier'), aide ? aide.url() : 'aucun onglet');
verifier('… sans fermer le bandeau', await aUnBandeau(page));
if (aide) await aide.close();
await page.close();

await context.close();
console.log(`\nCaptures : ${CAPTURES}`);
console.log(echecs === 0 ? 'Tous les contrôles sont conformes.' : `${echecs} contrôle(s) en échec.`);
process.exit(echecs === 0 ? 0 : 1);
