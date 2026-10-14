// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.26 étape 3 : l'extension réelle (dist/chrome-essai) dans un vrai Chromium, contre le vrai serveur
// https://tourmentin.fr, de bout en bout :
//   - réglage « Ne jamais envoyer » : AUCUNE requête du service worker (capture réseau CDP) ;
//   - « Me demander » : aperçu = corps exact, « Enregistrer seulement » n'envoie rien, « Enregistrer et envoyer »
//     envoie, le texte envoyé est nettoyé ;
//   - liaison de compte par code, rôle dit par le serveur, boutons de rôle ;
//   - « Envoyer automatiquement » ;
//   - la déclaration est visible dans le back-office, validée, présente dans l'export.
// Toutes les données créées côté serveur le sont par un compte de TEST (installation de test dès la
// liaison) : purgées à la fin. Aucune saisie dans aucune page ; les pages visitées sont servies localement.
//
// Prérequis : le mode de maintenance du serveur ouvert, et TMT_FICHIER_JETON = fichier du jeton.
//   npm run build:chrome && TMT_FICHIER_JETON=<fichier> node tests/e2e/verifier-envoi.mjs
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { observerReseauSW } from './cdp-reseau-sw.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const DIST = join(ICI, '..', '..', 'dist', 'chrome-essai');
const CAPTURES = process.env.CAPTURES ?? join(tmpdir(), 'tourmentin-captures');
mkdirSync(CAPTURES, { recursive: true });
const BASE = 'https://tourmentin.fr';
const JETON = readFileSync(process.env.TMT_FICHIER_JETON, 'utf8').trim();
const PORT = 9395;
const MDP = 'Un-mot-de-passe-d-essai-12!';

let echecs = 0;
function verifier(libelle, condition, detail = '') {
  console.log(`${condition ? 'OK    ' : 'ÉCHEC '} ${libelle}${detail ? ' — ' + detail : ''}`);
  if (!condition) echecs++;
}

async function maint(chemin, corps = {}) {
  const r = await fetch(`${BASE}/api/v1/_maintenance${chemin}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tmt-Maintenance': JETON }, body: JSON.stringify(corps) });
  return { statut: r.status, json: await r.json().catch(() => null) };
}

// État réel du serveur AVANT l'essai : depuis la création de ph-admin (06/10/2026) la base porte de vraies données (compte, session,
// audit) qui ne viennent pas de cet essai ; le contrôle final compare à cet état, pas à zéro.
const ETAT_INITIAL = (await maint('/etat')).json ?? {};

// --- pages servies localement// --- pages servies localement --------------------------------------------------------------------
const PII = '<p>Contact du service : jean.dupont@exemple.fr — 06 12 34 56 78 — IBAN FR76 3000 6000 0112 3456 7890 189</p>';
const PAGE_CONNEXION = `<!doctype html><html><head><title>Espace adhérent</title></head><body><h1>Espace adhérent</h1>${PII}
<img src="https://logo-tmt.example.fr/logo.png?v=2#x"><form><label for="mdp">Mot de passe</label><input id="mdp" type="password" name="mdp"></form></body></html>`;
const PAGE_PAIEMENT = `<!doctype html><html><head><title>Paiement</title></head><body><p>Règlement</p>${PII}<form><input autocomplete="cc-number" name="carte"></form></body></html>`;
const HOTES = { a: 'site-a-tmt.fr', b: 'site-b-tmt.fr', c: 'site-c-tmt.fr', d: 'site-d-tmt.fr', e: 'site-e-tmt.fr', paiement: 'boutique-tmt.fr' };

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tourmentin-envoi-')), {
  channel: 'chromium',
  headless: false,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, `--remote-debugging-port=${PORT}`],
});
for (const h of [HOTES.a, HOTES.b, HOTES.c, HOTES.d, HOTES.e]) await context.route(`https://${h}/**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGE_CONNEXION }));
await context.route(`https://${HOTES.paiement}/**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGE_PAIEMENT }));
await context.route('https://logo-tmt.example.fr/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgo=', 'base64') }));
await new Promise((r) => setTimeout(r, 2500));
for (const p of context.pages()) if (p.url().includes('premier-lancement')) await p.close();
const sw = context.serviceWorkers()[0];
const idExtension = new URL(sw.url()).host;
const urlOptions = `chrome-extension://${idExtension}/src/options/options.html#parametres`;

async function popupSur(page) {
  await page.bringToFront();
  await sw.evaluate(async () => { await chrome.action.openPopup(); });
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let popup = null;
  for (let i = 0; i < 40 && !popup; i++) {
    popup = cdp.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('/popup.html')) ?? null;
    if (!popup) await new Promise((r) => setTimeout(r, 150));
  }
  if (!popup) throw new Error('popup introuvable');
  popup.connexionCdp = cdp;
  await popup.waitForSelector('#statut', { timeout: 6000 }).catch(() => {});
  await popup.waitForTimeout(700);
  return popup;
}
const fermerPopup = async (p) => { await p.connexionCdp.close().catch(() => {}); };
const texteStatut = (p) => p.evaluate(() => document.getElementById('statut')?.textContent ?? document.getElementById('contenu').textContent);
const visible = (p, id) => p.evaluate((i) => { const e = document.getElementById(i); return !!e && getComputedStyle(e).display !== 'none'; }, id);

async function reglerMode(mode) {
  const opt = await context.newPage();
  await opt.goto(urlOptions);
  await opt.check(`input[name="mode-envoi"][value="${mode}"]`);
  await opt.waitForTimeout(500);
  const stocke = await sw.evaluate(async () => (await chrome.storage.local.get('reglages')).reglages?.modeEnvoi ?? null);
  await opt.close();
  return stocke;
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let reseau = await observerReseauSW(PORT, idExtension);
const versTMT = () => reseau.requetes().filter((q) => q.url.startsWith(BASE));

try {
  await maint('/purge');
  await maint('/limites-zero');
  await maint('/compte', { identifiant: 'TEST_confiance', role: 'confiance', mot_de_passe: MDP, totp: true });
  await maint('/compte', { identifiant: 'TEST_ph', role: 'super', mot_de_passe: MDP, exempte: true });

  // ---------------------------------------------------------------- « Ne jamais envoyer »
  verifier('réglage « Ne jamais envoyer » enregistré depuis la vraie page d\'options', (await reglerMode('jamais')) === 'jamais');
  reseau.vider();
  let page = await context.newPage();
  await page.goto(`https://${HOTES.a}/connexion?jeton=abc#frag`);
  await page.waitForTimeout(1800);
  let popup = await popupSur(page);
  await popup.click('#bouton-frauduleuse');
  await popup.waitForSelector('#bouton-confirmer', { timeout: 4000 });
  let zone = await popup.locator('#confirmation').innerText();
  verifier('jamais : l\'aperçu dit « Rien n\'est envoyé », sans corps JSON ni choix d\'envoi', zone.includes('Rien n\'est envoyé') && (await popup.locator('#confirmation pre').count()) === 0 && !(await visible(popup, 'bouton-confirmer-envoyer')) && (await popup.locator('#confirmation button').count()) === 1, zone.slice(0, 80).replace(/\n/g, ' '));
  await popup.click('#bouton-confirmer');
  await popup.waitForTimeout(900);
  verifier('jamais : après confirmation, le statut dit « Il ne sera pas transmis »', (await texteStatut(popup)) === 'Signalement enregistré sur cet ordinateur. Il ne sera pas transmis (réglage « Ne jamais envoyer »).', await texteStatut(popup));
  verifier('jamais : aucun bouton de rôle', !(await visible(popup, 'zone-role')));
  await popup.screenshot({ path: join(CAPTURES, 'envoi-1-jamais.png') });
  await fermerPopup(popup);
  await page.close();
  const opt = await context.newPage();
  await opt.goto(urlOptions);
  await opt.fill('#code-liaison', 'ABCDEFGHIJKL');
  await opt.click('#lier');
  await opt.waitForTimeout(800);
  const msgLiaison = await opt.locator('#resultat-liaison').innerText();
  verifier('jamais : lier un compte est refusé sans requête (message explicite)', /Ne jamais envoyer/.test(msgLiaison), msgLiaison);
  await opt.close();
  await attendre(1500);
  verifier('jamais : AUCUNE requête du service worker, vers tourmentin.fr ni ailleurs (capture réseau CDP)', reseau.requetes().length === 0, JSON.stringify(reseau.requetes().map((q) => q.methode + ' ' + q.url)));

  // ---------------------------------------------------------------- « Me demander avant chaque envoi »
  verifier('réglage « Me demander avant chaque envoi » enregistré', (await reglerMode('demander')) === 'demander');
  reseau.vider();
  page = await context.newPage();
  await page.goto(`https://${HOTES.b}/connexion?jeton=abc#frag`);
  await page.waitForTimeout(1800);
  popup = await popupSur(page);
  await popup.click('#bouton-frauduleuse');
  await popup.waitForSelector('#bouton-confirmer', { timeout: 4000 });
  const corpsApercu = await popup.locator('#confirmation pre').innerText();
  let objet = null;
  try { objet = JSON.parse(corpsApercu); } catch { /* */ }
  verifier('demander : l\'aperçu montre le corps exact qui partirait (JSON valide)', objet !== null && objet.hote === HOTES.b && objet.type === 'frauduleuse' && objet.v === 1, corpsApercu.slice(0, 80).replace(/\n/g, ' '));
  verifier('demander : chemin sans requête ni fragment, pas de jeton', objet.chemin === '/connexion' && !corpsApercu.includes('abc') && !corpsApercu.includes('frag'));
  verifier('demander : e-mail, téléphone et IBAN de la page retirés du texte', !/jean\.dupont|06 12 34|3000 6000/.test(corpsApercu) && /adresse e-mail retirée/.test(corpsApercu) && /IBAN retiré/.test(corpsApercu) && /numéro de téléphone retiré/.test(corpsApercu));
  verifier('demander : l\'image est une adresse sans requête, jamais son contenu', JSON.stringify(objet.images) === JSON.stringify([{ url: 'https://logo-tmt.example.fr/logo.png' }]), JSON.stringify(objet.images));
  const boutons = await popup.locator('#confirmation button').allInnerTexts();
  verifier('demander : deux choix distincts, « Enregistrer et envoyer » et « Enregistrer seulement »', boutons.join('|') === 'Enregistrer et envoyer|Enregistrer seulement', boutons.join('|'));
  await popup.screenshot({ path: join(CAPTURES, 'envoi-2-demander-apercu.png') });
  verifier('demander : rien n\'est parti avant le choix', versTMT().length === 0);
  await popup.click('#bouton-confirmer'); // « Enregistrer seulement »
  await popup.waitForTimeout(1000);
  verifier('demander : « Enregistrer seulement » n\'envoie rien (aucune requête)', reseau.requetes().length === 0, JSON.stringify(reseau.requetes().map((q) => q.url)));
  verifier('demander : statut « pas encore transmis »', (await texteStatut(popup)) === 'Signalement enregistré sur cet ordinateur, pas encore transmis');
  await fermerPopup(popup);
  await page.close();

  // ---------------------------------------------------------------- liaison de compte
  const code = (await maint('/code-liaison', { identifiant: 'TEST_confiance' })).json.code;
  reseau.vider();
  const optL = await context.newPage();
  await optL.goto(urlOptions);
  await optL.fill('#code-liaison', code);
  await optL.click('#lier');
  await optL.waitForFunction(() => /Liaison réussie|refusée/.test(document.getElementById('resultat-liaison')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  const res = await optL.locator('#resultat-liaison').innerText();
  verifier('liaison : le code collé lie le navigateur, rôle « utilisateur de confiance » dit par le serveur', /Liaison réussie\. Rôle : utilisateur de confiance/.test(res), res);
  await optL.screenshot({ path: join(CAPTURES, 'envoi-3-liaison.png') });
  await optL.close();
  const reqL = versTMT();
  verifier('liaison : exactement deux requêtes (enregistrement de l\'installation, puis liaison), toutes vers l\'API', reqL.length === 2 && reqL[0].url === `${BASE}/api/v1/installations` && reqL[1].url === `${BASE}/api/v1/liaison`, reqL.map((q) => q.methode + ' ' + q.url).join(' | '));
  const corpsReg = JSON.parse(reqL[0].corps ?? '{}');
  verifier('liaison : l\'enregistrement ne porte que la clé publique, l\'horodatage et la preuve (aucune clé privée)', Object.keys(corpsReg).sort().join(',') === 'cle_publique,horodatage,preuve' && corpsReg.cle_publique.length === 43 && corpsReg.preuve.length === 86, Object.keys(corpsReg).join(','));
  const etat = (await maint('/etat')).json;
  verifier('liaison : l\'installation est devenue une installation de test côté serveur', etat.installations.test === 1 && etat.installations.reel === (ETAT_INITIAL.installations?.reel ?? 0), JSON.stringify(etat.installations));
  const cle = await sw.evaluate(async () => new Promise((resolve) => {
    const r = indexedDB.open('tourmentin', 1);
    r.onsuccess = () => {
      const g = r.result.transaction('cles').objectStore('cles').get('installation');
      g.onsuccess = async () => {
        try { await crypto.subtle.exportKey('pkcs8', g.result.privee); resolve('EXPORTABLE'); } catch { resolve(g.result.privee.extractable === false ? 'non exportable' : '?'); }
      };
    };
  }));
  verifier('la clé privée de l\'installation est non exportable (règle 3 de CLAUDE.md)', cle === 'non exportable', cle);

  // ---------------------------------------------------------------- envoi après choix
  reseau.vider();
  page = await context.newPage();
  await page.goto(`https://${HOTES.c}/connexion?jeton=abc#frag`);
  await page.waitForTimeout(1800);
  popup = await popupSur(page);
  await popup.click('#bouton-frauduleuse');
  await popup.waitForSelector('#bouton-confirmer-envoyer', { timeout: 4000 });
  const apercuEnvoye = JSON.parse(await popup.locator('#confirmation pre').innerText());
  await popup.click('#bouton-confirmer-envoyer'); // « Enregistrer et envoyer »
  await popup.waitForFunction(() => /envoyée à tourmentin\.fr|échoué/.test(document.getElementById('confirmation')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  const msgEnvoi = await popup.locator('#confirmation').innerText();
  verifier('envoi : « Déclaration enregistrée et envoyée à tourmentin.fr : vérification en cours »', /enregistrée et envoyée à tourmentin\.fr : vérification en cours/.test(msgEnvoi), msgEnvoi);
  await popup.waitForTimeout(900);
  verifier('envoi : le statut passe à « vérification en cours » (l\'envoi est réel)', (await texteStatut(popup)) === 'Vous avez signalé ce site : vérification en cours', await texteStatut(popup));
  await popup.screenshot({ path: join(CAPTURES, 'envoi-4-envoye.png') });
  const reqs = versTMT();
  const decl = reqs.find((q) => q.url === `${BASE}/api/v1/declarations`);
  verifier('envoi : une requête POST vers /api/v1/declarations', !!decl && decl.methode === 'POST', reqs.map((q) => q.url).join(' | '));
  const enveloppe = JSON.parse(decl?.corps ?? '{}');
  const corps = JSON.parse(enveloppe.corps ?? '{}');
  verifier('envoi : enveloppe signée { installation, corps, signature } sans autre champ', Object.keys(enveloppe).sort().join(',') === 'corps,installation,signature' && enveloppe.signature.length === 86, Object.keys(enveloppe).join(','));
  // Le stockage de session trie les clés : l'égalité est celle du contenu, pas de l'ordre.
  const trie = (o) => (Array.isArray(o) ? o.map(trie) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, trie(o[k])])) : o);
  const sansHorodatage = (o) => JSON.stringify(trie({ ...o, horodatage: '' }));
  verifier("envoi : le corps envoyé est exactement celui de l'aperçu (sauf l'horodatage)", sansHorodatage(corps) === sansHorodatage(apercuEnvoye), sansHorodatage(corps) === sansHorodatage(apercuEnvoye) ? '' : sansHorodatage(corps).slice(0, 200));
  verifier('envoi : jamais d\'adresse e-mail, de téléphone ni d\'IBAN dans ce qui est parti', !/jean\.dupont|06 12 34 56|3000 6000/.test(decl?.corps ?? ''));
  const stockee = (await maint('/declarations')).json.declarations.find((d) => d.hote === HOTES.c);
  verifier('serveur : la déclaration est reçue, en attente, texte nettoyé', !!stockee && stockee.etat === 'en_attente' && !/jean\.dupont/.test(stockee.textes ?? ''), JSON.stringify(stockee)?.slice(0, 100));
  const entrees = await sw.evaluate(async () => (await chrome.storage.local.get('signalements')).signalements ?? []);
  verifier('local : l\'entrée porte « envoi: ok » ; l\'autre (enregistrée seulement) n\'en porte pas', entrees.find((x) => x.hote === HOTES.c)?.envoi === 'ok' && entrees.find((x) => x.hote === HOTES.a)?.envoi === undefined && entrees.find((x) => x.hote === HOTES.b)?.envoi === undefined);
  await fermerPopup(popup);
  await page.close();

  // ---------------------------------------------------------------- rôle et boutons de rôle
  reseau.vider();
  page = await context.newPage();
  await page.goto(`https://${HOTES.d}/connexion`);
  await page.waitForTimeout(1800);
  popup = await popupSur(page);
  await popup.waitForFunction(() => getComputedStyle(document.getElementById('zone-role')).display !== 'none', null, { timeout: 8000 }).catch(() => {});
  verifier('rôle de confiance (dit par le serveur) : « Valider comme officiel », « Confirmer frauduleux », « Voir les sites de la base »',
    (await visible(popup, 'bouton-valider')) && (await visible(popup, 'bouton-confirmer-frauduleux')) && (await visible(popup, 'bouton-gestion')));
  await popup.screenshot({ path: join(CAPTURES, 'envoi-5-boutons-de-role.png') });
  await popup.click('#bouton-valider');
  await popup.waitForSelector('#bouton-confirmer-action', { timeout: 3000 });
  verifier('« Valider comme officiel » : une confirmation précède, rien n\'est parti', !reseau.requetes().some((q) => q.url.endsWith('/actions')));
  await popup.click('#bouton-confirmer-action');
  await popup.waitForFunction(() => /Décision enregistrée|Refusé/.test(document.getElementById('confirmation')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  verifier('« Valider comme officiel » : décision enregistrée par le serveur', /Décision enregistrée/.test(await popup.locator('#confirmation').innerText()), await popup.locator('#confirmation').innerText());
  const siteC = (await maint('/site', { hote: HOTES.d })).json.sites;
  verifier('serveur : effet immédiat dans la base (site officiel)', siteC.length === 1 && siteC[0].etat === 'officiel' && siteC[0].actif === '1', JSON.stringify(siteC));
  const nouvelOnglet = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await popup.click('#bouton-gestion');
  const gestion = await nouvelOnglet;
  verifier('« Voir les sites de la base » ouvre l\'adresse fixe https://tourmentin.fr/gestion', !!gestion && gestion.url().startsWith(`${BASE}/gestion`), gestion?.url());
  if (gestion) await gestion.close();
  await fermerPopup(popup);
  await page.close();

  page = await context.newPage();
  await page.goto(`https://${HOTES.paiement}/`);
  await page.waitForTimeout(1800);
  popup = await popupSur(page);
  await popup.waitForFunction(() => getComputedStyle(document.getElementById('zone-role')).display !== 'none', null, { timeout: 8000 }).catch(() => {});
  verifier('page de paiement : ni « Signaler comme site officiel » ni « Valider comme officiel » (14.24 A5), « Confirmer frauduleux » reste',
    !(await visible(popup, 'bouton-officiel')) && !(await visible(popup, 'bouton-valider')) && (await visible(popup, 'bouton-confirmer-frauduleux')));
  await popup.screenshot({ path: join(CAPTURES, 'envoi-6-paiement.png') });
  await fermerPopup(popup);
  await page.close();

  // ---------------------------------------------------------------- « Envoyer automatiquement »
  verifier('réglage « Envoyer automatiquement » enregistré', (await reglerMode('automatique')) === 'automatique');
  reseau.vider();
  page = await context.newPage();
  await page.goto(`https://${HOTES.e}/connexion`);
  await page.waitForTimeout(1800);
  popup = await popupSur(page);
  await popup.click('#bouton-frauduleuse');
  await popup.waitForSelector('#bouton-confirmer', { timeout: 4000 });
  const bAuto = await popup.locator('#confirmation button').allInnerTexts();
  verifier('automatique : un seul bouton, « Confirmer et envoyer », et le texte dit que l\'envoi suit la confirmation', bAuto.join('|') === 'Confirmer et envoyer' && /dès que vous confirmez/.test(await popup.locator('#confirmation').innerText()), bAuto.join('|'));
  await popup.screenshot({ path: join(CAPTURES, 'envoi-7-automatique.png') });
  verifier('automatique : rien ne part avant la confirmation', versTMT().length === 0);
  await popup.click('#bouton-confirmer');
  await popup.waitForFunction(() => /envoyée à tourmentin\.fr|échoué/.test(document.getElementById('confirmation')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  await popup.screenshot({ path: join(CAPTURES, 'envoi-7b-auto-apres.png') }).catch(() => {});
  const msgAuto = await popup.locator('#confirmation').innerText();
  verifier('automatique : une confirmation suffit, la déclaration part', versTMT().some((q) => q.url === `${BASE}/api/v1/declarations`) && /envoyée à tourmentin\.fr/.test(msgAuto), `${msgAuto} | ${versTMT().map((q) => q.url).join(' ')} | attachements=${reseau.attachements()}`);
  await fermerPopup(popup);
  await page.close();

  // ---------------------------------------------------------------- back-office : visible, validée, présente dans l'export
  const jar = new Map();
  const req = async (chemin, { form } = {}) => {
    const h = { Origin: BASE };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (form) h['Content-Type'] = 'application/x-www-form-urlencoded';
    const r = await fetch(BASE + chemin, { method: form ? 'POST' : 'GET', headers: h, body: form ? new URLSearchParams(form).toString() : undefined, redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) { const [p] = c.split(';'); const i = p.indexOf('='); if (p.slice(i + 1)) jar.set(p.slice(0, i), p.slice(i + 1)); }
    return { statut: r.status, texte: await r.text(), entetes: r.headers };
  };
  await req('/gestion/connexion', { form: { identifiant: 'TEST_ph', mot_de_passe: MDP } });
  let rr = await req('/gestion/declarations');
  verifier('back-office : la déclaration envoyée depuis l\'extension est dans la file, avec les signaux du moteur et le texte nettoyé',
    rr.statut === 200 && rr.texte.includes(HOTES.c) && rr.texte.includes(HOTES.e) && /adresse e-mail retirée/.test(rr.texte) && !/jean\.dupont/.test(rr.texte));
  const csrf = (rr.texte.match(/name="csrf" value="([^"]+)"/) ?? [])[1];
  const idDecl = (rr.texte.split(`${HOTES.c}`)[0].match(/Déclaration n° (\d+)(?![\s\S]*Déclaration n° )/) ?? [])[1];
  rr = await req('/gestion/declarations', { form: { csrf, declaration: idDecl, action: 'valider_officiel' } });
  verifier('back-office : décision « valider comme officiel » enregistrée', /Décision enregistrée/.test(rr.texte), rr.texte.match(/<p class="(?:erreur|ok)">([^<]+)/)?.[1]);
  rr = await req('/gestion/export');
  let exp = null;
  try { exp = JSON.parse(rr.texte); } catch { /* */ }
  verifier('export : le site validé depuis la file est présent (sans identifiant de compte)', !!exp && exp.officiels.some((o) => o.hote === HOTES.c) && exp.officiels.some((o) => o.hote === HOTES.d) && !/compte|decide_par|installation/.test(rr.texte), rr.statut + '');
} finally {
  const p = await maint('/purge');
  const apres = (await maint('/etat')).json ?? {};
  const reste = Object.entries(apres).filter(([, v]) => v && typeof v === 'object' && v.test !== undefined).map(([k, v]) => `${k}:${v.test}`);
  verifier('purge : plus aucune donnée de test en base', p.statut === 200 && reste.every((x) => x.endsWith(':0')), reste.join(' '));
  const reels = Object.entries(apres).filter(([k, v]) => v && v.reel !== undefined && k !== 'nonces' && v.reel !== (ETAT_INITIAL[k]?.reel ?? 0)).map(([k, v]) => `${k}:${ETAT_INITIAL[k]?.reel ?? 0}->${v.reel}`);
  verifier('aucune donnée réelle créée ni modifiée par ces essais (hors empreintes de signatures déjà vues, qui expirent seules en 20 minutes)', reels.length === 0, reels.join(' '));
  reseau.fermer();
  await context.close();
}
console.log(`\nCaptures : ${CAPTURES}`);
console.log(echecs === 0 ? 'Tous les contrôles sont conformes.' : `${echecs} contrôle(s) en échec.`);
process.exit(echecs === 0 ? 0 : 1);
