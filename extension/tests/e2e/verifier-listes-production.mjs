// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.42, 14.46 : le build REMIS (dist/chrome-essai) dans un vrai navigateur, profil neuf, contre les VRAIES listes servies par
// https://tourmentin.fr/listes/ : il les télécharge, les vérifie avec la clé publique du dépôt et les applique ; puis la vraie popup
// montre « Site officiel vérifié » (vert) pour un hôte validé et « Site répertorié par Tourmentin (source publique) » (vert pâle) pour un
// hôte répertorié. Les pages visitées sont des pages locales sous le nom de l'hôte (route Playwright) : aucune requête vers ces sites.
// Les attendus sont lus dans les fichiers signés par Ph (dossier Tourmentin-publication de l'utilisateur, ou TOURMENTIN_DOSSIER_PUBLICATION), jamais écrits en dur.
//   npm run build:chrome && node tests/e2e/verifier-listes-production.mjs
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const DIST = join(ICI, '..', '..', 'dist', 'chrome-essai');
const CAPTURES = process.env.CAPTURES ?? join(tmpdir(), 'tourmentin-captures');
mkdirSync(CAPTURES, { recursive: true });
const PUBLIE = process.env.TMT_SORTIE_ESSAI ?? process.env.TOURMENTIN_DOSSIER_PUBLICATION ?? join(homedir(), 'Tourmentin-publication');
const PORT = 9483;
let echecs = 0;
const verifier = (l, ok, d = '') => { console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${l}${d ? ' — ' + d : ''}`); if (!ok) echecs++; };

const off = JSON.parse(readFileSync(join(PUBLIE, 'officiels.json'), 'utf8'));
const fra = JSON.parse(readFileSync(join(PUBLIE, 'frauduleux.json'), 'utf8'));
const repertories = off.entrees.filter((e) => e.statut === 'repertorie');
const valides = off.entrees.filter((e) => !e.statut);
const hoteRep = repertories.map((e) => e.hote).find((h) => h.startsWith('www.')) ?? repertories[0].hote;
const hoteVal = (valides.find((e) => e.hote.startsWith('www.')) ?? valides[0]).hote;

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tourmentin-prod-')), {
  channel: 'chromium', headless: false, args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, `--remote-debugging-port=${PORT}`],
});
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const lire = () => sw.evaluate(async () => (await chrome.storage.local.get('listes_signees')).listes_signees ?? null);
let etat = null;
for (let i = 0; i < 80; i++) {
  etat = await lire();
  if (etat?.officiels && etat?.frauduleux) break;
  await new Promise((r) => setTimeout(r, 300));
}
verifier('les deux listes sont téléchargées, vérifiées et appliquées par l\'extension installée', !!etat?.officiels && !!etat?.frauduleux);
verifier(`versions des fichiers signés par Ph (officiels ${off.version}, frauduleux ${fra.version})`, etat?.officiels?.version === off.version && etat?.frauduleux?.version === fra.version, `${etat?.officiels?.version} / ${etat?.frauduleux?.version}`);
verifier(`${off.entrees.length} entrées officiels dont ${repertories.length} répertoriées et ${valides.length} validées ; ${fra.entrees.length} frauduleux`, etat?.officiels?.entrees.length === off.entrees.length && etat.officiels.entrees.filter((e) => e.statut === 'repertorie').length === repertories.length && etat.frauduleux.entrees.length === fra.entrees.length);
verifier('aucun problème consigné (plus de 404, signature valide)', !etat?.rejets || Object.keys(etat.rejets).length === 0, JSON.stringify(etat?.rejets));
const alarmes = await sw.evaluate(async () => (await chrome.alarms.getAll()).map((a) => `${a.name}/${a.periodInMinutes}`));
verifier('alarme horaire en place', alarmes.includes('listes-signees/60'), alarmes.join(','));

// ---- la vraie popup, sur des pages locales portant le nom des hôtes réels ----------------------------------------------------
const PAGE = '<!doctype html><html><head><title>Espace</title></head><body><p>Page locale de l\'essai</p><form><input type="password" name="mdp"></form></body></html>';
for (const h of [hoteRep, hoteVal]) await context.route(`https://${h}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
async function statutDe(hote, capture) {
  const page = await context.newPage();
  await page.goto(`https://${hote}/`);
  await page.waitForTimeout(2000);
  await page.bringToFront();
  const erreur = await sw.evaluate(async () => { try { await chrome.action.openPopup(); return null; } catch (e) { return String(e); } });
  if (erreur) { await page.close(); return { erreur }; }
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let popup = null;
  for (let i = 0; i < 30 && !popup; i++) { popup = cdp.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('/popup.html')) ?? null; if (!popup) await new Promise((r) => setTimeout(r, 200)); }
  await popup.waitForSelector('#statut', { timeout: 6000 }).catch(() => {});
  await popup.waitForTimeout(500);
  const s = await popup.evaluate(() => { const e = document.getElementById('statut'); return { code: e?.dataset.code ?? null, texte: e?.textContent ?? '', couleur: e ? getComputedStyle(e).backgroundColor : null }; });
  if (capture) await popup.screenshot({ path: join(CAPTURES, capture) });
  await cdp.close().catch(() => {});
  await page.close();
  return s;
}
const sVal = await statutDe(hoteVal, 'listes-production-valide.png');
verifier(`popup réelle : hôte validé par Ph (${hoteVal}) : « Site officiel vérifié », vert`, sVal.code === 'officiel-verifie' && /^Site officiel vérifié/.test(sVal.texte) && sVal.couleur === 'rgb(46, 125, 50)', `${sVal.code} « ${sVal.texte} » ${sVal.couleur}`);
const sRep = await statutDe(hoteRep, 'listes-production-repertorie.png');
verifier(`popup réelle : hôte répertorié (${hoteRep}) : « Site répertorié par Tourmentin (source publique) », vert pâle`, sRep.code === 'repertorie' && sRep.texte === 'Site répertorié par Tourmentin (source publique)' && sRep.couleur === 'rgb(200, 230, 201)', `${sRep.code} « ${sRep.texte} » ${sRep.couleur}`);

const page = await context.newPage();
await page.goto(`chrome-extension://${new URL(sw.url()).host}/src/options/options.html`);
await page.waitForTimeout(800);
const texte = await page.locator('#etat-listes').textContent();
verifier('page des paramètres : état des listes lisible', new RegExp(`officiels : version ${off.version.replaceAll('.', '\\.')}, ${off.entrees.length} hôte\\(s\\) \\(dont ${repertories.length} répertoriés\\)`).test(texte ?? ''), texte ?? '');
await context.close();
console.log(echecs === 0 ? 'Tous les contrôles sont conformes.' : `${echecs} échec(s).`);
process.exit(echecs ? 1 : 0);
