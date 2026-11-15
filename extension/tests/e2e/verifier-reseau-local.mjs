// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.67 : les adresses du réseau local ne sont pas analysées ; les IP publiques, les faux domaines à numéros et les fichiers locaux le restent. Navigateur réel
// (Chromium/Brave, extension chargée depuis dist/chrome-essai), profil neuf. Une page de routeur est servie sur une VRAIE adresse 192.168.x.x de ce poste
// (serveur local jetable) ; les autres adresses sont servies par une route Playwright (aucune requête réelle). Aucune saisie, aucun envoi.
//   TMT_EXECUTABLE=<brave.exe> node tests/e2e/verifier-reseau-local.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import { networkInterfaces, tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const DIST = process.env.TMT_DIST ?? join(ICI, '..', '..', 'dist', 'chrome-essai');
const EXE = process.env.TMT_EXECUTABLE;
if (!EXE) throw new Error('TMT_EXECUTABLE requis');
const PORT_CDP = 9491;
let echecs = 0;
const verifier = (l, ok, d = '') => { console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${l}${d ? ' — ' + d : ''}`); if (!ok) echecs++; };

const TEXTE_RESEAU_LOCAL = "Adresse de votre réseau local. Elle n'est donc pas analysée.";
const IMITATION = "Votre espace particulier — déclarer mes revenus, gérer mon prélèvement à la source, DGFiP, avis d'imposition, taxe d'habitation";
const page = (titre, corps) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${titre}</title></head><body style="font-family:sans-serif;max-width:420px;margin:40px auto">${corps}</body></html>`;
const ROUTEUR = page('TP-Link Wireless Router', '<h1>TP-Link</h1><p>Connexion à l\'interface d\'administration</p><form action="#"><label for="mdp">Mot de passe</label><br><input id="mdp" type="password" name="pwd"><br><button type="submit">Connexion</button></form>');
const IMITATION_PAGE = page('Espace particulier', `<h1>Espace Particulier</h1><p>${IMITATION}</p><form action="#"><label for="id">Numéro fiscal</label><br><input id="id" type="text" name="identifiant"><br><label for="mdp">Mot de passe</label><br><input id="mdp" type="password" name="mdp"><br><button type="submit">Se connecter</button></form>`);
const CONNEXION_NEUTRE = page('Connexion', '<h1>Espace membres</h1><form action="#"><label for="mdp">Mot de passe</label><br><input id="mdp" type="password" name="mdp"><br><button type="submit">Se connecter</button></form>');

// ---- une VRAIE adresse du réseau local : serveur jetable sur l'adresse 192.168.x.x de ce poste ---------------------------------------------------------------
const lan = Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && /^192\.168\./.test(a.address))?.address ?? null;
const serveur = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(q.url.startsWith('/impots') ? IMITATION_PAGE : ROUTEUR); });
let portLan = 0;
if (lan) await new Promise((ok) => serveur.listen(0, lan, () => { portLan = serveur.address().port; ok(); }));
console.log(`INFO  adresse 192.168.x.x réelle de ce poste : ${lan ? `${lan}:${portLan}` : 'aucune (essai sur adresse réelle impossible)'}`);

const contexte = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tourmentin-reseau-local-')), {
  executablePath: EXE, headless: false,
  ignoreDefaultArgs: process.env.TMT_BRAVE === '1' ? ['--disable-component-update', '--disable-background-networking'] : [],
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--disable-features=DisableLoadExtensionCommandLineSwitch', `--remote-debugging-port=${PORT_CDP}`, '--no-first-run'],
});
const sw = contexte.serviceWorkers()[0] ?? (await contexte.waitForEvent('serviceworker', { timeout: 20000 }));
for (const p of contexte.pages()) if (p.url().includes('premier-lancement')) await p.close();
// les adresses de la table ci-dessous sont servies sans réseau (seules celles-là : le reste, dont le téléchargement des listes, passe normalement)
const HOTES_SERVIS = new Set();
await contexte.route('**/*', (route) => {
  const u = new URL(route.request().url());
  if (!/^https?:$/.test(u.protocol) || !HOTES_SERVIS.has(u.host)) return route.continue();
  route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: u.pathname.startsWith('/impots') ? IMITATION_PAGE : u.pathname.startsWith('/routeur') ? ROUTEUR : CONNEXION_NEUTRE });
});

async function observer(url) {
  if (!url.startsWith('file:') && !(lan && url.startsWith(`http://${lan}:`))) HOTES_SERVIS.add(new URL(url).host);
  const p = await contexte.newPage();
  await p.goto(url, { waitUntil: 'load' }).catch(() => {});
  await p.waitForTimeout(2600);
  const bandeaux = await p.evaluate(() => ['tourmentin-bandeau-n2', 'tourmentin-bandeau-connexion', 'tourmentin-bandeau-frauduleux'].filter((id) => document.getElementById(id)));
  await p.bringToFront();
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
  const badge = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  const etat = await sw.evaluate(async (id) => Object.keys(await chrome.storage.session.get(null)).filter((k) => k.includes(String(id))), tabId);
  const err = await sw.evaluate(async () => { try { await chrome.action.openPopup(); return null; } catch (e) { return String(e); } });
  let statut = { code: null, texte: '', boutons: null };
  if (!err) {
    const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${PORT_CDP}`);
    let popup = null;
    for (let i = 0; i < 30 && !popup; i++) { popup = cdp.contexts().flatMap((c) => c.pages()).find((q) => q.url().includes('/popup.html')) ?? null; if (!popup) await new Promise((r) => setTimeout(r, 200)); }
    await popup?.waitForSelector('#statut', { timeout: 6000 }).catch(() => {});
    await popup?.waitForTimeout(500);
    if (popup) statut = await popup.evaluate(() => {
      const e = document.getElementById('statut');
      const visibles = [...document.querySelectorAll('button')].filter((b) => getComputedStyle(b).display !== 'none' && b.offsetParent !== null).map((b) => b.textContent.trim());
      return { code: e?.dataset.code ?? null, texte: e?.textContent?.trim() ?? '', boutons: visibles };
    });
    await cdp.close().catch(() => {});
  } else statut.erreur = err;
  await p.close();
  return { ...statut, badge, bandeaux, etat };
}
const alerte = (o) => /^n[12]-/.test(o.code ?? '') && o.badge !== '';

// ---- 1. la page d'un routeur, sur une vraie adresse 192.168.x.x ----------------------------------------------------------------------------------------------
if (lan) {
  const r = await observer(`http://${lan}:${portLan}/`);
  verifier(`routeur réel (http://${lan}:${portLan}/, champ mot de passe) : statut gris « ${TEXTE_RESEAU_LOCAL} »`, r.code === 'reseau-local' && r.texte === TEXTE_RESEAU_LOCAL, `${r.code} « ${r.texte} »`);
  verifier('routeur réel : AUCUN bandeau dans la page (ni connexion, ni alerte)', r.bandeaux.length === 0, JSON.stringify(r.bandeaux));
  verifier('routeur réel : aucun badge, et rien conservé pour l\'onglet (le script n\'a même pas envoyé la page : ni analyse, ni mémoire d\'imitation)', r.badge === '' && r.etat.length === 0, `badge « ${r.badge} », état ${JSON.stringify(r.etat)}`);
  verifier('routeur réel : la fenêtre ne propose ni déclaration ni validation', !(r.boutons ?? []).some((b) => /frauduleuse|officiel|Valider|Confirmer/i.test(b)), JSON.stringify(r.boutons));
  const i = await observer(`http://${lan}:${portLan}/impots`);
  verifier(`imitation parfaite sur la même adresse locale : toujours ni alerte ni bandeau`, i.code === 'reseau-local' && i.badge === '' && i.bandeaux.length === 0, `${i.code}, badge « ${i.badge} », ${JSON.stringify(i.bandeaux)}`);
}

// ---- 2. une page par plage, bornes comprises (adresses servies sans réseau) ------------------------------------------------------------------------------------
const EXCLUES = ['http://192.168.0.250/impots', 'http://10.0.0.5/impots', 'http://10.255.255.255/impots', 'http://172.16.0.1/impots', 'http://172.31.255.255/impots', 'http://127.0.0.1:8080/impots', 'http://169.254.169.254/impots', 'http://[::1]/impots', 'http://[fd12:3456:789a::1]/impots', 'http://[fe80::1]/impots', 'http://localhost:3000/impots', 'http://imprimante.local/impots', 'http://nas.lan/impots', 'http://passerelle.home.arpa/impots', 'http://wiki.internal/impots', 'http://intranet/impots'];
for (const url of EXCLUES) {
  const o = await observer(url);
  verifier(`${url} : exclue (statut réseau local, ni alerte, ni bandeau, aucun badge)`, o.code === 'reseau-local' && o.badge === '' && o.bandeaux.length === 0, `${o.code}, badge « ${o.badge} », ${JSON.stringify(o.bandeaux)}`);
}
const ANALYSEES = ['http://45.12.34.56/impots', 'http://172.15.255.255/impots', 'http://172.32.0.1/impots', 'http://11.0.0.1/impots', 'https://192.168.0.250.exemple.com/impots', 'http://[2001:db8::1]/impots'];
for (const url of ANALYSEES) {
  const o = await observer(url);
  verifier(`${url} : analysée (alerte sur l'imitation)`, alerte(o) && o.code !== 'reseau-local', `${o.code} « ${o.texte} », badge « ${o.badge} », ${JSON.stringify(o.bandeaux)}`);
}
// une IP publique avec une simple page de connexion : analysée, donc bandeau de connexion (comme tout site inconnu) ; le routeur, lui, n'en a pas (cas 1)
const neutre = await observer('http://45.12.34.57/connexion');
verifier('IP publique, page de connexion sans imitation : analysée (site inconnu : bandeau de connexion et statut de prudence)', neutre.code === 'inconnu-prudence' && neutre.bandeaux.includes('tourmentin-bandeau-connexion'), `${neutre.code}, ${JSON.stringify(neutre.bandeaux)}`);

// ---- 3. un fichier ouvert depuis le disque (file://) : analysé -------------------------------------------------------------------------------------------------
const fichier = join(mkdtempSync(join(tmpdir(), 'tmt-fichier-')), 'piece-jointe.html');
writeFileSync(fichier, IMITATION_PAGE);
const f = await observer(pathToFileURL(fichier).href);
verifier('fichier HTML ouvert depuis le disque (file://) avec une imitation : analysé, alerte', alerte(f) && f.code !== 'reseau-local', `${f.code} « ${f.texte} », badge « ${f.badge} », ${JSON.stringify(f.bandeaux)}`);

await contexte.close();
serveur.close();
console.log(echecs === 0 ? 'Tous les contrôles sont conformes.' : `${echecs} échec(s).`);
process.exit(echecs ? 1 : 0);
