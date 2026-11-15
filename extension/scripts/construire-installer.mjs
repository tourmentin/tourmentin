#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.48 : fabrique le dossier à déposer sur https://tourmentin.fr/installer/ (dist/installer/), depuis les builds d'essai.
//   - Tourmentin-essai-<version>.zip : dist/chrome-essai, manifest.json à la racine ;
//   - si un .xpi signé existe (dist/signe/*.xpi, produit par signer-firefox.mjs) : copié, et updates.json écrit ;
//   - index.html (statique, indexable, version et date) et .htaccess.
// Refuse si le build est « modifié » (arbre non propre) : on ne remet que ce qui est commité.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ecrireZip } from './ecrire-zip.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS_COMMUN, FAVICON, COURRIEL, entete, pied } from '../../site/identite.mjs';
import { TITRE_CE_QUE_TOURMENTIN_LIT, TEXTE_CE_QUE_TOURMENTIN_LIT } from '../../site/texte-ce-que-tourmentin-lit.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = join(RACINE, 'dist', 'chrome-essai');
const FIREFOX = join(RACINE, 'dist', 'firefox-essai');
const SIGNE = join(RACINE, 'dist', 'signe');
const SORTIE = join(RACINE, 'dist', 'installer');
const BASE = 'https://tourmentin.fr/installer/';
const ID_GECKO = 'tourmentin@tourmentin.fr';

const man = JSON.parse(readFileSync(join(CHROME, 'manifest.json'), 'utf8'));
const manFx = JSON.parse(readFileSync(join(FIREFOX, 'manifest.json'), 'utf8'));
if (man.version !== manFx.version) { console.error(`REFUS : versions différentes (Chrome ${man.version}, Firefox ${manFx.version}) : reconstruire les deux.`); process.exit(1); }
if (/modifié/.test(man.version_name) && !process.argv.includes('--essai')) { console.error('REFUS : le build est « modifié » (arbre non commité).'); process.exit(1); }
for (const d of [CHROME, FIREFOX]) if (!existsSync(join(d, 'LICENSE')) || !existsSync(join(d, 'NOTICE'))) { console.error('REFUS : LICENSE et NOTICE absents du build (14.54) : relancer npm run build.'); process.exit(1); }
const version = man.version;

rmSync(SORTIE, { recursive: true, force: true });
mkdirSync(SORTIE, { recursive: true });

// zip : écrivain du projet (14.59), lisible par l'Explorateur Windows ; le dossier du build devient la racine de l'archive
const nomZip = `Tourmentin-essai-${version}.zip`;
ecrireZip(CHROME, join(SORTIE, nomZip));

// .xpi signé (facultatif)
const xpis = existsSync(SIGNE) ? readdirSync(SIGNE).filter((f) => f.endsWith('.xpi')) : [];
let xpi = null;
for (const f of xpis) {
  const v = f.match(/-(\d+\.\d+\.\d+)\.xpi$/)?.[1];
  if (v === version) xpi = f;
}
const sha = (chemin) => createHash('sha256').update(readFileSync(chemin)).digest('hex');
if (xpi) {
  const nom = `Tourmentin-essai-${version}.xpi`;
  copyFileSync(join(SIGNE, xpi), join(SORTIE, nom));
  const maj = { addons: { [ID_GECKO]: { updates: [{ version, update_link: BASE + nom, update_hash: 'sha256:' + sha(join(SORTIE, nom)) }] } } };
  writeFileSync(join(SORTIE, 'updates.json'), JSON.stringify(maj, null, 2) + '\n');
}

const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const blocFirefox = xpi
  ? `<p><a class="bouton" href="${BASE}Tourmentin-essai-${version}.xpi">Télécharger Tourmentin pour Firefox (version ${version})</a></p>
      <ol>
        <li>Cliquez sur le lien ci-dessus. Firefox demande l'autorisation d'ajouter l'extension : acceptez.</li>
        <li>Une page de Tourmentin s'ouvre : lisez l'avertissement, puis cliquez sur « J'ai compris ».</li>
      </ol>
      <p>Le fichier est signé par Mozilla. Firefox vérifie lui-même les mises à jour une fois par jour environ et installe les nouvelles versions tout seul.</p>`
  : `<p><strong>Bientôt.</strong> Le fichier pour Firefox n'est pas encore disponible : Firefox n'installe que des extensions signées par Mozilla, et la signature n'est pas encore faite. Cette page sera mise à jour.</p>`;

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Installer Tourmentin</title>
<meta name="description" content="Tourmentin repère les imitations de sites officiels français quand vous allez saisir un mot de passe. Installation pas à pas pour Brave, Chrome et Firefox.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${BASE}">
${FAVICON}
<style>${CSS_COMMUN}
  main { max-width: 44rem; margin: 0 auto; padding: 1.5rem 1.25rem 0; }
  h1 { font-size: clamp(1.6rem, 3vw, 2.2rem); line-height: 1.15; margin: 0 0 .5rem; } h2 { font-size: 1.35rem; line-height: 1.2; margin: 2.25rem 0 .6rem; }
  .avert { border-left: 4px solid var(--voile); background: var(--blanc); padding: .8rem 1rem; border-radius: 0 8px 8px 0; box-shadow: 0 1px 0 #DCE4E8; }
  .version { color: var(--brume); margin-top: 0; }
  .bouton { display: inline-block; background: var(--voile); color: var(--mer); font-weight: 700; text-decoration: none; padding: .8rem 1.4rem; border-radius: 6px; }
  .bouton:hover { background: #ff8040; }
  code { font-family: var(--mono); background: #DCE7EB; padding: 0 .3rem; border-radius: 3px; font-size: .95em; }
</style>
</head>
<body>
${entete()}
<main>
<h1>Tourmentin</h1>
<p class="version">Version ${version} — mise en ligne le ${date}.</p>

<p>Tourmentin est une extension de navigateur qui repère les pages imitant un service officiel français (impôts, assurance maladie, banques, La Poste…) au moment où vous allez y saisir un mot de passe. Elle analyse les pages sur votre appareil. Quand une page ressemble à une imitation, elle affiche un bandeau d'alerte ; quand le site est un site officiel vérifié, elle le dit dans sa petite fenêtre.</p>

<div class="avert">
<p><strong>Un outil d'aide, pas une garantie.</strong> Tourmentin est une aide à la vigilance. Il ne vous protège pas à votre place et ne garantit pas que vous ne serez jamais victime d'un piratage, d'un faux site ou d'une arnaque.</p>
<p><strong>Le silence ne veut rien dire.</strong> Si Tourmentin ne dit rien sur une page, cela ne prouve pas que la page est sûre. Son efficacité n'a pas encore été mesurée sur un grand nombre de cas réels.</p>
<p>Un faux site peut lui échapper : un site tout récent que personne n'a encore signalé, une imitation qui ne ressemble pas assez à un service qu'il connaît, un service qu'il ne connaît pas, ou une page conçue pour le tromper. À l'inverse, il peut parfois mettre en garde contre un site légitime.</p>
<p>Tourmentin est gratuit et fourni sans garantie. Il ne remplace pas votre vigilance, et ses auteurs ne s'engagent pas sur le résultat. Vous restez maître de ce que vous saisissez et des sites auxquels vous faites confiance.</p>
</div>

<h2>${TITRE_CE_QUE_TOURMENTIN_LIT}</h2>
<p>${TEXTE_CE_QUE_TOURMENTIN_LIT}</p>

<h2>Installer sur Brave ou Chrome</h2>
<p><a class="bouton" href="${BASE}${nomZip}">Télécharger Tourmentin-essai-${version}.zip</a></p>
<ol>
  <li>Ouvrez le fichier téléchargé et extrayez-le (clic droit, « Extraire tout ») dans un dossier que vous garderez, par exemple <code>Documents\\Tourmentin</code>. Ne le supprimez pas ensuite : le navigateur lit l'extension depuis ce dossier. Le dossier doit contenir directement un fichier <code>manifest.json</code>.</li>
  <li>Dans la barre d'adresse, tapez <code>brave://extensions</code> (Brave) ou <code>chrome://extensions</code> (Chrome).</li>
  <li>Activez le « Mode développeur » (interrupteur en haut à droite).</li>
  <li>Cliquez sur « Charger l'extension non empaquetée » et choisissez le dossier extrait.</li>
  <li>Une page de Tourmentin s'ouvre : lisez l'avertissement, puis cliquez sur « J'ai compris ». Pour garder l'icône sous la main, épinglez-la depuis le menu en puzzle de la barre d'outils.</li>
</ol>
<p>Le navigateur peut afficher un rappel à chaque démarrage disant que des extensions en mode développeur sont actives : c'est normal pour une installation manuelle.</p>
<p>Vérifié sur Brave et Chrome.</p>
<p>Sur Brave, les boucliers peuvent rester activés : Tourmentin fonctionne avec leurs réglages par défaut.</p>

<h2>Installer sur Firefox</h2>
${blocFirefox}

<h2>Mettre à jour</h2>
<p>Sur Firefox, c'est automatique. Sur Brave et Chrome, les extensions chargées à la main ne se mettent pas à jour toutes seules : téléchargez la nouvelle archive sur cette page, extrayez-la dans le même dossier en remplaçant les fichiers, puis ouvrez la page des extensions et cliquez sur la flèche circulaire (↻) de Tourmentin. La version installée est affichée dans les options de Tourmentin ; la version en ligne est indiquée en haut de cette page.</p>

<h2>Ce que Tourmentin envoie, et ce qu'il n'envoie jamais</h2>
<p>Tourmentin analyse les pages sur votre appareil. Rien de ce que vous consultez ou saisissez n'est envoyé sans que vous le décidiez : quand vous déclarez une page (« Cette page est frauduleuse », « Signaler comme site officiel »), Tourmentin vous montre exactement ce qui partirait vers tourmentin.fr — l'adresse sans la partie après « ? » ou « # », la marque évoquée, le texte visible de la page nettoyé des adresses e-mail, numéros de téléphone et IBAN, les adresses de ses images — et n'envoie rien avant votre confirmation. <strong>Jamais ce que vous avez saisi dans les champs.</strong> Vous pouvez désactiver tout envoi dans les options (« Ne jamais envoyer »).</p>
<p>Pour rester à jour, Tourmentin télécharge chaque heure la liste des sites vérifiés depuis tourmentin.fr. Cette opération n'envoie aucune information sur vous ni sur les pages que vous visitez.</p>

<h2>Licence</h2>
<p>Tourmentin est libre (licence AGPL-3.0) : son code est sous licence GNU AGPL version 3 ou ultérieure (AGPL-3.0-or-later). Le texte de la licence est dans le fichier <code>LICENSE</code> de chaque archive. La licence des listes de sites n'est pas encore décidée.</p>

<h2>Signaler un problème</h2>
<p>Pour signaler un problème ou une fausse alerte, écrivez à ${COURRIEL}, ou adressez-vous à la personne qui vous a invité à tester Tourmentin. Dites-lui l'adresse de la page, ce que Tourmentin a affiché, et ce qu'il aurait dû afficher. Ne lui transmettez jamais un mot de passe.</p>
</main>
${pied()}
</body>
</html>
`;
writeFileSync(join(SORTIE, 'index.html'), html, 'utf8');
writeFileSync(join(SORTIE, '.htaccess'), `# BEGIN Tourmentin (14.48) : page d'installation, archives et mises a jour, statiques
Options -Indexes
<IfModule mod_mime.c>
AddType application/x-xpinstall .xpi
AddType application/zip .zip
AddType application/json .json
</IfModule>
<IfModule mod_headers.c>
Header set Cache-Control "no-cache"
</IfModule>
# END Tourmentin
`);
console.log(`dist/installer prêt : version ${version}${xpi ? ', .xpi signé inclus' : ', sans .xpi (non signé)'}`);
for (const f of readdirSync(SORTIE)) console.log('  ', f);
