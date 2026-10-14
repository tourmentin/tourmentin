// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.39 point 4 : écran de premier lancement et description du manifeste, dans le vrai build, en navigateur réel.
//   - le texte validé par Ph est affiché MOT POUR MOT dans le build remis (qui télécharge les listes) ;
//   - il est absent du build de mesure (qui ne télécharge rien) : on ne promet pas ce qui n'a pas lieu ;
//   - la description du manifeste est celle validée ;
//   - aucune promesse « rien n'est envoyé » ne subsiste sur l'écran.
// Aucune saisie, aucun clic. Depuis extension/, après `npm run build:chrome` et `npm run build:mesure` :
//   node tests/e2e/verifier-premier-lancement.mjs
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..', '..');
const CAPTURES = process.env.CAPTURES ?? join(tmpdir(), 'tourmentin-captures');
mkdirSync(CAPTURES, { recursive: true });

const TEXTE_PH = "Pour rester à jour, Tourmentin télécharge chaque heure la liste des sites vérifiés depuis tourmentin.fr. Cette opération n'envoie aucune information sur vous ni sur les pages que vous visitez.";
const DESCRIPTION_PH = 'Repère les imitations de sites officiels français. Vos mots de passe et vos saisies ne quittent jamais votre appareil.';

let echecs = 0;
function verifier(libelle, condition, detail = '') {
  console.log(`${condition ? 'OK    ' : 'ÉCHEC '} ${libelle}${detail ? ' — ' + detail : ''}`);
  if (!condition) echecs++;
}

async function ouvrir(dist, capture) {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tourmentin-pl-')), {
    channel: 'chromium', headless: false, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(sw.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/src/options/options.html#premier-lancement`);
  await page.waitForTimeout(800);
  const texte = await page.locator('#vue-premier-lancement').innerText();
  const visible = await page.locator('#information-listes-premier-lancement').isVisible();
  const contenu = await page.locator('#information-listes-premier-lancement').textContent();
  if (capture) await page.screenshot({ path: join(CAPTURES, capture), fullPage: true });
  await context.close();
  return { texte, visible, contenu };
}

for (const [nom, dossier] of [['chrome-essai', 'build remis'], ['chrome-mesure', 'build de mesure']].map(([a, b]) => [a, b])) {
  const dist = join(RACINE, 'dist', nom);
  const manifeste = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  verifier(`${dossier} : description du manifeste = texte validé par Ph`, manifeste.description === DESCRIPTION_PH, manifeste.description);
  const r = await ouvrir(dist, nom === 'chrome-essai' ? 'premier-lancement.png' : null);
  if (nom === 'chrome-essai') {
    verifier(`${dossier} : le texte de Ph est affiché, mot pour mot`, r.visible && r.contenu === TEXTE_PH, r.contenu ?? '');
  } else {
    verifier(`${dossier} : ne télécharge rien, donc le texte sur le téléchargement n'est pas affiché`, !r.visible);
  }
  verifier(`${dossier} : aucune promesse « rien n'est envoyé » absolue sur l'écran (seulement « rien de ce que vous consultez ou saisissez … sans que vous le décidiez »)`,
    !/Rien n'est (jamais )?envoyé(?! par)/i.test(r.texte.replace(/Rien de ce que vous consultez ou saisissez n'est envoyé/, '')), r.texte.match(/[^.]*envoy[^.]*\./g)?.join(' | ').slice(0, 300));
}
console.log(echecs === 0 ? 'Tous les contrôles sont conformes.' : `${echecs} échec(s).`);
process.exit(echecs ? 1 : 0);
