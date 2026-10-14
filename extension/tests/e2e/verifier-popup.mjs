// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.20 F, G, I : vérification en navigateur réel des statuts de la popup.
// Playwright n'expose pas la popup comme une page de son contexte : on s'y
// connecte par une seconde connexion CDP (port de débogage local, 127.0.0.1).
// Vrai build (dist/chrome-essai ; dist/chrome-mesure pour le N3), vraie popup
// ouverte par chrome.action.openPopup() — pas la page popup.html ouverte dans
// un onglet, qui résoudrait l'onglet actif à sa propre place. Les pages sont
// servies localement (route) sous leurs vrais noms d'hôte : rien ne sort.
//
// Aucune saisie dans aucune page, aucun champ rempli : les deux seuls clics
// sont ceux de la popup (« Signaler comme site officiel », confirmation).
// Les statuts 2 (exclusion personnelle), 3 (domaine frauduleux) et le statut
// « validé » du 4 ne sont pas reproductibles ici : les listes de révocation,
// d'exclusion et communautaire sont vides dans ce build (chargement.ts).
//
// À exécuter depuis extension/, après `npm run build:chrome` et `npm run build:mesure` :
//   node tests/e2e/verifier-popup.mjs
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..', '..');
const PAGES = join(ICI, '..', 'pages');
const CAPTURES = process.env.CAPTURES ?? join(tmpdir(), 'tourmentin-captures');
mkdirSync(CAPTURES, { recursive: true });

let echecs = 0;
function verifier(libelle, condition, detail = '') {
  console.log(`${condition ? 'OK    ' : 'ÉCHEC '} ${libelle}${detail ? ' — ' + detail : ''}`);
  if (!condition) echecs++;
}

const fichier = (...p) => readFileSync(join(PAGES, ...p), 'utf8');
const PAGE_N2 = `<!doctype html><html><head><title>Espace Particulier</title></head>
<body><p>Espace Particulier — DGFiP, avis d'imposition, taxe d'habitation</p>
<form><input type="password" name="mdp"></form></body></html>`;
const PAGE_PAIEMENT = `<!doctype html><html><head><title>Paiement</title></head>
<body><p>Règlement de votre commande</p><form><input autocomplete="cc-number" name="carte"></form></body></html>`;

// hôte -> corps de la page servie
const SITES = {
  'impots.gouv.fr': '<!doctype html><title>Impôts</title><p>site officiel factice</p>',
  'impots-gouv.fr': PAGE_N2,
  'ameli-secure.fr': fichier('imitations', '02-ameli.html'),
  'portail-etudiant-exemple.fr': fichier('legitimes', '07-portail-etudiant.html'),
  'asso-newsletter-exemple.fr': fichier('legitimes', '04-newsletter.html'),
  'boutique-exemple.fr': PAGE_PAIEMENT,
  'page-sans-champ-exemple.fr': '<!doctype html><title>Article</title><p>Un article sans aucun champ de saisie.</p>',
};

let portSuivant = 9340;
async function lancer(dist) {
  const port = portSuivant++;
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tourmentin-popup-')), {
    channel: 'chromium',
    headless: false,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, `--remote-debugging-port=${port}`],
  });
  for (const [hote, corps] of Object.entries(SITES)) {
    await context.route(`https://${hote}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: corps }));
  }
  await context.route('http://localhost/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>local</title><p>page locale</p>' }));
  await new Promise((r) => setTimeout(r, 2500));
  for (const p of context.pages()) if (p.url().includes('premier-lancement')) await p.close();
  context.portCdp = port;
  return context;
}

// Ouvre la vraie popup de l'action sur l'onglet donné et rend sa page.
async function ouvrirPopup(context, sw, page) {
  await page.bringToFront();
  const erreur = await sw.evaluate(async () => {
    try {
      await chrome.action.openPopup();
      return null;
    } catch (e) {
      return String(e);
    }
  });
  if (erreur) return { popup: null, erreur };
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${context.portCdp}`);
  let popup = null;
  for (let i = 0; i < 30 && !popup; i++) {
    popup = cdp.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('/popup.html')) ?? null;
    if (!popup) await new Promise((r2) => setTimeout(r2, 200));
  }
  if (!popup) { await cdp.close().catch(() => {}); return { popup: null, erreur: 'aucune page de popup apparue' }; }
  popup.connexionCdp = cdp;
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForSelector('#statut, #contenu', { timeout: 5000 }).catch(() => {});
  await popup.waitForTimeout(500);
  return { popup, erreur: null };
}

async function lireStatut(popup) {
  return popup.evaluate(() => {
    const s = document.getElementById('statut');
    const visible = (id) => getComputedStyle(document.getElementById(id)).display !== 'none';
    return {
      code: s?.dataset.code ?? null,
      texte: s?.textContent ?? document.getElementById('contenu').textContent,
      couleur: s ? getComputedStyle(s).backgroundColor : null,
      officiel: visible('bouton-officiel'),
      frauduleuse: visible('bouton-frauduleuse'),
      corps: document.body.innerText,
    };
  });
}

async function cas(context, sw, url, attenduCode, attenduTexte, capture, { officiel, frauduleuse }) {
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForTimeout(2000);
  const { popup, erreur } = await ouvrirPopup(context, sw, page);
  if (!popup) {
    verifier(`${attenduCode} : popup ouverte`, false, erreur);
    await page.close();
    return null;
  }
  const s = await lireStatut(popup);
  verifier(`${attenduCode} : texte « ${attenduTexte} »`, s.texte === attenduTexte, `affiché : « ${s.texte} », couleur ${s.couleur}`);
  verifier(`${attenduCode} : code de statut`, s.code === attenduCode, String(s.code));
  verifier(`${attenduCode} : le niveau N0-N3 et « Motif » n'apparaissent pas`, !/\bN[0-3]\b|Motif/.test(s.corps), s.corps.replace(/\n/g, ' | '));
  verifier(`${attenduCode} : boutons — officiel ${officiel ? 'présent' : 'absent'}, frauduleuse ${frauduleuse ? 'présent' : 'absent'}`,
    s.officiel === officiel && s.frauduleuse === frauduleuse, `officiel=${s.officiel} frauduleuse=${s.frauduleuse}`);
  await popup.screenshot({ path: join(CAPTURES, capture) });
  return { page, popup, s };
}

// --- build d'essai ------------------------------------------------------------
{
  const context = await lancer(join(RACINE, 'dist', 'chrome-essai'));
  const sw = context.serviceWorkers()[0];
  // Ces contrôles portent sur le parcours LOCAL (14.7) : on fixe « Ne jamais envoyer ». Le parcours avec envoi est dans verifier-envoi.mjs.
  await sw.evaluate(async () => { const { reglages = {} } = await chrome.storage.local.get('reglages'); await chrome.storage.local.set({ reglages: { ...reglages, modeEnvoi: 'jamais' } }); });

  const fermer = async (r) => { if (r) { await r.popup.connexionCdp.close().catch(() => {}); await r.page.close().catch(() => {}); } };

  await fermer(await cas(context, sw, 'http://localhost/', 'hors-perimetre', 'Tourmentin ne s\'applique pas à cette page', '1-hors-perimetre.png', { officiel: false, frauduleuse: false }));
  await fermer(await cas(context, sw, 'chrome://version/', 'hors-perimetre', "Tourmentin ne s'applique pas à cette page", '1b-page-interne.png', { officiel: false, frauduleuse: false }));
  await fermer(await cas(context, sw, 'https://impots.gouv.fr/', 'officiel-verifie', 'Site officiel vérifié : Impôts / DGFiP', '4-officiel-verifie.png', { officiel: false, frauduleuse: true }));
  await fermer(await cas(context, sw, 'https://impots-gouv.fr/connexion', 'n2-imitation', 'Imitation probable de Impôts / DGFiP : ne saisissez rien', '5-n2.png', { officiel: true, frauduleuse: true }));
  {
    const n1 = await cas(context, sw, 'https://ameli-secure.fr/', 'n1-ressemble', "Ce site ressemble à Assurance Maladie / ameli, mais ce n'est pas son adresse officielle", '6-n1.png', { officiel: true, frauduleuse: true });
    if (n1) {
      // 14.22 C6 : marque, motif et signaux derrière le lien « Détails », sans niveau.
      const avant = await n1.popup.evaluate(() => ({ present: !!document.getElementById('lien-details'), visible: !document.getElementById('details').hidden }));
      verifier('N1 : lien « Détails » présent, détails repliés', avant.present && !avant.visible, JSON.stringify(avant));
      await n1.popup.click('#lien-details');
      const detail = await n1.popup.evaluate(() => document.getElementById('details').innerText);
      verifier('N1 : « Détails » montre marque, motif et signaux, sans niveau',
        detail.includes('Marque évoquée') && detail.includes('Motif') && detail.includes('Signaux') && !/\bN[0-3]\b/.test(detail), detail.replace(/\n/g, ' | ').slice(0, 200));
      await n1.popup.screenshot({ path: join(CAPTURES, '6b-n1-details.png') });
      await fermer(n1);
    }
  }
  await fermer(await cas(context, sw, 'https://portail-etudiant-exemple.fr/', 'inconnu-prudence', 'Site inconnu : prudence avant de saisir vos informations', '8-inconnu-prudence.png', { officiel: true, frauduleuse: true }));
  await fermer(await cas(context, sw, 'https://boutique-exemple.fr/', 'inconnu-prudence', 'Site inconnu : prudence avant de saisir vos informations', '8b-paiement.png', { officiel: false, frauduleuse: true }));
  await fermer(await cas(context, sw, 'https://asso-newsletter-exemple.fr/', 'non-repertorie', 'Site non répertorié par Tourmentin', '9-non-repertorie.png', { officiel: true, frauduleuse: true }));

  // 7 : le vrai geste. Popup -> « Signaler comme site officiel » -> aperçu -> confirmation.
  const r = await cas(context, sw, 'https://page-sans-champ-exemple.fr/', 'non-repertorie', 'Site non répertorié par Tourmentin', '9b-avant-declaration.png', { officiel: true, frauduleuse: true });
  if (r) {
    await r.popup.click('#bouton-officiel');
    await r.popup.waitForSelector('#bouton-confirmer', { timeout: 3000 }).catch(() => {});
    const apercu = await r.popup.locator('#confirmation').innerText();
    verifier('aperçu : dit que rien n\'est envoyé et montre l\'entrée exacte',
      apercu.includes('Rien n\'est envoyé') && apercu.includes('ce site est un site officiel') && apercu.includes('page-sans-champ-exemple.fr'), apercu.replace(/\n/g, ' | '));
    await r.popup.screenshot({ path: join(CAPTURES, '7a-apercu-declaration.png') });
    const avantConfirmation = await sw.evaluate(async () => ((await chrome.storage.local.get('signalements')).signalements ?? []).length);
    await r.popup.click('#bouton-confirmer');
    await r.popup.waitForTimeout(800);
    const s = await lireStatut(r.popup);
    const entrees = await sw.evaluate(async () => (await chrome.storage.local.get('signalements')).signalements ?? []);
    verifier('rien n\'est écrit avant la confirmation', avantConfirmation === 0, `${avantConfirmation} entrée(s)`);
    verifier('après confirmation : une entrée de type « officiel » dans la file locale', entrees.length === 1 && entrees[0].type === 'officiel' && entrees[0].hote === 'page-sans-champ-exemple.fr', JSON.stringify(entrees[0]));
    verifier('7 : statut (sous « Ne jamais envoyer », fixé par cet essai) « … Il ne sera pas transmis »', s.code === 'declare-en-attente' && s.texte === 'Signalement enregistré sur cet ordinateur. Il ne sera pas transmis (réglage « Ne jamais envoyer »).', `« ${s.texte} »`);
    verifier('7 : « Signaler comme site officiel » disparaît, « Cette page est frauduleuse » reste', !s.officiel && s.frauduleuse);
    await r.popup.screenshot({ path: join(CAPTURES, '7-declare-en-attente.png') });
    await fermer(r);

    // Une déclaration ne fait jamais taire l'alerte : même geste sur une page N2.
    const n2 = await cas(context, sw, 'https://impots-gouv.fr/connexion', 'n2-imitation', 'Imitation probable de Impôts / DGFiP : ne saisissez rien', '5b-n2-avant.png', { officiel: true, frauduleuse: true });
    if (n2) {
      await n2.popup.click('#bouton-officiel');
      await n2.popup.waitForSelector('#bouton-confirmer', { timeout: 3000 }).catch(() => {});
      await n2.popup.click('#bouton-confirmer');
      await n2.popup.waitForTimeout(800);
      const apres = await lireStatut(n2.popup);
      verifier('déclarer « officiel » sur une page N2 ne change pas le statut : l\'alerte reste', apres.code === 'n2-imitation', `« ${apres.texte} »`);
      verifier('… et le bandeau de la page est toujours là', await n2.page.evaluate(() => !!document.getElementById('tourmentin-bandeau-n2')));
      await n2.popup.screenshot({ path: join(CAPTURES, '5c-n2-apres-declaration.png') });
      await fermer(n2);
    }
  }
  await context.close();
}

// --- build de mesure : le N3 ---------------------------------------------------------
{
  const context = await lancer(join(RACINE, 'dist', 'chrome-mesure'));
  await context.route('https://impots-gouv.fr/imitation-n3', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fichier('imitations', '01-impots-gouv.html') }));
  const sw = context.serviceWorkers()[0];
  // Ces contrôles portent sur le parcours LOCAL (14.7) : on fixe « Ne jamais envoyer ». Le parcours avec envoi est dans verifier-envoi.mjs.
  await sw.evaluate(async () => { const { reglages = {} } = await chrome.storage.local.get('reglages'); await chrome.storage.local.set({ reglages: { ...reglages, modeEnvoi: 'jamais' } }); });
  const r = await cas(context, sw, 'https://impots-gouv.fr/imitation-n3', 'n3-imitation', 'Imitation quasi certaine de Impôts / DGFiP : quittez cette page', '10-n3-build-de-mesure.png', { officiel: true, frauduleuse: true });
  if (r) { await r.popup.connexionCdp.close().catch(() => {}); await r.page.close().catch(() => {}); }
  await context.close();
}

console.log(`\nCaptures : ${CAPTURES}`);
console.log(echecs === 0 ? 'Tous les contrôles sont conformes.' : `${echecs} contrôle(s) en échec.`);
process.exit(echecs === 0 ? 0 : 1);
