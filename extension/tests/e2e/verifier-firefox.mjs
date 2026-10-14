// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.48 / 14.49 : l'extension dans un VRAI Firefox (WebDriver : geckodriver + selenium-webdriver), build d'essai de publication
// (dist/firefox-publication-test : clé jetable, listes signées servies par un serveur local), pages locales sous des noms d'hôtes
// fictifs (résolus vers 127.0.0.1 par la préférence network.dns.localDomains). Aucune requête vers tourmentin.fr, aucune saisie.
//   TMT_FIREFOX=<firefox.exe> TMT_GECKODRIVER=<geckodriver.exe> node tests/e2e/verifier-firefox.mjs
// Une popup ne s'ouvre pas par programme sous Firefox : la page popup.html est ouverte dans un onglet avec « ?onglet=<id> » (14.48).
import { Builder, Browser, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import http from 'node:http';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const EXT = join(ICI, '..', '..');
const LISTES = join(EXT, '..', 'listes');
const FIREFOX = process.env.TMT_FIREFOX;
const GECKODRIVER = process.env.TMT_GECKODRIVER;
if (!FIREFOX || !GECKODRIVER) throw new Error('TMT_FIREFOX et TMT_GECKODRIVER sont requis');
const PORT_LISTES = 9478;
const PORT_PAGES = 8089;
const PHRASE = 'phrase-d-essai-jetable-pas-un-secret';
const UUID = '11111111-2222-4333-8444-555555555555';
const TMP = mkdtempSync(join(tmpdir(), 'tourmentin-ff-'));
const CAPTURES = process.env.CAPTURES ?? join(tmpdir(), 'tourmentin-captures');
mkdirSync(CAPTURES, { recursive: true });

let echecs = 0;
const verifier = (l, ok, d = '') => { console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${l}${d ? ' — ' + d : ''}`); if (!ok) echecs++; };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- hôtes et pages --------------------------------------------------------------------------------------------------------
const H = { valide: 'www.valide-ff.fr', rep: 'www.rep-ff.fr', faux: 'faux-ff.fr', n2: 'impots-gouv.fr', inconnu: 'exemple-ff.fr', fauxSansChamp: 'sans-champ-ff.fr' };
const PAGE = (t) => `<!doctype html><html><head><title>${t}</title></head><body><p>${t}</p><form><input type="password" name="mdp"></form></body></html>`;
const PAGES = {
  [H.valide]: PAGE('Espace adhérent'), [H.rep]: PAGE('Espace adhérent'), [H.faux]: PAGE('Espace adhérent'), [H.inconnu]: PAGE('Espace adhérent'),
  [H.fauxSansChamp]: '<!doctype html><title>Article</title><p>Un article sans aucun champ.</p>',
  [H.n2]: readFileSync(join(EXT, 'tests', 'pages', 'imitations', '01-impots-gouv.html'), 'utf8'),
};

// ---- clé d'essai, listes signées par l'outil réel -------------------------------------------------------------------------------
const fichierCle = join(TMP, 'cle-essai.json');
const outil = (...args) => execFileSync('node', ['outils/publier.ts', ...args], { cwd: LISTES, env: { ...process.env, TMT_PHRASE_DE_PASSE: PHRASE }, encoding: 'utf8' });
outil('creer-cle', fichierCle);
const cle = JSON.parse(readFileSync(fichierCle, 'utf8'));
const exportJson = {
  version: 1,
  officiels: [
    { hote: H.valide, marque: 'impots-gouv', valide_le: '2026-10-10' },
    { hote: H.rep, marque: null, valide_le: '2026-10-10', statut: 'repertorie' },
  ],
  frauduleux: [{ hote: H.faux, portee: 'hote', confirme_le: '2026-10-10' }, { hote: H.fauxSansChamp, portee: 'hote', confirme_le: '2026-10-10' }],
};
writeFileSync(join(TMP, 'export.json'), JSON.stringify(exportJson));
const sortie = join(TMP, 'publie');
outil('publier', '--export', join(TMP, 'export.json'), '--cle', fichierCle, '--sortie', sortie, '--oui');

const journalListes = [];
const serveurListes = http.createServer((req, res) => {
  journalListes.push({ url: req.url, entetes: { ...req.headers } });
  const nom = (req.url ?? '').replace(/^\//, '');
  if (!['officiels.json', 'frauduleux.json'].includes(nom)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(readFileSync(join(sortie, nom), 'utf8'));
});
const serveurPages = http.createServer((req, res) => {
  const hote = (req.headers.host ?? '').split(':')[0];
  const corps = PAGES[hote];
  if (!corps) { res.writeHead(404).end('hôte inconnu'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(corps);
});
await new Promise((ok) => serveurListes.listen(PORT_LISTES, '127.0.0.1', ok));
await new Promise((ok) => serveurPages.listen(PORT_PAGES, '127.0.0.1', ok));

let driver;
try {
  // ---- build d'essai Firefox (clé jetable, serveur local) -------------------------------------------------------------------------
  execSync('node scripts/build-publication-test.mjs --firefox', { cwd: EXT, stdio: 'ignore', env: { ...process.env, TOURMENTIN_URL_PUBLICATION: `http://127.0.0.1:${PORT_LISTES}/`, TOURMENTIN_CLE_PUBLIQUE_LISTES: cle.publique } });
  const DIST = join(EXT, 'dist', 'firefox-publication-test');
  const manifeste = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
  verifier('manifeste Firefox : scripts d\'arrière-plan (pas de service worker), identifiant gecko, version minimale, mise à jour, données déclarées',
    !!manifeste.background.scripts && !manifeste.background.service_worker && manifeste.browser_specific_settings.gecko.id === 'tourmentin@tourmentin.fr'
    && manifeste.browser_specific_settings.gecko.strict_min_version === '142.0' && manifeste.browser_specific_settings.gecko.update_url === 'https://tourmentin.fr/installer/updates.json'
    && manifeste.browser_specific_settings.gecko.data_collection_permissions.required.includes('browsingActivity') && !manifeste.minimum_chrome_version,
    JSON.stringify(manifeste.browser_specific_settings.gecko).slice(0, 220));
  verifier('web-ext lint : aucune erreur, aucun avertissement', /errors\s+0[\s\S]*warnings\s+0/.test((() => { try { return execSync('npx web-ext lint -s dist/firefox-publication-test --self-hosted', { cwd: EXT, encoding: 'utf8' }); } catch (e) { return String(e.stdout); } })()));

  // ---- Firefox -------------------------------------------------------------------------------------------------------------------------
  const optionsFirefox = new firefox.Options().setBinary(FIREFOX).addArguments('-headless');
  optionsFirefox.setPreference('network.dns.localDomains', Object.values(H).join(','));
  optionsFirefox.setPreference('extensions.webextensions.uuids', JSON.stringify({ 'tourmentin@tourmentin.fr': UUID }));
  optionsFirefox.setPreference('network.proxy.type', 0);
  optionsFirefox.setPreference('privacy.trackingprotection.enabled', false);
  const service = new firefox.ServiceBuilder(GECKODRIVER).addArguments('--allow-system-access');
  driver = await new Builder().forBrowser(Browser.FIREFOX).setFirefoxOptions(optionsFirefox).setFirefoxService(service).build();
  const version = (await driver.getCapabilities()).get('browserVersion');
  console.log(`INFO  Firefox ${version}`);
  const idModule = await driver.installAddon(DIST, true);
  verifier('le module se charge comme extension temporaire (Manifest V3)', idModule === 'tourmentin@tourmentin.fr', String(idModule));
  const base = `moz-extension://${UUID}`;
  await attendre(2500);

  // WebDriver n'a pas le droit de naviguer vers moz-extension:// : l'extension ouvre elle-même son écran de premier lancement à
  // l'installation (onglet que l'on retrouve), puis toute page de l'extension est ouverte par browser.tabs.create depuis cet onglet.
  const principal = await driver.getWindowHandle();
  let ext = null;
  for (let i = 0; i < 20 && !ext; i++) {
    for (const h of await driver.getAllWindowHandles()) {
      await driver.switchTo().window(h);
      if ((await driver.getCurrentUrl()).startsWith(base)) { ext = h; break; }
    }
    if (!ext) await attendre(500);
  }
  verifier("l'écran de premier lancement s'ouvre à l'installation", !!ext && (await driver.getCurrentUrl()).includes('premier-lancement'), ext ? await driver.getCurrentUrl() : 'aucun onglet de l extension');
  const executer = (fn, ...args) => driver.executeAsyncScript(`const cb = arguments[arguments.length - 1]; (${fn.toString()})(...Array.from(arguments).slice(0, -1)).then(cb, (e) => cb({ __erreur: String(e) }));`, ...args);
  // WebDriver ne peut ni naviguer vers moz-extension:// ni exécuter de script dans une page d'extension : l'onglet est ouvert par le
  // contexte « chrome » de Firefox (principal système), puis lu par les commandes d'éléments.
  const ouvrirExt = async (chemin) => {
    const avant = new Set(await driver.getAllWindowHandles());
    await driver.setContext(firefox.Context.CHROME);
    await driver.executeScript('const tab = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); gBrowser.selectedTab = tab;', `${base}${chemin}`);
    await driver.setContext(firefox.Context.CONTENT);
    for (let i = 0; i < 20; i++) {
      const nouveau = (await driver.getAllWindowHandles()).find((h) => !avant.has(h));
      if (nouveau) { await driver.switchTo().window(nouveau); return nouveau; }
      await attendre(300);
    }
    throw new Error('onglet de l extension non ouvert : ' + chemin);
  };
  const ouvrir = async (url) => { await driver.switchTo().newWindow('tab'); await driver.get(url); return driver.getWindowHandle(); };
  await ouvrirExt('/src/options/options.html');
  const options = await driver.getWindowHandle();
  await attendre(1500);

  // 1. arrière-plan vivant (la page des paramètres lui parle au chargement : sans réponse elle affiche une alerte), même construction
  const affichee = await driver.findElement(By.id('versions')).getText();
  verifier('la page des paramètres affiche la version et la construction', affichee.includes(manifeste.version) && affichee.includes(manifeste.version_name), affichee);
  verifier("l'arrière-plan (page d'événements) répond : aucune alerte de service interne", !(await driver.findElement(By.id('alerte-service')).isDisplayed()));

  // 2. listes signées : téléchargement, vérification Ed25519 (WebCrypto de Firefox), état lu dans la page des paramètres
  let etatListes = '';
  for (let i = 0; i < 40; i++) {
    await driver.navigate().refresh();
    await attendre(700);
    etatListes = await driver.findElement(By.id('etat-listes')).getText();
    if (/officiels : version .*frauduleux : version /.test(etatListes)) break;
  }
  verifier('les listes signées sont téléchargées, vérifiées (Ed25519) et appliquées sous Firefox', /officiels : version \d{4}\.\d{2}\.\d{3}, 2 hôte\(s\) \(dont 1 répertoriés\).*frauduleux : version \d{4}\.\d{2}\.\d{3}, 2 hôte\(s\)/.test(etatListes) && !/problème/.test(etatListes), etatListes);
  verifier('requêtes : deux GET, sans cookie ni référent', journalListes.slice(0, 2).length === 2 && journalListes.slice(0, 2).every((q) => !q.entetes.cookie && !q.entetes.referer), journalListes.map((q) => q.url).join(' '));
  verifier('le texte de Ph sur le téléchargement horaire est affiché', /Tourmentin télécharge chaque heure la liste des sites vérifiés/.test(await driver.findElement(By.id('information-listes')).getText()));

  // 3. compatibilité : Ed25519 à clé non exportable en IndexedDB, alarme horaire
  const ed = await driver.findElement(By.id('compat-ed25519'));
  verifier('Ed25519 sous Firefox : signature et vérification valides, clé privée NON exportable, rangée en IndexedDB', (await ed.getAttribute('data-ok')) === 'true', await ed.getText());
  const alarme = await driver.findElement(By.id('compat-alarme')).getText();
  verifier('alarme horaire des listes en place', /planifiée \(toutes les heures\)/.test(alarme), alarme);
  console.log('INFO  navigateur : ' + (await driver.findElement(By.id('compat-navigateur')).getText()).slice(0, 120));

  // 4. pages visitées : script de contenu, bandeaux, statuts par la page popup ouverte dans un onglet
  // un motif de correspondance n'a pas de port : « http://hôte/* » couvre tous les ports
  const motif = (hote) => encodeURIComponent(`http://${hote}/*`);
  const statutDe = async (hote, capture) => {
    const page = await ouvrir(`http://${hote}:${PORT_PAGES}/`);
    await attendre(2500);
    const bandeauFrauduleux = (await driver.findElements(By.id('tourmentin-bandeau-frauduleux'))).length > 0;
    const bandeauN2 = (await driver.findElements(By.id('tourmentin-bandeau-n2'))).length > 0;
    if (capture) { await driver.takeScreenshot().then((png) => writeFileSync(join(CAPTURES, capture), png, 'base64')); }
    await driver.switchTo().window(options);
    const popup = await ouvrirExt(`/src/popup/popup.html?url=${motif(hote)}`);
    await attendre(2500);
    let code = null, texte = '', couleur = '';
    try {
      const e = await driver.findElement(By.id('statut'));
      code = await e.getAttribute('data-code'); texte = await e.getText(); couleur = await e.getCssValue('background-color');
    } catch { texte = '(aucun statut)'; }
    await driver.close();
    await driver.switchTo().window(page);
    await driver.close();
    await driver.switchTo().window(options);
    return { code, texte, couleur, bandeauFrauduleux, bandeauN2 };
  };
  let s = await statutDe(H.valide);
  verifier('page d\'un hôte VALIDÉ : « Site officiel vérifié : Impôts », vert (script de contenu actif sous Firefox)', s.code === 'officiel-verifie' && /Site officiel vérifié : /.test(s.texte), `${s.code} « ${s.texte} » ${s.couleur}`);
  s = await statutDe(H.rep);
  verifier('page d\'un hôte RÉPERTORIÉ : « Site répertorié par Tourmentin (source publique) », vert pâle', s.code === 'repertorie' && /répertorié/.test(s.texte), `${s.code} « ${s.texte} » ${s.couleur}`);
  s = await statutDe(H.faux, 'firefox-frauduleux-page.png');
  verifier('hôte FRAUDULEUX : popup « Site frauduleux signalé : quittez cette page » ET bandeau rouge dans la page', s.code === 'frauduleux-liste' && s.bandeauFrauduleux, `${s.code} « ${s.texte} » bandeau ${s.bandeauFrauduleux}`);
  s = await statutDe(H.fauxSansChamp);
  verifier('hôte frauduleux SANS champ de saisie : alerte et bandeau quand même', s.code === 'frauduleux-liste' && s.bandeauFrauduleux, `${s.code}`);
  s = await statutDe(H.n2, 'firefox-n2-page.png');
  verifier('imitation (hôte inconnu) : alerte « Imitation probable… » ET bandeau N2 dans la page', s.code === 'n2-imitation' && s.bandeauN2, `${s.code} « ${s.texte} » bandeau ${s.bandeauN2}`);
  s = await statutDe(H.inconnu);
  verifier('hôte inconnu avec champ mot de passe : « Site inconnu : prudence »', s.code === 'inconnu-prudence', `${s.code} « ${s.texte} »`);

  // 5. réglages : « Enregistré » à côté du réglage, valeur écrite
  await driver.switchTo().window(options);
  await driver.navigate().refresh();
  await attendre(1500);
  await driver.findElement(By.css('input[name="mode-envoi"][value="jamais"]')).click();
  await attendre(500);
  const enregistre = await driver.findElement(By.id('enregistre-mode-envoi')).getText();
  const reglages = await executer(() => browser.storage.local.get('reglages'));
  verifier('réglage d\'envoi : « Enregistré » affiché et valeur écrite', enregistre === 'Enregistré' && reglages.reglages?.modeEnvoi === 'jamais', `${enregistre} ${JSON.stringify(reglages)}`);
  const etatListes2 = await driver.findElement(By.id('etat-listes')).getText();
  verifier('page des paramètres : état des listes signées', /officiels : version .*frauduleux : version /.test(etatListes2), etatListes2);
  await driver.takeScreenshot().then((png) => writeFileSync(join(CAPTURES, 'firefox-options.png'), png, 'base64'));
  // 6. déclaration locale sous « Ne jamais envoyer » : aperçu puis confirmation (aucun envoi)
  await driver.get(`http://${H.inconnu}:${PORT_PAGES}/`);
  await attendre(2000);
  const page = await driver.getWindowHandle();
  await driver.switchTo().window(options);
  await ouvrirExt(`/src/popup/popup.html?url=${motif(H.inconnu)}`);
  await attendre(2500);
  await driver.findElement(By.id('bouton-officiel')).click();
  await driver.wait(until.elementLocated(By.css('#confirmation button')), 5000);
  const apercu = await driver.findElement(By.id('confirmation')).getText();
  await driver.findElement(By.id('bouton-confirmer')).click();
  await attendre(800);
  const resultat = await driver.findElement(By.id('confirmation')).getText();
  verifier('déclaration « Signaler comme site officiel » sous Firefox : aperçu (« Rien n\'est envoyé ») puis enregistrement local', /Rien n'est envoyé/.test(apercu) && /Il ne sera pas transmis/.test(resultat), resultat.slice(0, 120));
  verifier('aucune requête vers l\'hôte des listes autre que les deux GET de listes', journalListes.every((q) => ['/officiels.json', '/frauduleux.json'].includes(q.url)));
  void principal; void page;
} catch (e) {
  verifier('essai sans exception', false, String(e?.stack ?? e).slice(0, 500));
} finally {
  if (driver) await driver.quit().catch(() => {});
  serveurListes.close();
  serveurPages.close();
}
console.log(echecs === 0 ? 'Tous les contrôles sont conformes.' : `${echecs} échec(s).`);
process.exit(echecs ? 1 : 0);
