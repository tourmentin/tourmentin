// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.33 G : chaîne de publication signée hors ligne, de bout en bout, en conditions réelles :
//   validation dans le VRAI back-office (https://tourmentin.fr/gestion, compte de TEST) -> export -> signature locale
//   par l'outil réel (listes/outils/publier.ts, clé d'essai jetable chiffrée) -> serveur statique local ->
//   AUTRE profil de navigateur, build d'essai de publication (dist/chrome-publication-test) -> statut
//   « Site officiel vérifié » dans la VRAIE popup. Puis contrôles négatifs (signature altérée, mauvais nom de liste,
//   version ancienne), mise à jour, retrait, et build remis sans adresse de publication : aucune requête.
// Données créées côté serveur : comptes et sites de TEST, purgés à la fin. Aucune saisie dans aucune page.
//
// Prérequis : mode de maintenance ouvert, TMT_FICHIER_JETON = fichier du jeton, depuis extension/ :
//   npm run build:chrome && TMT_FICHIER_JETON=<fichier> node tests/e2e/verifier-publication.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, bilan, maint, verifier } from '../../../serveur/tests/outils.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const EXT = join(ICI, '..', '..');
const LISTES = join(EXT, '..', 'listes');
const CAPTURES = process.env.CAPTURES ?? join(tmpdir(), 'tourmentin-captures');
mkdirSync(CAPTURES, { recursive: true });
const TMP = mkdtempSync(join(tmpdir(), 'tourmentin-publication-'));
const PORT_STATIQUE = 9478;
const PORT_CDP = 9479;
const PHRASE = 'phrase-d-essai-jetable-pas-un-secret';
const MDP = 'Un-mot-de-passe-d-essai-12!';
const H_OFFICIEL = 'www.officiel-pub-tmt.fr';
const H_APEX = 'officiel-pub-tmt.fr';
const H_SANS_MARQUE = 'sans-marque-pub-tmt.fr';
const H_NOUVEAU = 'nouveau-pub-tmt.fr';
const H_FAUX = 'faux-pub-tmt.fr';
const H_AUTRE = 'inconnu-pub-tmt.fr';
const H_REPERTORIE = 'www.repertorie-pub-tmt.fr'; // 14.44 : importé comme « répertorié » (vert pâle)
const H_REPERTORIE_N1 = 'ameli-secure.fr'; // 14.44 : répertorié, mais la page imite ameli (N1) : N1 l'emporte sur le vert pâle
const PAGE_N1 = readFileSync(join(EXT, 'tests', 'pages', 'imitations', '02-ameli.html'), 'utf8');
const H_N2 = 'impots-gouv.fr'; // imitation FORTE hors socle (fixture 01-impots-gouv.html, score 177) : reste N2 sous M6
const H_N2_FAIBLE = 'impot-gouv.fr'; // imitation plus faible (page en ligne) : M6 peut la faire passer sous le seuil, constat consigné
const PAGE_N2 = readFileSync(join(EXT, 'tests', 'pages', 'imitations', '01-impots-gouv.html'), 'utf8');
const PAGE_N2_FAIBLE = `<!doctype html><html><head><title>Espace Particulier</title></head>
<body><p>Espace Particulier — DGFiP, avis d'imposition, taxe d'habitation</p>
<form><input type="password" name="mdp"></form></body></html>`;

// --- client du back-office (cookies, CSRF) ----------------------------------------------------------
class Client {
  constructor() { this.cookies = new Map(); this.dernier = null; }
  async requete(chemin, { methode = 'GET', form } = {}) {
    const h = {};
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let corps;
    if (form) { corps = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; h.Origin = BASE; }
    const r = await fetch(BASE + chemin, { method: methode, headers: h, body: corps, redirect: 'manual' });
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [paire] = c.split(';'); const i = paire.indexOf('=');
      const val = paire.slice(i + 1);
      if (val === '' || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(paire.slice(0, i)); else this.cookies.set(paire.slice(0, i), val);
    }
    this.dernier = { statut: r.status, texte: await r.text(), entetes: r.headers };
    return this.dernier;
  }
  get(c) { return this.requete(c); }
  post(c, form) { return this.requete(c, { methode: 'POST', form }); }
  csrf() { return (this.dernier.texte.match(/name="csrf" value="([^"]+)"/) ?? [])[1] ?? ''; }
}

async function ajouterSite(c, hote, etat, marque) {
  await c.get('/gestion/sites');
  return c.post('/gestion/sites', { csrf: c.csrf(), action: 'ajouter', hote, etat, ...(marque ? { marque } : {}) });
}
async function retirerSite(c, hote) {
  const r = await c.get('/gestion/sites');
  const ligne = r.texte.split('<tr>').find((l) => l.includes(`>${hote}<`));
  const id = (ligne?.match(/name="retirer_id" value="(\d+)"/) ?? [])[1];
  if (!id) return { texte: 'site introuvable' };
  return c.post('/gestion/sites', { csrf: c.csrf(), retirer_id: id });
}

// --- serveur statique local : sert les listes publiées, journalise chaque requête ----------------------
const dossierPubli = join(TMT_DOSSIER(), 'publie');
function TMT_DOSSIER() { return TMP; }
mkdirSync(dossierPubli, { recursive: true });
const journalRequetes = [];
let substitution = {}; // nom de fichier -> contenu servi à la place (contrôles négatifs)
const serveur = http.createServer((req, res) => {
  journalRequetes.push({ methode: req.method, url: req.url, entetes: { ...req.headers } });
  const nom = (req.url ?? '').replace(/^\//, '');
  if (!['officiels.json', 'frauduleux.json'].includes(nom)) { res.writeHead(404).end(); return; }
  const corps = substitution[nom] ?? readFileSync(join(dossierPubli, nom), 'utf8');
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(corps);
});
await new Promise((ok) => serveur.listen(PORT_STATIQUE, '127.0.0.1', ok));

// --- outil de publication réel ----------------------------------------------------------------------
const fichierCle = join(TMP, 'cle-essai.json');
const outil = (...args) => execFileSync('node', ['outils/publier.ts', ...args], { cwd: LISTES, env: { ...process.env, TMT_PHRASE_DE_PASSE: PHRASE }, encoding: 'utf8' });

let echecFatal = null;
let context = null;
try {
  // 1. clé d'essai jetable, chiffrée, hors dépôt
  const sortieCle = outil('creer-cle', fichierCle);
  const cle = JSON.parse(readFileSync(fichierCle, 'utf8'));
  verifier('clé d\'essai : fichier chiffré, aucune graine en clair, clé publique de 64 caractères', /^[0-9a-f]{64}$/.test(cle.publique) && !/PRIVATE|"d"/.test(readFileSync(fichierCle, 'utf8')) && sortieCle.includes(cle.publique));
  verifier('clé d\'essai : un fichier de clé existant n\'est jamais écrasé', (() => { try { outil('creer-cle', fichierCle); return false; } catch (e) { return /existe déjà/.test(String(e.stderr)); } })());

  // 2. build d'essai de publication (clé jetable, serveur local) et build remis
  execSync('npm run build:publication-test', { cwd: EXT, stdio: 'ignore', env: { ...process.env, TOURMENTIN_URL_PUBLICATION: `http://127.0.0.1:${PORT_STATIQUE}/`, TOURMENTIN_CLE_PUBLIQUE_LISTES: cle.publique } });
  const DIST_TEST = join(EXT, 'dist', 'chrome-publication-test');
  const DIST_REMIS = join(EXT, 'dist', 'chrome-essai');
  verifier('le build d\'essai de publication sort dans dist/chrome-publication-test, pas dans dist/chrome-essai', readFileSync(join(DIST_TEST, 'manifest.json'), 'utf8').includes('alarms'));
  verifier('une adresse de publication non https est refusée à la construction (hors build d\'essai local)', (() => { try { execSync('npx vite build --mode chrome', { cwd: EXT, stdio: 'pipe', env: { ...process.env, TOURMENTIN_URL_PUBLICATION: 'http://exemple.fr/', TOURMENTIN_CLE_PUBLIQUE_LISTES: cle.publique } }); return false; } catch (e) { return /doit être en https/.test(String(e.stderr) + String(e.stdout)); } })());
  execSync('npm run build:chrome', { cwd: EXT, stdio: 'ignore' });
  verifier('le build remis (dist/chrome-essai) ne porte aucune adresse de publication locale (garde-fou de build)', execSync('node scripts/verifier-build-essai.mjs', { cwd: EXT, encoding: 'utf8' }).includes('OK'));

  // 3. validation dans le vrai back-office (compte de TEST), puis export
  await maint('/purge');
  await maint('/limites-zero');
  const compte = await maint('/compte', { identifiant: 'TEST_publication', role: 'super', mot_de_passe: MDP, exempte: true });
  verifier('compte de TEST super-utilisateur créé', compte.statut === 201 || compte.statut === 200, String(compte.statut));
  const sup = new Client();
  await sup.post('/gestion/connexion', { identifiant: 'TEST_publication', mot_de_passe: MDP });
  let r = await ajouterSite(sup, H_OFFICIEL, 'officiel', 'impots-gouv');
  verifier('back-office : site officiel validé avec sa marque', /Site ajouté/.test(r.texte), r.texte.match(/<p class="erreur">([^<]+)/)?.[1] ?? '');
  r = await ajouterSite(sup, H_SANS_MARQUE, 'officiel');
  verifier('back-office : site officiel sans marque', /Site ajouté/.test(r.texte));
  r = await ajouterSite(sup, H_FAUX, 'frauduleux');
  verifier('back-office : site confirmé frauduleux', /Site ajouté/.test(r.texte));
  r = await ajouterSite(sup, 'sans-champ-pub-tmt.fr', 'frauduleux');
  verifier('back-office : second site confirmé frauduleux (page sans champ)', /Site ajouté/.test(r.texte));
  // 14.44 : deux sites « répertoriés » importés par la page d'import (saisie)
  await sup.get('/gestion/import');
  r = await sup.post('/gestion/import', { csrf: sup.csrf(), action: 'importer_saisie', hotes: `${H_REPERTORIE}\n${H_REPERTORIE_N1}` });
  verifier('back-office : deux sites importés comme « répertoriés »', /<strong>2<\/strong> nouveau/.test(r.texte), r.texte.match(/<p class="(?:ok|erreur)">[^<]*/)?.[0]);
  r = await sup.get('/gestion/export');
  const exportTexte = r.texte;
  writeFileSync(join(TMP, 'export-1.json'), exportTexte);
  const exp = JSON.parse(exportTexte);
  verifier('export : les quatre sites, sans identifiant de compte', r.statut === 200 && exp.officiels.length === 4 && exp.officiels.filter((o) => o.statut === 'repertorie').length === 2 && exp.frauduleux.length === 2 && !/TEST_publication|acteur|decide_par/.test(exportTexte));

  // 4. signature locale par l'outil réel
  const sortieDossier = join(dossierPubli);
  const fois1 = outil('publier', '--export', join(TMP, 'export-1.json'), '--cle', fichierCle, '--sortie', sortieDossier, '--oui');
  const off1 = JSON.parse(readFileSync(join(sortieDossier, 'officiels.json'), 'utf8'));
  const fra1 = JSON.parse(readFileSync(join(sortieDossier, 'frauduleux.json'), 'utf8'));
  verifier('outil : première publication, version AAAA.MM.001, différence affichée', /^\d{4}\.\d{2}\.001$/.test(off1.version) && /\+ www\.officiel-pub-tmt\.fr/.test(fois1) && fra1.liste === 'frauduleux', off1.version);
  verifier('outil : les fichiers publiés ne contiennent ni identifiant de compte ni clé privée', !/TEST_publication|PRIVATE/.test(JSON.stringify(off1) + JSON.stringify(fra1)));
  verifier('outil : refuse la mauvaise phrase de passe', (() => { try { execFileSync('node', ['outils/publier.ts', 'publier', '--export', join(TMP, 'export-1.json'), '--cle', fichierCle, '--sortie', join(TMP, 'x'), '--oui'], { cwd: LISTES, env: { ...process.env, TMT_PHRASE_DE_PASSE: 'une-autre-phrase-de-passe' }, encoding: 'utf8', stdio: 'pipe' }); return false; } catch (e) { return /phrase de passe incorrecte/.test(String(e.stderr)); } })());

  // 5. AUTRE profil de navigateur, build d'essai de publication, vraie popup
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tourmentin-pub-b-')), {
    channel: 'chromium', headless: false,
    args: [`--disable-extensions-except=${DIST_TEST}`, `--load-extension=${DIST_TEST}`, `--remote-debugging-port=${PORT_CDP}`],
  });
  const PAGE = (titre) => `<!doctype html><html><head><title>${titre}</title></head><body><p>${titre}</p><form><input type="password" name="mdp"></form></body></html>`;
  await context.route(`https://${H_REPERTORIE_N1}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: PAGE_N1 }));
  for (const h of [H_OFFICIEL, H_APEX, H_SANS_MARQUE, H_NOUVEAU, H_FAUX, H_AUTRE, 'www.faux-pub-tmt.fr', H_REPERTORIE]) {
    await context.route(`https://${h}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: PAGE('Espace adhérent') }));
  }
  await context.route(`https://${H_N2}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: PAGE_N2 }));
  await context.route(`https://${H_N2_FAIBLE}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: PAGE_N2_FAIBLE }));
  const verdictsConsole = [];
  context.on('console', (m) => { const t = m.text(); if (t.includes('[Tourmentin] verdict')) verdictsConsole.push({ url: m.page()?.url() ?? '', t }); });
  const dernierVerdict = (hote) => verdictsConsole.filter((v) => v.url.includes(hote)).at(-1)?.t.replace(/\s+/g, ' ').slice(0, 160) ?? '(aucun)';
  // page frauduleuse listée SANS champ de saisie : Z1 alerte même sans formulaire (14.37 point 4)
  await context.route('https://sans-champ-pub-tmt.fr/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Article</title><p>Un article sans aucun champ.</p>' }));
  let sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const lireEtat = () => sw.evaluate(async () => (await chrome.storage.local.get('listes_signees')).listes_signees ?? null);
  const attendre = async (cond, ms = 15000) => { const t0 = Date.now(); for (;;) { const e = await lireEtat(); if (cond(e) || Date.now() - t0 > ms) return e; await new Promise((x) => setTimeout(x, 300)); } };
  const declencher = async () => { await sw.evaluate(() => chrome.alarms.create('listes-signees', { when: Date.now() + 200 })); await new Promise((x) => setTimeout(x, 1500)); };

  let etat = await attendre((e) => e?.officiels && e?.frauduleux);
  verifier('autre navigateur : télécharge, vérifie et conserve les deux listes (officiels et frauduleux)', etat?.officiels?.version === off1.version && etat?.frauduleux?.version === fra1.version, JSON.stringify(etat)?.slice(0, 200));
  verifier('autre navigateur : hôtes et marque conservés tels que signés', etat?.officiels?.entrees.some((e) => e.hote === H_OFFICIEL && e.marque === 'impots-gouv') && etat.officiels.entrees.some((e) => e.hote === H_SANS_MARQUE && !e.marque));
  const dernier = journalRequetes.slice(0, 2);
  verifier('requêtes : deux GET exactement, sur les deux chemins fixes, sans paramètre', journalRequetes.length === 2 && dernier.every((q) => q.methode === 'GET' && /^\/(officiels|frauduleux)\.json$/.test(q.url)), journalRequetes.map((q) => q.methode + ' ' + q.url).join(' ; '));
  verifier('requêtes : ni cookie, ni référent, ni en-tête d\'autorisation', dernier.every((q) => !q.entetes.cookie && !q.entetes.referer && !q.entetes.authorization), Object.keys(dernier[0]?.entetes ?? {}).join(','));
  console.log('INFO  en-têtes reçus par l\'hôte des listes : ' + Object.entries(dernier[0]?.entetes ?? {}).map(([k, v]) => `${k}=${String(v).slice(0, 60)}`).join(' ; '));

  // 14.37 point 5 : le téléchargement est indépendant du réglage « Ne jamais envoyer » ; tout le reste de l'essai se déroule sous ce réglage
  await sw.evaluate(async () => { const { reglages = {} } = await chrome.storage.local.get('reglages'); await chrome.storage.local.set({ reglages: { ...reglages, modeEnvoi: 'jamais' } }); });
  const avantJamais = journalRequetes.length;
  await declencher();
  verifier('réglage « Ne jamais envoyer » : le téléchargement des listes se poursuit (14.37 point 5)', journalRequetes.length >= avantJamais + 2, `${journalRequetes.length - avantJamais} requêtes`);

  const ouvrirPopup = async (hote) => {
    const page = await context.newPage();
    await page.goto(`https://${hote}/`);
    await page.waitForTimeout(2000);
    await page.bringToFront();
    const erreur = await sw.evaluate(async () => { try { await chrome.action.openPopup(); return null; } catch (e) { return String(e); } });
    if (erreur) return { page, popup: null, erreur };
    const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${PORT_CDP}`);
    let popup = null;
    for (let i = 0; i < 30 && !popup; i++) { popup = cdp.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('/popup.html')) ?? null; if (!popup) await new Promise((x) => setTimeout(x, 200)); }
    if (!popup) { await cdp.close().catch(() => {}); return { page, popup: null, erreur: 'aucune popup' }; }
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForSelector('#statut', { timeout: 5000 }).catch(() => {});
    await popup.waitForTimeout(500);
    return { page, popup, cdp, erreur: null };
  };
  const statutDe = async (hote, capture, capturePage) => {
    const o = await ouvrirPopup(hote);
    if (!o.popup) { await o.page.close(); return { code: null, texte: '', erreur: o.erreur }; }
    const s = await o.popup.evaluate(() => { const e = document.getElementById('statut'); return { code: e?.dataset.code ?? null, texte: e?.textContent ?? '', couleur: e ? getComputedStyle(e).backgroundColor : null }; });
    s.bandeauFrauduleux = (await o.page.locator('#tourmentin-bandeau-frauduleux').count()) > 0;
    s.bandeauN2 = (await o.page.locator('#tourmentin-bandeau-n2').count()) > 0;
    if (capture) await o.popup.screenshot({ path: join(CAPTURES, capture) });
    await o.cdp.close().catch(() => {});
    if (capturePage) { await o.page.bringToFront(); await o.page.screenshot({ path: join(CAPTURES, capturePage) }); }
    await o.page.close();
    return s;
  };

  let s = await statutDe(H_OFFICIEL, 'publication-officiel-verifie.png');
  verifier('popup : « Site officiel vérifié : Impôts » pour l\'hôte validé dans le back-office', s.code === 'officiel-verifie' && /^Site officiel vérifié : /.test(s.texte), `${s.code} « ${s.texte} »`);
  // 14.44 : les deux verts, côte à côte
  const sR = await statutDe(H_REPERTORIE, 'publication-repertorie.png');
  verifier('popup (14.44) : « Site répertorié par Tourmentin (source publique) » pour l\'hôte importé, vert pâle (distinct du vert)', sR.code === 'repertorie' && sR.texte === 'Site répertorié par Tourmentin (source publique)' && sR.couleur !== s.couleur, `${sR.code} « ${sR.texte} » ${sR.couleur} / validé ${s.couleur}`);
  const sRN1 = await statutDe(H_REPERTORIE_N1);
  verifier('popup (14.44) : un répertorié dont la page imite une marque (N1) n\'affiche PAS le vert pâle : N1 l\'emporte', sRN1.code === 'n1-ressemble', `${sRN1.code} « ${sRN1.texte} »`);
  s = await statutDe(H_SANS_MARQUE);
  verifier('popup : site validé sans marque -> « Site officiel vérifié » sans marque inventée', s.code === 'officiel-verifie' && s.texte === 'Site officiel vérifié', `${s.code} « ${s.texte} »`);
  s = await statutDe(H_APEX);
  verifier('popup : l\'hôte voisin (domaine enregistrable) n\'est PAS vérifié : seul l\'hôte exact validé l\'est', s.code !== 'officiel-verifie', `${s.code} « ${s.texte} »`);
  s = await statutDe(H_AUTRE);
  verifier('popup : un site non validé n\'est pas vérifié', s.code !== 'officiel-verifie', `${s.code}`);
  s = await statutDe(H_FAUX, 'publication-frauduleux-popup.png', 'publication-frauduleux-page.png');
  verifier('popup (14.37 point 4) : « Site frauduleux signalé : quittez cette page » pour l\'hôte confirmé frauduleux', s.code === 'frauduleux-liste' && s.texte === 'Site frauduleux signalé : quittez cette page', `${s.code} « ${s.texte} »`);
  verifier('page (14.37 point 4) : le bandeau rouge est dans la page, et aucun bandeau N2', s.bandeauFrauduleux && !s.bandeauN2);
  s = await statutDe('sans-champ-pub-tmt.fr');
  verifier('hôte listé SANS champ de saisie : alerte et bandeau rouge quand même (Z1 avant Z5)', s.code === 'frauduleux-liste' && s.bandeauFrauduleux, `${s.code}`);
  s = await statutDe('www.faux-pub-tmt.fr');
  verifier('hôte voisin du hôte listé (autre sous-domaine) : non touché', s.code !== 'frauduleux-liste' && !s.bandeauFrauduleux, `${s.code}`);

  // 5 bis. 14.37 point 6 : un hôte validé hors socle qui produit un N2 voit l'alerte N2 l'emporter ; M6 seule, jamais l'exemption totale
  s = await statutDe(H_N2, 'publication-n2-avant-validation.png');
  verifier('point 6 : avant validation, l\'imitation forte donne l\'alerte N2 (référence)', s.code === 'n2-imitation', `${s.code} « ${s.texte} »`);
  const faibleAvant = await statutDe(H_N2_FAIBLE);
  console.log(`INFO  imitation faible, avant validation : popup « ${faibleAvant.code} » ; ${dernierVerdict(H_N2_FAIBLE)}`);
  // 14.47 : un RÉPERTORIÉ ne reçoit pas M6 : la même imitation faible sur un hôte répertorié donne le même verdict que sur un hôte inconnu
  await sup.get('/gestion/import');
  r = await sup.post('/gestion/import', { csrf: sup.csrf(), action: 'importer_saisie', hotes: H_N2_FAIBLE });
  verifier('14.47 : l\'hôte de l\'imitation faible est importé comme répertorié', /<strong>1<\/strong> nouveau/.test(r.texte));
  r = await sup.get('/gestion/export');
  writeFileSync(join(TMP, 'export-rep-faible.json'), r.texte);
  outil('publier', '--export', join(TMP, 'export-rep-faible.json'), '--cle', fichierCle, '--sortie', sortieDossier, '--oui');
  await declencher();
  etat = await lireEtat();
  verifier('14.47 : la liste appliquée porte l\'imitation faible comme répertoriée', !!etat?.officiels?.entrees.some((e) => e.hote === H_N2_FAIBLE && e.statut === 'repertorie'));
  const faibleRep = await statutDe(H_N2_FAIBLE);
  verifier('14.47 : imitation faible sur un hôte RÉPERTORIÉ : même verdict que sur un hôte inconnu (pas de M6, pas de vert pâle)', faibleRep.code === faibleAvant.code && faibleRep.code !== 'repertorie', `inconnu « ${faibleAvant.code} » ; répertorié « ${faibleRep.code} »`);
  await ajouterSite(sup, H_N2, 'officiel', 'impots-gouv');
  await ajouterSite(sup, H_N2_FAIBLE, 'officiel', 'impots-gouv');
  r = await sup.get('/gestion/export');
  writeFileSync(join(TMP, 'export-n2.json'), r.texte);
  outil('publier', '--export', join(TMP, 'export-n2.json'), '--cle', fichierCle, '--sortie', sortieDossier, '--oui');
  await declencher();
  etat = await lireEtat();
  verifier('point 6 : les deux hôtes d\'imitation sont dans la liste signée appliquée, rattachés à une marque du socle', !!etat?.officiels?.entrees.some((e) => e.hote === H_N2 && e.marque === 'impots-gouv') && !!etat.officiels.entrees.some((e) => e.hote === H_N2_FAIBLE));
  s = await statutDe(H_N2, 'publication-n2-apres-validation.png', 'publication-n2-apres-validation-page.png');
  verifier('point 6 : validé hors socle (rattaché à une marque du socle), l\'alerte N2 l\'emporte sur « Site officiel vérifié » (popup et bandeau N2)', s.code === 'n2-imitation' && s.bandeauN2, `${s.code} « ${s.texte} » ; ${dernierVerdict(H_N2)}`);
  const faibleApres = await statutDe(H_N2_FAIBLE, 'publication-faible-apres-validation.png');
  console.log(`INFO  imitation plus faible après validation : popup « ${faibleApres.code} » « ${faibleApres.texte} » ; ${dernierVerdict(H_N2_FAIBLE)}`);
  verifier('14.39 point 1 : validé hors socle, une imitation qui ne passe plus que N1 n affiche PAS « Site officiel vérifié » (N1 l emporte)', faibleApres.code !== 'officiel-verifie' && faibleApres.code === 'n1-ressemble', `${faibleApres.code} « ${faibleApres.texte} »`);

  // 6. contrôles négatifs : signature altérée, mauvais nom, version ancienne
  const baseOff = readFileSync(join(dossierPubli, 'officiels.json'), 'utf8');
  const nb0 = journalRequetes.length;
  const versionAvantNeg = (await lireEtat()).officiels.version;
  const altere = JSON.parse(baseOff); altere.entrees.push({ hote: 'pirate-pub-tmt.fr', valide_le: '2026-10-06' });
  substitution = { 'officiels.json': JSON.stringify(altere) };
  await declencher();
  etat = await lireEtat();
  verifier('négatif : une liste dont le contenu a été ajouté sans nouvelle signature est refusée, l\'ancienne reste', etat?.rejets?.officiels === 'signature' && !etat.officiels.entrees.some((e) => e.hote === 'pirate-pub-tmt.fr') && etat.officiels.version === versionAvantNeg, JSON.stringify(etat?.rejets));
  verifier('négatif : le nouveau téléchargement a bien eu lieu (alarme)', journalRequetes.length > nb0, `${journalRequetes.length - nb0} requêtes`);
  const sigAltere = JSON.parse(baseOff); sigAltere.signature = (sigAltere.signature[0] === '0' ? '1' : '0') + sigAltere.signature.slice(1);
  substitution = { 'officiels.json': JSON.stringify(sigAltere) };
  await declencher();
  etat = await lireEtat();
  verifier('négatif : signature altérée d\'un caractère : refusée', etat?.rejets?.officiels === 'signature');
  substitution = { 'officiels.json': readFileSync(join(dossierPubli, 'frauduleux.json'), 'utf8') };
  await declencher();
  etat = await lireEtat();
  verifier('négatif : le fichier « frauduleux » servi à la place de « officiels » (rejeu sous un autre nom) est refusé', etat?.rejets?.officiels === 'liste', JSON.stringify(etat?.rejets));
  substitution = { 'officiels.json': '{ pas du json' };
  await declencher();
  etat = await lireEtat();
  verifier('négatif : contenu illisible refusé', etat?.rejets?.officiels === 'json');
  s = await statutDe(H_OFFICIEL);
  verifier('négatif : malgré les refus, le site validé reste « officiel vérifié » (liste précédente conservée)', s.code === 'officiel-verifie', s.code ?? '');
  substitution = {};
  await declencher();
  etat = await lireEtat();
  verifier('retour à la normale : la liste authentique est reconnue « identique », le problème est effacé', !etat?.rejets?.officiels && !!etat?.verifieLe?.officiels, JSON.stringify(etat?.rejets));

  // 7. mise à jour : un nouveau site validé (version 2), puis rejeu de la version 1 refusé
  await ajouterSite(sup, H_NOUVEAU, 'officiel', 'caf');
  r = await sup.get('/gestion/export');
  writeFileSync(join(TMP, 'export-2.json'), r.texte);
  const fois2 = outil('publier', '--export', join(TMP, 'export-2.json'), '--cle', fichierCle, '--sortie', sortieDossier, '--oui');
  const off2 = JSON.parse(readFileSync(join(sortieDossier, 'officiels.json'), 'utf8'));
  verifier('outil : publication suivante, version suivante, seule la différence est affichée', /\.\d{3}$/.test(off2.version) && off2.version > off1.version && /\+ nouveau-pub-tmt\.fr/.test(fois2) && !/\+ www\.officiel/.test(fois2), off2.version);
  await declencher();
  etat = await lireEtat();
  verifier('mise à jour : la version 2 est appliquée', etat?.officiels?.version === off2.version && etat.officiels.entrees.some((e) => e.hote === H_NOUVEAU), etat?.officiels?.version);
  s = await statutDe(H_NOUVEAU);
  verifier('popup : le site nouvellement validé est « officiel vérifié » après la mise à jour', s.code === 'officiel-verifie', s.code ?? '');
  substitution = { 'officiels.json': baseOff };
  await declencher();
  etat = await lireEtat();
  verifier('négatif : rejeu de la version 1 (authentique, signée) refusé : pas de retour en arrière', etat?.rejets?.officiels === 'retour-arriere' && etat.officiels.version === off2.version, JSON.stringify(etat?.rejets));
  substitution = {};

  // 8. retrait : le site retiré du back-office disparaît à la publication suivante
  r = await retirerSite(sup, H_OFFICIEL);
  verifier('back-office : site retiré de la base', /Site retiré/.test(r.texte), r.texte.slice(0, 80));
  r = await sup.get('/gestion/export');
  writeFileSync(join(TMP, 'export-3.json'), r.texte);
  const fois3 = outil('publier', '--export', join(TMP, 'export-3.json'), '--cle', fichierCle, '--sortie', sortieDossier, '--oui');
  verifier('outil : le retrait apparaît dans la différence', /− www\.officiel-pub-tmt\.fr/.test(fois3));
  await declencher();
  s = await statutDe(H_OFFICIEL);
  verifier('popup : après publication du retrait, le site n\'est plus « officiel vérifié »', s.code !== 'officiel-verifie', `${s.code}`);

  // 9. page d'options : état des listes
  const opt = await context.newPage();
  const idExt = new URL(sw.url()).host;
  await opt.goto(`chrome-extension://${idExt}/src/options/options.html`);
  await opt.waitForTimeout(800);
  const texteOpt = await opt.locator('#etat-listes').textContent();
  verifier('options : état des listes signées lisible (versions, nombre d\'hôtes)', /officiels : version .*frauduleux : version /.test(texteOpt ?? ''), texteOpt ?? '');
  const info = await opt.locator('#information-listes').textContent();
  verifier('options (14.37 point 5) : le texte de Ph est affiché', (await opt.locator('#information-listes').isVisible()) && info === 'Tourmentin télécharge chaque heure la liste des sites vérifiés. Aucune information vous concernant n\'est envoyée à cette occasion.', info ?? '');
  await opt.screenshot({ path: join(CAPTURES, 'publication-options.png') });
  await context.close();
  context = null;

  // 10. build remis (sans adresse de publication) : aucune requête, aucun état
  const avant = journalRequetes.length;
  const ctx2 = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tourmentin-pub-c-')), { channel: 'chromium', headless: false, args: [`--disable-extensions-except=${DIST_REMIS}`, `--load-extension=${DIST_REMIS}`] });
  const sw2 = ctx2.serviceWorkers()[0] ?? (await ctx2.waitForEvent('serviceworker'));
  await new Promise((x) => setTimeout(x, 6000));
  const alarmes = await sw2.evaluate(async () => (await chrome.alarms.getAll()).map((a) => a.name));
  const etat2 = await sw2.evaluate(async () => (await chrome.storage.local.get('listes_signees')).listes_signees ?? null);
  verifier('build remis (14.37 point 1) : aucune requête vers le serveur local de l\'essai ; il porte l\'alarme horaire vers l\'adresse de production', journalRequetes.length === avant && alarmes.includes('listes-signees'), `${journalRequetes.length - avant} requêtes locales, alarmes ${alarmes.join(',')}`);
  console.log(`INFO  état des listes du build remis (404 attendu tant qu'aucun fichier n'est déposé sur tourmentin.fr/listes/) : ${JSON.stringify(etat2?.rejets ?? etat2)}`);
  await ctx2.close();
} catch (e) {
  echecFatal = e;
  verifier('essai sans exception', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  if (context) await context.close().catch(() => {});
  serveur.close();
  const p = await maint('/purge');
  verifier('données de TEST purgées côté serveur', p.statut === 200, JSON.stringify(p.json?.supprimes ?? p.statut));
}
const echecs = bilan();
process.exit(echecs || echecFatal ? 1 : 0);
