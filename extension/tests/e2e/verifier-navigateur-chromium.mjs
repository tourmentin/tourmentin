// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.48 / 14.49 : le build REMIS (dist/chrome-essai) dans un autre navigateur basé sur Chromium (Brave, boucliers actifs ; Edge de même),
// profil neuf, contre les VRAIES listes de tourmentin.fr. Les pages visitées sont locales (route Playwright) sous le nom d'hôtes réels.
//   TMT_EXECUTABLE=<brave.exe> node tests/e2e/verifier-navigateur-chromium.mjs
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const DIST = process.env.TMT_DIST ?? join(ICI, '..', '..', 'dist', 'chrome-essai');
const EXECUTABLE = process.env.TMT_EXECUTABLE;
if (!EXECUTABLE) throw new Error('TMT_EXECUTABLE requis');
const CAPTURES = process.env.CAPTURES ?? join(tmpdir(), 'tourmentin-captures');
mkdirSync(CAPTURES, { recursive: true });
const PUBLIE = process.env.TMT_SORTIE_ESSAI ?? process.env.TOURMENTIN_DOSSIER_PUBLICATION ?? join(homedir(), 'Tourmentin-publication');
const PORT = 9484;
let echecs = 0;
const verifier = (l, ok, d = '') => { console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${l}${d ? ' — ' + d : ''}`); if (!ok) echecs++; };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const off = JSON.parse(readFileSync(join(PUBLIE, 'officiels.json'), 'utf8'));
const repertories = off.entrees.filter((e) => e.statut === 'repertorie');
const valides = off.entrees.filter((e) => !e.statut);
const hoteRep = repertories.map((e) => e.hote).find((h) => h.startsWith('www.')) ?? repertories[0].hote;
const hoteVal = (valides.find((e) => e.hote.startsWith('www.')) ?? valides[0]).hote;
const PAGE = '<!doctype html><html><head><title>Espace</title></head><body><p>Page locale de l\'essai</p><form><input type="password" name="mdp"></form></body></html>';
const PAGE_N2 = readFileSync(join(ICI, '..', 'pages', 'imitations', '01-impots-gouv.html'), 'utf8');

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tourmentin-chromium-')), {
  executablePath: EXECUTABLE, headless: false,
  // Brave : les listes de blocage des boucliers arrivent par le « component updater » ; Playwright le coupe par défaut, ce qui laisserait les
  // boucliers sans liste. On le laisse actif pour que les boucliers soient réellement actifs.
  ignoreDefaultArgs: process.env.TMT_BRAVE === '1' ? ['--disable-component-update', '--disable-background-networking'] : [],
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--disable-features=DisableLoadExtensionCommandLineSwitch', `--remote-debugging-port=${PORT}`, '--no-first-run'],
});
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 20000 }));
const id = new URL(sw.url()).host;
const man = await sw.evaluate(() => chrome.runtime.getManifest());
console.log(`INFO  navigateur : ${await context.browser()?.version()} ; extension ${man.version} (${man.version_name})`);
verifier('l\'extension se charge (service worker démarré)', /^[a-p]{32}$/.test(id), id);
for (const p of context.pages()) if (p.url().includes('premier-lancement')) await p.close();

// ---- boucliers : preuve qu'ils sont actifs --------------------------------------------------------------------------------------
const nav = await context.newPage();
await nav.goto('https://example.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
const brave = await nav.evaluate(async () => (navigator.brave ? await navigator.brave.isBrave() : false)).catch(() => false);
const testerBlocage = () => nav.evaluate(() => fetch('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', { mode: 'no-cors', cache: 'no-store' }).then(() => 'chargé', () => 'bloqué')).catch(() => 'inconnu');
let bloque = await testerBlocage();
if (process.env.TMT_BRAVE === '1') {
  verifier('Brave : navigator.brave.isBrave() est vrai', brave === true);
  // réglages des boucliers du profil neuf, lus dans brave://settings/shields (les valeurs par défaut de Brave : boucliers actifs)
  const reglages = await (async () => {
    const p = await context.newPage();
    try {
      await p.goto('brave://settings/shields');
      await p.waitForTimeout(3000);
      return await p.evaluate(() => {
        const out = {};
        const visiter = (n) => { if (!n) return; if (n.shadowRoot) visiter(n.shadowRoot); for (const c of n.children ?? []) { if (c.tagName === 'SELECT') out[c.id] = c.options[c.selectedIndex]?.text; visiter(c); } };
        visiter(document.body);
        return out;
      });
    } catch { return {}; } finally { await p.close(); }
  })();
  verifier('boucliers actifs : blocage des traqueurs et publicités, mise à niveau HTTPS, blocage du pistage par empreinte, cookies tiers bloqués (réglages par défaut du profil)',
    /^(Standard|Agressif)$/.test(reglages.adControlType ?? '') && /^(Standard|Strict)$/.test(reglages.fingerprintingSelectControlType ?? '') && /^(Standard|Strict)$/.test(reglages.httpsUpgradeControlType ?? '') && /tiers/i.test(reglages.cookieControlType ?? ''), JSON.stringify(reglages));
  console.log(`INFO  blocage effectif d'une requête publicitaire dans ce profil neuf : ${bloque} (les listes de blocage de Brave arrivent par mise à jour de composant ; non attendu ici)`);
} else console.log(`INFO  boucliers : isBrave=${brave}, requête publicitaire ${bloque}`);
await nav.close();

// ---- listes réelles ----------------------------------------------------------------------------------------------------------------
const lire = () => sw.evaluate(async () => (await chrome.storage.local.get('listes_signees')).listes_signees ?? null);
let etat = null;
for (let i = 0; i < 80 && !etat?.officiels; i++) { etat = await lire(); await attendre(300); }
verifier('les listes signées de tourmentin.fr sont téléchargées et vérifiées (boucliers actifs)', !!etat?.officiels && !!etat?.frauduleux && !etat.rejets?.officiels && !etat.rejets?.frauduleux, `version ${etat?.officiels?.version}, ${etat?.officiels?.entrees.length} hôtes ; rejets ${JSON.stringify(etat?.rejets)}`);

// ---- popup réelle et bandeau ---------------------------------------------------------------------------------------------------------
for (const h of [hoteRep, hoteVal]) await context.route(`https://${h}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
await context.route('https://impots-gouv.fr/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: PAGE_N2 }));
async function statutDe(hote, capture) {
  const page = await context.newPage();
  await page.goto(`https://${hote}/`);
  await page.waitForTimeout(2000);
  const bandeauN2 = (await page.locator('#tourmentin-bandeau-n2').count()) > 0;
  await page.bringToFront();
  const erreur = await sw.evaluate(async () => { try { await chrome.action.openPopup(); return null; } catch (e) { return String(e); } });
  if (erreur) { await page.close(); return { erreur }; }
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let popup = null;
  for (let i = 0; i < 30 && !popup; i++) { popup = cdp.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('/popup.html')) ?? null; if (!popup) await attendre(200); }
  await popup.waitForSelector('#statut', { timeout: 6000 }).catch(() => {});
  await popup.waitForTimeout(500);
  const s = await popup.evaluate(() => { const e = document.getElementById('statut'); return { code: e?.dataset.code ?? null, texte: e?.textContent ?? '', couleur: e ? getComputedStyle(e).backgroundColor : null }; });
  if (capture) await popup.screenshot({ path: join(CAPTURES, capture) });
  await cdp.close().catch(() => {});
  await page.close();
  return { ...s, bandeauN2 };
}
const sVal = await statutDe(hoteVal, 'brave-valide.png');
verifier(`popup : hôte validé (${hoteVal}) : « Site officiel vérifié », vert`, sVal.code === 'officiel-verifie' && sVal.couleur === 'rgb(46, 125, 50)', `${sVal.code} ${sVal.couleur} ${sVal.erreur ?? ''}`);
const sRep = await statutDe(hoteRep, 'brave-repertorie.png');
verifier(`popup : hôte répertorié (${hoteRep}) : vert pâle`, sRep.code === 'repertorie' && sRep.couleur === 'rgb(200, 230, 201)', `${sRep.code} ${sRep.couleur} ${sRep.erreur ?? ''}`);
const sN2 = await statutDe('impots-gouv.fr', 'brave-n2.png');
verifier('imitation : alerte N2 dans la popup ET bandeau N2 dans la page (script de contenu actif)', sN2.code === 'n2-imitation' && sN2.bandeauN2, `${sN2.code} bandeau ${sN2.bandeauN2}`);

// ---- paramètres, compatibilité, erreurs ------------------------------------------------------------------------------------------------
const opt = await context.newPage();
await opt.goto(`chrome-extension://${id}/src/options/options.html`);
await opt.waitForTimeout(1500);
verifier('compatibilité : Ed25519 à clé non exportable en IndexedDB fonctionne', (await opt.locator('#compat-ed25519').getAttribute('data-ok')) === 'true', await opt.locator('#compat-ed25519').textContent());
await opt.locator('input[name="mode-envoi"][value="jamais"]').check();
await opt.waitForFunction(() => document.getElementById('enregistre-mode-envoi')?.textContent === 'Enregistré', null, { timeout: 3000 }).catch(() => {});
verifier('réglage : « Enregistré » affiché', (await opt.locator('#enregistre-mode-envoi').textContent()) === 'Enregistré');
verifier('aucune alerte de service interne', await opt.locator('#alerte-service').isHidden());
const page = await context.newPage();
const erreurs = await (async () => {
  try {
    await page.goto('chrome://extensions/');
    await page.waitForTimeout(800);
    return await page.evaluate(async (idExt) => { const info = await chrome.developerPrivate.getExtensionInfo(idExt); return { runtime: (info.runtimeErrors ?? []).map((e) => e.message), manifest: (info.manifestErrors ?? []).map((e) => e.message) }; }, id);
  } catch (e) { return { indisponible: String(e).slice(0, 120) }; }
})();
verifier('la page d\'erreurs de l\'extension reste vide', !erreurs.indisponible && erreurs.runtime.length === 0 && erreurs.manifest.length === 0, JSON.stringify(erreurs));
await context.close();
console.log(echecs === 0 ? 'Tous les contrôles sont conformes.' : `${echecs} échec(s).`);
process.exit(echecs ? 1 : 0);
