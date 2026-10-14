// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.57 : la mémoire d'imitation entre les pages d'un même hôte, en navigateur réel (Chromium/Brave, extension chargée depuis dist/chrome-essai), profil neuf.
//   TMT_EXECUTABLE=<brave.exe> node tests/e2e/verifier-deux-etapes.mjs
// Les pages sont servies par une route Playwright sous des noms d'hôte d'essai (aucune requête réelle) ; aucune saisie, aucun envoi.
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const DIST = process.env.TMT_DIST ?? join(ICI, '..', '..', 'dist', 'chrome-essai');
const EXE = process.env.TMT_EXECUTABLE;
if (!EXE) throw new Error('TMT_EXECUTABLE requis');
const PORT = 9488;
let echecs = 0;
const verifier = (l, ok, d = '') => { console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${l}${d ? ' — ' + d : ''}`); if (!ok) echecs++; };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const CONTENU_MARQUE = "Votre espace particulier — déclarer mes revenus, gérer mon prélèvement à la source, DGFiP, avis d'imposition, taxe d'habitation";
const page = (corps, titre = 'Page') => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${titre}</title></head><body style="font-family:sans-serif;max-width:420px;margin:40px auto">${corps}</body></html>`;
const ECRAN1 = page(`<h1>Espace Particulier</h1><p>${CONTENU_MARQUE}</p><form action="#"><label for="id">Numéro fiscal</label><br><input id="id" type="text" name="identifiant" autocomplete="username"><br><button type="submit">Continuer</button></form>`, 'Espace Particulier');
const ECRAN2 = page('<h1>Connexion</h1><p>Saisissez votre mot de passe</p><form action="#"><label for="mdp">Mot de passe</label><br><input id="mdp" type="password" name="mdp" autocomplete="current-password"><br><button type="submit">Se connecter</button></form>', 'Connexion');

const profil = mkdtempSync(join(tmpdir(), 'tourmentin-deux-etapes-'));
async function lancer() {
  const context = await chromium.launchPersistentContext(profil, {
    executablePath: EXE, headless: false,
    ignoreDefaultArgs: process.env.TMT_BRAVE === '1' ? ['--disable-component-update', '--disable-background-networking'] : [],
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--disable-features=DisableLoadExtensionCommandLineSwitch', `--remote-debugging-port=${PORT}`, '--no-first-run'],
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 20000 }));
  for (const p of context.pages()) if (p.url().includes('premier-lancement')) await p.close();
  // chemins d'essai : /etape1 = écran d'identifiant imitant la marque ; /etape2 = écran de mot de passe dépouillé
  await context.route(/^https:\/\/(?:[a-z0-9-]+\.)*(?:acces-fiscal-securise|impots-gouv)\.fr\//, (route) => {
    const chemin = new URL(route.request().url()).pathname;
    route.fulfill({ status: 200, contentType: 'text/html', body: chemin.startsWith('/etape1') ? ECRAN1 : ECRAN2 });
  });
  return { context, sw };
}

async function statutDe(context, sw, url) {
  const p = await context.newPage();
  await p.goto(url);
  await p.waitForTimeout(2200);
  const bandeau = (await p.locator('#tourmentin-bandeau-n2').count()) > 0;
  await p.bringToFront();
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
  const badge = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  const err = await sw.evaluate(async () => { try { await chrome.action.openPopup(); return null; } catch (e) { return String(e); } });
  let s = { code: null, texte: '', erreur: err };
  if (!err) {
    const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    let popup = null;
    for (let i = 0; i < 30 && !popup; i++) { popup = cdp.contexts().flatMap((c) => c.pages()).find((q) => q.url().includes('/popup.html')) ?? null; if (!popup) await attendre(200); }
    await popup?.waitForSelector('#statut', { timeout: 6000 }).catch(() => {});
    await popup?.waitForTimeout(500);
    const lu = popup ? await popup.evaluate(() => { const e = document.getElementById('statut'); return { code: e?.dataset.code ?? null, texte: e?.textContent?.trim() ?? '' }; }) : s;
    s = { ...lu, erreur: null };
    await cdp.close().catch(() => {});
  }
  await p.close();
  return { ...s, badge, bandeau };
}
const lireMemoire = (sw) => sw.evaluate(async () => (await chrome.storage.session.get('memoireImitation')).memoireImitation ?? null);
const alerte = (s) => /^n[12]-/.test(s.code ?? '') && s.badge !== '';

// ---- 1. hôte au nom neutre : le parcours en deux étapes --------------------------------------------------------------------------------
let { context, sw } = await lancer();
const H = 'https://acces-fiscal-securise.fr';
const temoin = await statutDe(context, sw, `${H}/etape2?temoin`);
verifier("témoin, écran 2 seul (mot de passe, page dépouillée) : pas d'alerte", !alerte(temoin) && (await lireMemoire(sw)) === null, `${temoin.code}, badge « ${temoin.badge} », mémoire ${JSON.stringify(await lireMemoire(sw))}`);
await new Promise((r) => setTimeout(r, 300));
const e1 = await statutDe(context, sw, `${H}/etape1`);
const memoire = await lireMemoire(sw);
verifier("écran 1 (identifiant, imitation de la marque) : pas d'alerte, mais l'imitation est retenue pour l'hôte exact", !alerte(e1) && !!memoire?.['acces-fiscal-securise.fr'], `${e1.code} ; mémoire ${JSON.stringify(memoire)}`);
verifier("la mémoire ne contient que l'hôte, la marque, le score, les familles et la date (aucun texte de page, aucune saisie)", memoire && Object.values(memoire).every((v) => Object.keys(v).sort().join() === 'familles,marque,retenueLe,scoreImitation'), JSON.stringify(Object.keys(Object.values(memoire ?? {})[0] ?? {})));
const e2 = await statutDe(context, sw, `${H}/etape2`);
verifier('écran 2 (mot de passe, page dépouillée) du MÊME hôte : alerte, avec la marque retenue', alerte(e2) && /Impôts/.test(e2.texte), `${e2.code} « ${e2.texte} », badge « ${e2.badge} », bandeau ${e2.bandeau}`);

// ---- 2. hôte exact : un autre sous-domaine n'est pas concerné ---------------------------------------------------------------------------
const autre = await statutDe(context, sw, 'https://autre.acces-fiscal-securise.fr/etape2');
verifier("un autre sous-domaine du même domaine n'hérite pas de la mémoire", !alerte(autre), `${autre.code}, badge « ${autre.badge} »`);

// ---- 3. péremption : 16 minutes plus tard, plus d'effet ------------------------------------------------------------------------------------
await sw.evaluate(async () => {
  const t = (await chrome.storage.session.get('memoireImitation')).memoireImitation;
  for (const k of Object.keys(t)) t[k].retenueLe -= 16 * 60 * 1000;
  await chrome.storage.session.set({ memoireImitation: t });
});
const perime = await statutDe(context, sw, `${H}/etape2?perime`);
verifier('mémoire vieille de 16 minutes : aucune alerte sur l\'écran 2', !alerte(perime), `${perime.code}, badge « ${perime.badge} »`);

// ---- 4. la mémoire est effacée à la fermeture du navigateur ---------------------------------------------------------------------------------
await statutDe(context, sw, `${H}/etape1?encore`);
verifier('avant la fermeture : la mémoire existe', !!(await lireMemoire(sw))?.['acces-fiscal-securise.fr']);
await context.close();
await attendre(1500);
({ context, sw } = await lancer());
const apres = await lireMemoire(sw);
verifier('après fermeture et réouverture du navigateur (même profil) : mémoire effacée', apres === null, JSON.stringify(apres));
const seul = await statutDe(context, sw, `${H}/etape2?apres`);
verifier("après réouverture : l'écran 2 seul ne donne plus d'alerte", !alerte(seul), `${seul.code}, badge « ${seul.badge} »`);
const localStorageVide = await sw.evaluate(async () => !JSON.stringify(await chrome.storage.local.get(null)).includes('acces-fiscal'));
verifier("rien n'a été écrit dans le stockage persistant (local) : ni hôte ni imitation", localStorageVide);

// ---- 5. faux site au nom ressemblant : l'écran dépouillé passe de N1 à N2 -------------------------------------------------------------
const L = 'https://impots-gouv.fr';
const avant = await statutDe(context, sw, `${L}/etape2?seul`);
await statutDe(context, sw, `${L}/etape1`);
const apresL = await statutDe(context, sw, `${L}/etape2`);
verifier("nom ressemblant, écran 2 seul : alerte N1 par le nom ; avec la mémoire : alerte N2 « ne saisissez rien »", /^n1-/.test(avant.code ?? '') && apresL.code === 'n2-imitation', `seul : ${avant.code} ; deux étapes : ${apresL.code} « ${apresL.texte} »`);

await context.close();
console.log(echecs === 0 ? 'Tous les contrôles sont conformes.' : `${echecs} échec(s).`);
process.exit(echecs ? 1 : 0);
