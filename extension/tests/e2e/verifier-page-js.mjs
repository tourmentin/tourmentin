// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.72 : une imitation construite par JavaScript APRÈS le chargement (page vide au départ) est-elle détectée ? Navigateur réel, vrai build, pages locales
// servies par route sous un faux nom d'hôte. Aucune saisie. Lecture du statut par la vraie fenêtre de l'extension.
//   TMT_EXECUTABLE=<brave.exe> node tests/e2e/verifier-page-js.mjs
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ICI = dirname(fileURLToPath(import.meta.url));
const DIST = join(ICI, '..', '..', 'dist', 'chrome-essai');
const EXE = process.env.TMT_EXECUTABLE; const PORT = 9588; let echecs = 0;
const verifier = (l, ok, d = '') => { console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${l}${d ? ' — ' + d : ''}`); if (!ok) echecs++; };
const CORPS = "<h1>Espace Particulier</h1><p>DGFiP — avis d'imposition, taxe d'habitation, prélèvement à la source</p><form action='#'><label for='i'>Numéro fiscal</label><input id='i' name='identifiant'><label for='m'>Mot de passe</label><input id='m' type='password' name='mdp'></form>";
const page = (script) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Espace Particulier</title></head><body><div id="racine"></div><script>${script}</script></body></html>`;
const CAS = {
  'js-immediat.impots-gouv.fr': page(`document.getElementById('racine').innerHTML=${JSON.stringify(CORPS)}`),
  'js-apres-3s.impots-gouv.fr': page(`setTimeout(()=>{document.getElementById('racine').innerHTML=${JSON.stringify(CORPS)}},3000)`),
  'js-apres-9s.impots-gouv.fr': page(`setTimeout(()=>{document.getElementById('racine').innerHTML=${JSON.stringify(CORPS)}},9000)`),
  'js-shadow-ouvert.impots-gouv.fr': page(`const h=document.getElementById('racine');const s=h.attachShadow({mode:'open'});setTimeout(()=>{s.innerHTML=${JSON.stringify(CORPS)}},1500)`),
  'js-shadow-immediat.impots-gouv.fr': page(`const h=document.getElementById('racine');const s=h.attachShadow({mode:'open'});s.innerHTML=${JSON.stringify(CORPS)}`),
  'js-shadow-ferme.impots-gouv.fr': page(`const h=document.getElementById('racine');const s=h.attachShadow({mode:'closed'});setTimeout(()=>{s.innerHTML=${JSON.stringify(CORPS)}},1500)`),
  'js-shadow-tardif.impots-gouv.fr': page(`setTimeout(()=>{const s=document.getElementById('racine').attachShadow({mode:'open'});s.innerHTML=${JSON.stringify(CORPS)}},3500)`),
  'js-shadow-imbrique.impots-gouv.fr': page(`const h=document.getElementById('racine');const s=h.attachShadow({mode:'open'});const d=document.createElement('div');s.appendChild(d);setTimeout(()=>{d.attachShadow({mode:'open'}).innerHTML=${JSON.stringify(CORPS)}},2500)`),
  'js-iframe-srcdoc.impots-gouv.fr': page(`setTimeout(()=>{const f=document.createElement('iframe');f.srcdoc=${JSON.stringify('<!doctype html><title>x</title>' + CORPS)};document.getElementById('racine').appendChild(f)},1500)`),
};
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tmt-js-')), { executablePath: EXE, headless: false, args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, `--remote-debugging-port=${PORT}`] });
await new Promise((r) => setTimeout(r, 2500));
for (const p of context.pages()) if (p.url().includes('premier-lancement')) await p.close();
const sw = context.serviceWorkers()[0];
await sw.evaluate(async () => { await chrome.storage.local.set({ reglages: { modeEnvoi: 'jamais' } }); });
for (const [hote, corps] of Object.entries(CAS)) await context.route(`https://${hote}/**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: corps }));
async function statut(page) {
  await page.bringToFront();
  const e = await sw.evaluate(async () => { try { await chrome.action.openPopup(); return null; } catch (x) { return String(x); } });
  if (e) return 'erreur popup ' + e;
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let pop = null;
  for (let i = 0; i < 30 && !pop; i++) { pop = cdp.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('/popup.html')) ?? null; if (!pop) await new Promise((r) => setTimeout(r, 200)); }
  await pop.waitForTimeout(700);
  const t = (await pop.evaluate(() => document.getElementById('statut')?.dataset.code ?? document.body.innerText)).trim();
  await cdp.close().catch(() => {});
  return t;
}
for (const hote of Object.keys(CAS)) {
  const p = await context.newPage();
  await p.goto(`https://${hote}/`);
  const attente = hote.includes('9s') ? 11000 : hote.includes('tardif') ? 9000 : 5500;
  await p.waitForTimeout(attente);
  const s = await statut(p);
  verifier(`${hote} : imitation construite par JavaScript`, s === 'n2-imitation' || s === 'n1-ressemble', `statut : ${s}`);
  await p.close();
}
await context.close();
console.log(echecs ? `${echecs} échec(s)` : 'Tous les contrôles sont conformes.');
process.exit(echecs ? 1 : 0);
