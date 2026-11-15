// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.69 : visuels de la fiche Chrome Web Store, produits avec le VRAI build (dist/chrome-essai) dans un navigateur réel.
//   - icônes 16/32/48/128 px et vignette 440×280, dessinées depuis le logo de site/identite.mjs ;
//   - captures 1280×800 : (1) fenêtre de l'extension sur un site officiel (page réelle + fenêtre réelle de l'extension, assemblées) ;
//     (2) alerte N2 (page d'essai + bandeau réel) ; (3) bandeau de connexion (page d'essai + bandeau réel).
// Aucune saisie dans aucune page. Les pages (2) et (3) sont des pages d'ESSAI locales servies par une route, sans logo ni marque réelle.
//   TMT_EXECUTABLE=<brave.exe> node tests/e2e/fabriquer-visuels-cws.mjs <dossier de sortie>
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..', '..');
const DIST = join(RACINE, 'dist', 'chrome-essai');
const EXE = process.env.TMT_EXECUTABLE;
const SORTIE = process.argv[2];
if (!EXE || !SORTIE) throw new Error('usage : TMT_EXECUTABLE=<exe> node fabriquer-visuels-cws.mjs <dossier>');
mkdirSync(SORTIE, { recursive: true });
const { LOGO_SVG } = await import(pathToFileURL(join(RACINE, '..', 'site', 'identite.mjs')).href);
const SVG = LOGO_SVG.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');

// ---- icônes et vignette (navigateur sans extension) -----------------------------------------------------------------------------------------------------
{
  const nav = await chromium.launch({ executablePath: EXE, headless: true });
  const ctx = await nav.newContext({ deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  for (const t of [16, 32, 48, 128]) {
    await p.setViewportSize({ width: t, height: t });
    // 128 : le dessin occupe 112 px, marge transparente de 8 px (recommandation du Chrome Web Store : 96 px de dessin + 16 de marge ; ici le cercle est plein)
    const dessin = t === 128 ? 112 : t;
    await p.setContent(`<body style="margin:0;background:transparent;display:grid;place-items:center;width:${t}px;height:${t}px"><div style="width:${dessin}px;height:${dessin}px">${SVG.replace('<svg ', `<svg width="${dessin}" height="${dessin}" `)}</div></body>`);
    await p.screenshot({ path: join(SORTIE, `icone-${t}.png`), omitBackground: true });
  }
  await p.setViewportSize({ width: 440, height: 280 });
  await p.setContent(`<body style="margin:0;width:440px;height:280px;background:#13283B;color:#EEF3F4;font-family:Calibri,'Segoe UI',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">
<div style="width:96px;height:96px">${SVG.replace('<svg ', '<svg width="96" height="96" ')}</div>
<div style="font-size:44px;font-weight:700;letter-spacing:.01em">Tourmentin</div>
<div style="font-size:18px;color:#C9DDE3;text-align:center;padding:0 24px">Repère les imitations de sites officiels français</div>
</body>`);
  await p.screenshot({ path: join(SORTIE, 'vignette-440x280.png') });
  await nav.close();
}

// ---- captures 1280×800 (navigateur réel, extension chargée) -----------------------------------------------------------------------------------------------
const PORT = 9577;
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tourmentin-visuels-')), {
  executablePath: EXE,
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, `--remote-debugging-port=${PORT}`, '--window-size=1280,900'],
});
await new Promise((r) => setTimeout(r, 2500));
for (const p of context.pages()) if (p.url().includes('premier-lancement')) await p.close();
const sw = context.serviceWorkers()[0];
await sw.evaluate(async () => { const { reglages = {} } = await chrome.storage.local.get('reglages'); await chrome.storage.local.set({ reglages: { ...reglages, modeEnvoi: 'jamais' } }); });

const PAGE_N2 = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Espace Particulier</title></head>
<body style="font-family:Calibri,'Segoe UI',sans-serif;margin:0;background:#f4f6f8;color:#1b2733">
<header style="background:#fff;border-bottom:1px solid #d7dde3;padding:18px 40px;font-size:22px;font-weight:700">Espace Particulier</header>
<main style="max-width:420px;margin:60px auto;background:#fff;padding:32px;border:1px solid #d7dde3;border-radius:6px">
<h1 style="font-size:22px;margin:0 0 8px">Connexion à votre espace</h1><p style="color:#4F606C">DGFiP — avis d'imposition, taxe d'habitation, prélèvement à la source.</p>
<form action="#"><label for="id">Numéro fiscal</label><br><input id="id" name="identifiant" style="width:100%;margin:6px 0 14px;padding:8px"><br><label for="mdp">Mot de passe</label><br><input id="mdp" type="password" name="mdp" style="width:100%;margin:6px 0 14px;padding:8px"><br><button type="button" style="padding:10px 18px">Se connecter</button></form></main></body></html>`;
const PAGE_CONNEXION = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Espace membres</title></head>
<body style="font-family:Calibri,'Segoe UI',sans-serif;margin:0;background:#f4f6f8;color:#1b2733">
<header style="background:#fff;border-bottom:1px solid #d7dde3;padding:18px 40px;font-size:22px;font-weight:700">Association Les Amis du Lac</header>
<main style="max-width:420px;margin:60px auto;background:#fff;padding:32px;border:1px solid #d7dde3;border-radius:6px">
<h1 style="font-size:22px;margin:0 0 8px">Espace membres</h1><p style="color:#4F606C">Connectez-vous pour accéder à votre espace.</p>
<form action="#"><label for="id">Adresse e-mail</label><br><input id="id" name="email" style="width:100%;margin:6px 0 14px;padding:8px"><br><label for="mdp">Mot de passe</label><br><input id="mdp" type="password" name="mdp" style="width:100%;margin:6px 0 14px;padding:8px"><br><button type="button" style="padding:10px 18px">Se connecter</button></form></main></body></html>`;
await context.route('https://impots-gouv.fr/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGE_N2 }));
await context.route('https://espace-membres-exemple.fr/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGE_CONNEXION }));

async function ouvrirPopup(page) {
  await page.bringToFront();
  const erreur = await sw.evaluate(async () => { try { await chrome.action.openPopup(); return null; } catch (e) { return String(e); } });
  if (erreur) throw new Error(erreur);
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let popup = null;
  for (let i = 0; i < 30 && !popup; i++) {
    popup = cdp.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('/popup.html')) ?? null;
    if (!popup) await new Promise((r) => setTimeout(r, 200));
  }
  if (!popup) throw new Error('popup absente');
  await popup.waitForSelector('#statut, #contenu', { timeout: 5000 }).catch(() => {});
  await popup.waitForTimeout(600);
  return { popup, cdp };
}

// (1) site officiel : page réelle ; si elle ne s'ouvre pas, page factice sous le vrai nom d'hôte, DITE telle dans la sortie
const URL_OFFICIEL = 'https://www.service-public.fr/';
const p1 = await context.newPage();
let reel = true;
try {
  await p1.goto(URL_OFFICIEL, { waitUntil: 'domcontentloaded', timeout: 20000 });
} catch {
  reel = false;
}
await p1.waitForTimeout(2500);
// Bandeau de cookies du site : on choisit « Refuser » (le choix le plus protecteur) ; puis on fait défiler pour ne montrer ni photo de personne ni bandeau.
await p1.getByRole('button', { name: 'Refuser' }).first().click({ timeout: 4000 }).catch(() => console.log('bandeau de cookies : bouton « Refuser » introuvable'));
await p1.evaluate(() => window.scrollTo(0, 640));
await p1.waitForTimeout(800);
console.log(reel ? `site officiel : page réelle ${URL_OFFICIEL}` : 'site officiel : la page réelle ne s\'est pas ouverte');
const fond = await p1.screenshot({ type: 'png' });
const { popup: pop1, cdp: cdp1 } = await ouvrirPopup(p1);
const statut1 = await pop1.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
console.log('popup (1) :', statut1);
const imgPopup = await pop1.screenshot({ type: 'png' });
await cdp1.close().catch(() => {});
await p1.close();
const assembler = await context.newPage();
await assembler.setViewportSize({ width: 1280, height: 800 });
await assembler.setContent(`<body style="margin:0;width:1280px;height:800px;position:relative;overflow:hidden;background:#fff"><img src="data:image/png;base64,${fond.toString('base64')}" style="position:absolute;left:0;top:0;width:1280px;height:800px"><img src="data:image/png;base64,${imgPopup.toString('base64')}" style="position:absolute;right:28px;top:20px;box-shadow:0 8px 28px rgba(0,0,0,.35);border-radius:8px"></body>`);
await assembler.screenshot({ path: join(SORTIE, 'capture-1-site-officiel-1280x800.png') });
await assembler.close();

// (2) alerte N2 : bandeau réel dans la page
const p2 = await context.newPage();
await p2.goto('https://impots-gouv.fr/connexion');
await p2.waitForTimeout(2500);
await p2.screenshot({ path: join(SORTIE, 'capture-2-alerte-n2-1280x800.png') });
const { popup: pop2, cdp: cdp2 } = await ouvrirPopup(p2);
console.log('popup (2) :', await pop2.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim()));
await cdp2.close().catch(() => {});
await p2.close();

// (3) bandeau de connexion : page de connexion inconnue
const p3 = await context.newPage();
await p3.goto('https://espace-membres-exemple.fr/connexion');
await p3.waitForTimeout(2500);
await p3.screenshot({ path: join(SORTIE, 'capture-3-bandeau-connexion-1280x800.png') });
await p3.close();
await context.close();
writeFileSync(join(SORTIE, 'LISEZ-MOI.txt'), 'Visuels produits par extension/tests/e2e/fabriquer-visuels-cws.mjs avec le build dist/chrome-essai (14.69).\n');
console.log('visuels écrits dans', SORTIE);
