// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.22 point 1 : la popup ne reste jamais plus de 2 s sur « Analyse en cours… ».
// Reproduction, puis contrôle de non-régression, dans un vrai Chromium avec le
// vrai build (dist/chrome-essai) et la vraie popup (chrome.action.openPopup(),
// lue par une seconde connexion CDP, comme verifier-popup.mjs).
//
// Cas : A onglet ouvert avant l'installation (script de contenu absent) ; B service worker sans verdict en session, script de contenu
// vivant ; C nouvel onglet ; D PDF ; E boutique d'extensions ; F page
// chrome-extension:// ; G état d'un onglet sans l'adresse analysée (écrit par
// une version antérieure) .
//
// À exécuter depuis extension/, après `npm run build:chrome` :
//   node tests/e2e/verifier-popup-blocage.mjs
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const DIST = join(ICI, '..', '..', 'dist', 'chrome-essai');
const CAPTURES = process.env.CAPTURES ?? join(tmpdir(), 'tourmentin-captures');
mkdirSync(CAPTURES, { recursive: true });
const PORT = 9360;
const LIMITE_MS = 2000;
const ATTENTE = 'Analyse en cours';
const MESSAGE_RECHARGER = "Tourmentin n'a pas encore analysé cette page : rechargez-la";
const STATUT_Z4 = "Tourmentin ne s'applique pas à cette page";

let echecs = 0;
function verifier(libelle, condition, detail = '') {
  console.log(`${condition ? 'OK    ' : 'ÉCHEC '} ${libelle}${detail ? ' — ' + detail : ''}`);
  if (!condition) echecs++;
}

const PDF = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
const HTML_NEUTRE = '<!doctype html><title>Article</title><p>Un article sans aucun champ de saisie.</p>';

let context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tourmentin-blocage-')), {
  channel: 'chromium',
  headless: false,
  ignoreDefaultArgs: ['--disable-extensions'],
  // Sans extension au départ : le cas A exige un onglet ouvert AVANT l'installation.
  args: [`--remote-debugging-port=${PORT}`, '--enable-unsafe-extension-debugging'],
});
await context.route('https://article-exemple.fr/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: HTML_NEUTRE }));
await context.route('https://pdf-exemple.fr/**', (r) => r.fulfill({ status: 200, contentType: 'application/pdf', body: PDF }));
await context.route('https://chromewebstore.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: HTML_NEUTRE }));
// A : onglet ouvert avant l'installation (le script de contenu n'y sera jamais injecté).
const pageAvantInstallation = await context.newPage();
await pageAvantInstallation.goto('https://article-exemple.fr/?avant');
{
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const s = await b.newBrowserCDPSession();
  await s.send('Extensions.loadUnpacked', { path: DIST });
  await b.close().catch(() => {});
}
// Playwright ne voit pas le service worker d'une extension chargée après le lancement
// dans son propre contexte : on le lit par une connexion CDP qui reste ouverte.
const cdpSw = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const serviceWorkers = () => cdpSw.contexts().flatMap((c) => c.serviceWorkers());
const idExtension = 'kknnhnlepejngllcfbdkikmennakomao';
await new Promise((r) => setTimeout(r, 1500));

// Le service worker ne tourne pas tant qu'aucun événement ne le réveille : une
// navigation d'un autre onglet le fait.
async function swActuel() {
  if (serviceWorkers().length === 0) {
    const reveil = await context.newPage();
    await reveil.goto('https://article-exemple.fr/?reveil');
    for (let i = 0; i < 40 && serviceWorkers().length === 0; i++) await new Promise((r) => setTimeout(r, 200));
    await reveil.close();
  }
  return serviceWorkers()[0];
}

/** Ouvre la vraie popup sur l'onglet donné, lit son texte à 300 ms puis à LIMITE_MS + 400 ms. */
async function popupSur(page, nom) {
  await page.bringToFront();
  const erreur = await (await swActuel()).evaluate(async () => {
    try { await chrome.action.openPopup(); return null; } catch (e) { return String(e); }
  });
  if (erreur) return { erreur };
  const debut = Date.now();
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let popup = null;
  for (let i = 0; i < 40 && !popup; i++) {
    popup = cdp.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('/popup.html')) ?? null;
    if (!popup) await new Promise((r) => setTimeout(r, 100));
  }
  if (!popup) { await cdp.close().catch(() => {}); return { erreur: 'aucune popup' }; }
  const lire = () => popup.evaluate(() => document.getElementById('contenu').innerText.trim()).catch(() => '(popup fermée)');
  await new Promise((r) => setTimeout(r, Math.max(0, 300 - (Date.now() - debut))));
  const tot = await lire();
  await new Promise((r) => setTimeout(r, Math.max(0, LIMITE_MS + 400 - (Date.now() - debut))));
  const tard = await lire();
  await popup.screenshot({ path: join(CAPTURES, `blocage-${nom}.png`) }).catch(() => {});
  await cdp.close().catch(() => {});
  return { tot, tard };
}

function attendu(nom, { tard, erreur }, accepte) {
  if (erreur) return verifier(`${nom} : popup ouverte`, false, erreur);
  const ok = !tard.startsWith(ATTENTE) && accepte.some((t) => tard === t || tard.startsWith(t));
  verifier(`${nom} : après ${LIMITE_MS / 1000} s, la popup ne reste pas sur « ${ATTENTE}… »`, ok, `affiché : « ${tard.replace(/\n/g, ' | ')} »`);
}

// --- A : onglet ouvert avant l'installation de l'extension ------------------------------------
{
  await (await swActuel()).evaluate(() => true);
  for (const p of context.pages()) if (p.url().includes('premier-lancement')) await p.close().catch(() => {});
  attendu("A onglet ouvert avant l'installation", await popupSur(pageAvantInstallation, 'A'), [MESSAGE_RECHARGER]);
  await pageAvantInstallation.close();
}

// --- B : service worker réveillé sans verdict en session, script de contenu vivant ----------
{
  const page = await context.newPage();
  await page.goto('https://article-exemple.fr/?b');
  await page.waitForTimeout(1500);
  await (await swActuel()).evaluate(() => chrome.storage.session.clear());
  attendu('B sans verdict en session (script de contenu vivant)', await popupSur(page, 'B'), ['Site non répertorié par Tourmentin', MESSAGE_RECHARGER]);
  await page.close();
}

// --- C : nouvel onglet ---------------------------------------------------------------------
{
  const page = await context.newPage();
  await page.goto('chrome://newtab/').catch(() => {});
  await page.waitForTimeout(800);
  attendu('C nouvel onglet', await popupSur(page, 'C'), [STATUT_Z4]);
  await page.close();
}

// --- D : PDF ------------------------------------------------------------------------------------
{
  const page = await context.newPage();
  await page.goto('https://pdf-exemple.fr/doc.pdf').catch(() => {});
  await page.waitForTimeout(2000);
  attendu('D PDF', await popupSur(page, 'D'), [STATUT_Z4, MESSAGE_RECHARGER, 'Site non répertorié par Tourmentin']);
  await page.close();
}

// --- E : boutique d'extensions -------------------------------------------------------------
// Non testée en navigateur réel : Chromium ferme le navigateur entier quand on lui sert
// cette adresse par une route (constaté le 30/09/2026). Traitée par statutSansVerdict
// (tests unitaires), non vérifiée ici.

// --- F : page chrome-extension:// -------------------------------------------------------------
{
  const page = await context.newPage();
  await page.goto(`chrome-extension://${idExtension}/src/options/options.html`);
  await page.waitForTimeout(800);
  attendu('F page chrome-extension://', await popupSur(page, 'F'), [STATUT_Z4]);
  await page.close();
}

// --- G : état d'onglet sans l'adresse analysée (écrit par une version antérieure) ------------
{
  const page = await context.newPage();
  await page.goto('https://article-exemple.fr/?g');
  await page.waitForTimeout(1500);
  await (await swActuel()).evaluate(async () => {
    const onglets = await chrome.tabs.query({});
    const o = onglets.find((t) => t.url && t.url.includes('?g'));
    await chrome.storage.session.set({ [`verdict:${o.id}`]: { verdict: { niveau: 'N0', motif: 'aucun champ de saisie ni formulaire' }, href: o.url } });
  });
  attendu('G état sans adresse analysée', await popupSur(page, 'G'), ['Site non répertorié par Tourmentin', MESSAGE_RECHARGER]);
  await page.close();
}

// H : about:blank — la popup ne peut pas s'y ouvrir (chrome.action.openPopup échoue), cas non testable.

await context.close();
console.log(`\nCaptures : ${CAPTURES}`);
console.log(echecs === 0 ? 'Tous les contrôles sont conformes.' : `${echecs} contrôle(s) en échec.`);
process.exit(echecs === 0 ? 0 : 1);
