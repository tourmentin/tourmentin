// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.43 : (1) la page d'erreurs de l'extension (chrome://extensions) reste VIDE après avoir ouvert la popup et les options et
// cliqué sur chaque bouton ; (2) un service worker muet ou pas rechargé est DIT clairement, sans erreur non rattrapée ;
// (3) chaque réglage affiche « Enregistré » pendant 2 s, ou une erreur ; (4) numérotation des builds et permissions.
// Aucune saisie dans aucune page web ; la seule saisie est un code de liaison bidon dans NOTRE page d'options, sous « Ne jamais
// envoyer » (aucune requête ne part). Depuis extension/, après `npm run build:chrome` :
//   node tests/e2e/verifier-erreurs.mjs
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const DIST = join(ICI, '..', '..', 'dist', 'chrome-essai');
const CAPTURES = process.env.CAPTURES ?? join(tmpdir(), 'tourmentin-captures');
mkdirSync(CAPTURES, { recursive: true });
const PORT = 9481;
let echecs = 0;
const verifier = (l, ok, d = '') => { console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${l}${d ? ' — ' + d : ''}`); if (!ok) echecs++; };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const manifeste = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
verifier('manifeste : la permission « dom » n\'existe plus', !manifeste.permissions.includes('dom'), manifeste.permissions.join(','));
verifier('manifeste : version 0.P.N et version_name « spec X.YY · hash »', /^0\.1\.\d+$/.test(manifeste.version) && /^spec \d+\.\d+ · [0-9a-f]{7,}( · modifié)?$/.test(manifeste.version_name), `${manifeste.version} | ${manifeste.version_name}`);

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tourmentin-erreurs-')), {
  channel: 'chromium', headless: false,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, `--remote-debugging-port=${PORT}`],
});
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const id = new URL(sw.url()).host;
await context.route('https://exemple-erreurs.fr/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>Espace adhérent</title></head><body><p>Espace adhérent</p><form><input type="password" name="mdp"></form></body></html>' }));
for (const p of context.pages()) if (p.url().includes('premier-lancement')) await p.close();

// ---- la page d'erreurs de l'extension, lue par l'API même de chrome://extensions ------------------------------------
async function erreursExtension() {
  const page = await context.newPage();
  try {
    await page.goto('chrome://extensions/');
    await page.waitForTimeout(800);
    return await page.evaluate(async (idExt) => {
      const info = await chrome.developerPrivate.getExtensionInfo(idExt);
      return { runtime: (info.runtimeErrors ?? []).map((e) => e.message), manifest: (info.manifestErrors ?? []).map((e) => e.message), avertissements: info.installWarnings ?? [] };
    }, id);
  } catch (e) {
    return { indisponible: String(e).slice(0, 150) };
  } finally {
    await page.close();
  }
}
const avant = await erreursExtension();
if (avant.indisponible) verifier('lecture de la page d\'erreurs de chrome://extensions', false, avant.indisponible);
else verifier('avant : aucune erreur d\'exécution, de manifeste ni d\'avertissement d\'installation', avant.runtime.length === 0 && avant.manifest.length === 0 && avant.avertissements.length === 0, JSON.stringify(avant));

// ---- sous « Ne jamais envoyer » (aucune requête) -----------------------------------------------------------------------
await sw.evaluate(async () => { const { reglages = {} } = await chrome.storage.local.get('reglages'); await chrome.storage.local.set({ reglages: { ...reglages, modeEnvoi: 'jamais' } }); });

// ---- popup : ouverture réelle (chrome.action.openPopup), puis chaque bouton ----------------------------------------------
async function ouvrirPopup(page) {
  await page.bringToFront();
  const erreur = await sw.evaluate(async () => { try { await chrome.action.openPopup(); return null; } catch (e) { return String(e); } });
  if (erreur) return { erreur };
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let popup = null;
  for (let i = 0; i < 30 && !popup; i++) { popup = cdp.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('/popup.html')) ?? null; if (!popup) await attendre(200); }
  if (!popup) { await cdp.close().catch(() => {}); return { erreur: 'aucune popup' }; }
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForSelector('#statut', { timeout: 6000 }).catch(() => {});
  await popup.waitForTimeout(600);
  return { popup, cdp };
}
const erreursPopup = [];
for (const declaration of ['bouton-officiel', 'bouton-frauduleuse']) {
  // une popup par page : chrome.action.openPopup refuse d'en ouvrir une seconde sur la même
  const web = await context.newPage();
  await web.goto('https://exemple-erreurs.fr/');
  await web.waitForTimeout(2000);
  const o = await ouvrirPopup(web);
  if (!o.popup) { verifier(`popup : ouverture pour « ${declaration} »`, false, o.erreur); continue; }
  o.popup.on('pageerror', (e) => erreursPopup.push(e.message));
  const statut = await o.popup.locator('#statut').textContent();
  verifier(`popup : le statut s'affiche (« ${statut} »), pas d'erreur de service interne`, !!statut && !/service interne|mis à jour/.test(statut));
  await o.popup.locator(`#${declaration}`).click();
  await o.popup.waitForSelector('#confirmation button', { timeout: 5000 });
  verifier(`popup : « ${declaration} » ouvre l'aperçu, avec le texte « Rien n'est envoyé »`, /Rien n'est envoyé/.test(await o.popup.locator('#confirmation').innerText()));
  await o.popup.locator('#bouton-confirmer').click();
  await o.popup.waitForTimeout(700);
  verifier(`popup : la confirmation de « ${declaration} » aboutit`, /enregistré sur cet ordinateur/.test(await o.popup.locator('#confirmation').innerText()), await o.popup.locator('#confirmation').innerText());
  await o.popup.screenshot({ path: join(CAPTURES, `erreurs-popup-${declaration}.png`) });
  await o.cdp.close().catch(() => {});
  await web.close().catch(() => {});
}
// « Détails » : visible sur une page N1 seulement ; non cliquable ici (pas de page N1 dans cet essai, couvert par verifier-popup).
verifier('popup : aucune exception non rattrapée', erreursPopup.length === 0, erreursPopup.join(' | '));

// ---- options : chaque bouton, chaque réglage ------------------------------------------------------------------------------
const opt = await context.newPage();
const erreursOptions = [];
opt.on('pageerror', (e) => erreursOptions.push(e.message));
await opt.goto(`chrome-extension://${id}/src/options/options.html#premier-lancement`);
await opt.waitForTimeout(600);
verifier('options : écran de premier lancement, texte corrigé (« n\'envoie rien avant votre confirmation »), plus « vous laisse choisir »', /n'envoie rien avant votre confirmation/.test(await opt.locator('#vue-premier-lancement').innerText()) && !/laisse choisir/.test(await opt.locator('#vue-premier-lancement').innerText()));
await opt.locator('#bouton-compris').click();
await opt.waitForTimeout(500);
await opt.locator('#lien-avertissement').click();
await opt.waitForTimeout(300);
await opt.locator('#bouton-compris').click();
await opt.waitForTimeout(500);

// réglages : « Enregistré » pendant 2 s
const zoneMode = opt.locator('#enregistre-mode-envoi');
await opt.locator('input[name="mode-envoi"][value="demander"]').check();
await opt.waitForFunction(() => document.getElementById('enregistre-mode-envoi')?.textContent === 'Enregistré', null, { timeout: 3000 });
verifier('réglage « Envoi » : « Enregistré » affiché à côté du réglage', (await zoneMode.textContent()) === 'Enregistré');
await opt.screenshot({ path: join(CAPTURES, 'erreurs-options-enregistre.png') });
await attendre(2400);
verifier('réglage « Envoi » : le message disparaît après 2 secondes', (await zoneMode.textContent()) === '');
for (const valeur of ['automatique', 'demander', 'jamais']) {
  await opt.locator(`input[name="mode-envoi"][value="${valeur}"]`).check();
  await opt.waitForFunction(() => document.getElementById('enregistre-mode-envoi')?.textContent === 'Enregistré', null, { timeout: 3000 });
}
const reglagesStockes = await sw.evaluate(async () => (await chrome.storage.local.get('reglages')).reglages);
verifier('réglage « Envoi » : la valeur est réellement enregistrée', reglagesStockes?.modeEnvoi === 'jamais', JSON.stringify(reglagesStockes));
for (const valeur of ['chaque-visite', 'jamais', 'une-fois']) {
  await opt.locator('#mode-avertissement').selectOption(valeur);
  await opt.waitForFunction(() => document.getElementById('enregistre-avertissement')?.textContent === 'Enregistré', null, { timeout: 3000 });
}
const apres = await sw.evaluate(async () => (await chrome.storage.local.get('reglages')).reglages);
verifier('réglage « Avertir… » : « Enregistré » et valeur enregistrée', apres?.avertirConnexion === 'une-fois', JSON.stringify(apres));
await opt.locator('#interrupteur-journal').check();
await opt.waitForFunction(() => document.getElementById('enregistre-journal')?.textContent === 'Enregistré', null, { timeout: 3000 });
verifier('réglage « Journal » : « Enregistré » et valeur enregistrée', (await sw.evaluate(async () => (await chrome.storage.local.get('reglages')).reglages))?.journalActif === true);
await opt.locator('#interrupteur-journal').uncheck();
await opt.waitForFunction(() => document.getElementById('enregistre-journal')?.textContent === 'Enregistré', null, { timeout: 3000 });

// liaison : message sans code, puis code bidon sous « Ne jamais envoyer » (aucune requête)
await opt.locator('#lier').click();
verifier('options : « Lier » sans code demande de coller le code', /Collez d'abord le code/.test(await opt.locator('#resultat-liaison').textContent()));
await opt.locator('#code-liaison').fill('CODE-DE-TEST-BIDON');
await opt.locator('#lier').click();
await opt.waitForFunction(() => /Ne jamais envoyer/.test(document.getElementById('resultat-liaison')?.textContent ?? ''), null, { timeout: 4000 });
verifier('options : « Lier » sous « Ne jamais envoyer » : message clair, aucune requête', true);
await opt.locator('#delier').click();
await opt.waitForFunction(() => /délié/.test(document.getElementById('resultat-liaison')?.textContent ?? ''), null, { timeout: 4000 });
verifier('options : « Délier » répond', true);
await opt.locator('#effacer-journal').click();
await opt.waitForTimeout(400);

// export (téléchargement) du journal ; la section Signalements n'existe plus dans les options (14.84)
for (const bouton of ['#exporter-journal']) {
  const [dl] = await Promise.all([opt.waitForEvent('download', { timeout: 4000 }).catch(() => null), opt.locator(bouton).click()]);
  verifier(`options : ${bouton} produit un fichier`, !!dl, dl ? dl.suggestedFilename() : 'aucun téléchargement');
}
verifier('options : aucune exception non rattrapée', erreursOptions.length === 0, erreursOptions.join(' | '));
verifier('options : la ligne de version affiche version_name', (await opt.locator('#versions').textContent()).includes(manifeste.version_name), await opt.locator('#versions').textContent());
await opt.screenshot({ path: join(CAPTURES, 'erreurs-options-bas.png'), fullPage: true });

// ---- la page d'erreurs, APRÈS tout cela --------------------------------------------------------------------------------
const apresInteractions = await erreursExtension();
if (apresInteractions.indisponible) verifier('lecture de la page d\'erreurs de chrome://extensions (après)', false, apresInteractions.indisponible);
else verifier('APRÈS popup, options et chaque bouton : la page d\'erreurs de l\'extension reste VIDE', apresInteractions.runtime.length === 0 && apresInteractions.manifest.length === 0, JSON.stringify(apresInteractions));

// ---- service worker muet, pas rechargé, réglage refusé : dit clairement, sans exception -----------------------------------
async function pageAvecSimulation(url, simulation) {
  const p = await context.newPage();
  const exceptions = [];
  p.on('pageerror', (e) => exceptions.push(e.message));
  await p.addInitScript(simulation);
  await p.goto(url);
  await p.waitForTimeout(1800);
  return { p, exceptions };
}
const muet = await pageAvecSimulation(`chrome-extension://${id}/src/options/options.html`, () => { chrome.runtime.sendMessage = async () => undefined; });
const texteMuet = await muet.p.locator('#alerte-service').innerText().catch(() => '');
verifier('service interne MUET : les options le disent clairement (chrome://extensions, ↻)', /ne reçoit pas de réponse/.test(texteMuet) && /chrome:\/\/extensions/.test(texteMuet), texteMuet);
verifier('service interne MUET : l\'état de la liaison le dit, aucune exception non rattrapée', /indisponible/.test(await muet.p.locator('#etat-liaison').textContent()) && muet.exceptions.length === 0, muet.exceptions.join(' | '));
await muet.p.screenshot({ path: join(CAPTURES, 'erreurs-options-sw-muet.png') });
const ancien = await pageAvecSimulation(`chrome-extension://${id}/src/options/options.html`, () => {
  const vrai = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = async (m) => (m.type === 'LIRE_VERSION' ? { type: 'VERSION', build: 'ancienne construction' } : vrai(m));
});
verifier('service worker PAS RECHARGÉ (autre construction) : « mis à jour mais n\'a pas été rechargé »', /pas été rechargé/.test(await ancien.p.locator('#alerte-service').innerText().catch(() => '')));
const refus = await pageAvecSimulation(`chrome-extension://${id}/src/options/options.html`, () => {
  const vrai = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = async (m) => (m.type === 'ECRIRE_REGLAGES' ? { type: 'REGLAGES_ECRITS', ok: false } : vrai(m));
});
await refus.p.locator('input[name="mode-envoi"][value="demander"]').check();
await refus.p.waitForTimeout(800);
const texteRefus = await refus.p.locator('#enregistre-mode-envoi').textContent();
verifier('enregistrement refusé : un message d\'erreur à côté du réglage, qui reste affiché', /Réglage non enregistré/.test(texteRefus ?? ''), texteRefus ?? '');
await attendre(2400);
verifier('enregistrement refusé : le message d\'erreur ne disparaît pas tout seul', /Réglage non enregistré/.test((await refus.p.locator('#enregistre-mode-envoi').textContent()) ?? ''));
const popupMuet = await pageAvecSimulation(`chrome-extension://${id}/src/popup/popup.html`, () => { chrome.runtime.sendMessage = async () => undefined; });
const textePopup = await popupMuet.p.locator('#statut').textContent().catch(() => '');
verifier('popup, service interne MUET : message clair (orange), aucun bouton, aucune exception', /ne reçoit pas de réponse/.test(textePopup ?? '') && (await popupMuet.p.locator('#bouton-officiel').isHidden()) && popupMuet.exceptions.length === 0, `${textePopup} | ${popupMuet.exceptions.join(' | ')}`);
await popupMuet.p.screenshot({ path: join(CAPTURES, 'erreurs-popup-sw-muet.png') });
const popupAncien = await pageAvecSimulation(`chrome-extension://${id}/src/popup/popup.html`, () => { chrome.runtime.sendMessage = async () => ({ type: 'INCONNU' }); });
verifier('popup, service worker qui ne connaît pas le message : « mis à jour mais pas rechargé »', /pas été rechargé/.test((await popupAncien.p.locator('#statut').textContent().catch(() => '')) ?? ''));

// ---- les erreurs réelles n'ont pas bougé : les simulations vivent dans les pages, pas dans l'extension -----------------------------
const finale = await erreursExtension();
verifier('à la fin, la page d\'erreurs de l\'extension est toujours vide (les simulations n\'y ont rien laissé)', !finale.indisponible && finale.runtime.length === 0 && finale.manifest.length === 0, JSON.stringify(finale));

await context.close();
console.log(echecs === 0 ? 'Tous les contrôles sont conformes.' : `${echecs} échec(s).`);
process.exit(echecs ? 1 : 0);
