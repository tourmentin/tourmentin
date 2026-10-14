// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.13 / 12.3.3.18, point 5 : le seul maillon de la chaîne encore
// non chronométré -- le round-trip chrome.runtime.sendMessage et le réveil
// du service worker après ses 30 s d'inactivité (règle 7 de CLAUDE.md). Ne
// touche à aucun code de production (ni content script, ni service worker) :
// mesure en boîte noire, par comparaison de deux conditions sur la même
// page locale, servie hors réseau (page.route()) pour ne faire varier que
// l'état du service worker.
//
//   chaud : la page précédente vient de fermer, le service worker a reçu un
//           message il y a moins de 30 s -- ne devrait pas se réveiller.
//   froid : 32 s d'inactivité totale du contexte avant d'ouvrir la page --
//           le service worker a dépassé son délai d'inactivité et doit se
//           relancer avant de répondre au premier message.
//
// Si le délai du premier verdict diffère nettement entre les deux
// conditions, le réveil du service worker porte une partie de la queue de
// C4. Sinon, l'hypothèse est écartée comme les précédentes (12.3.3.13).
//
// Aucune saisie, aucune soumission de formulaire.
//
// À exécuter depuis extension/ : node tests/corpus/mesurer-reveil-service-worker.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { doitBloquerRessource } from './filtrage-ressources.mjs';
import { HOTES_REGIES_PUBLICITAIRES } from './regies-publicitaires.mjs';
import { armerFiletDeSecurite } from './filet-de-securite.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_PROJET = join(ICI, '..', '..', '..');
const DIST = join(ICI, '..', '..', 'dist', 'chrome-mesure');
const DOSSIER_DOCS = join(RACINE_PROJET, 'docs');

const URL_TEST = 'https://tourmentin-diagnostic-local.test/page-neutre';
const PAGE_NEUTRE = '<!DOCTYPE html><html><head><title>Page neutre de diagnostic</title></head><body><p>Contenu sans rapport, aucune marque, aucun formulaire.</p></body></html>';

const DELAI_INACTIVITE_MS = 32_000; // > 30 s (règle 7 de CLAUDE.md)
const FENETRE_ATTENTE_VERDICT_MS = 5_000;
const N_PAIRES = 15; // 15 chaud + 15 froid, alternés

async function verifierExtensionChargee(context) {
  const debut = performance.now();
  while (performance.now() - debut < 10_000) {
    if (context.serviceWorkers().some((s) => s.url().includes('service-worker-loader'))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function mesurerUnPassage(context) {
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.route(URL_TEST, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE_NEUTRE }));

  const verdicts = [];
  const ecouteur = (msg) => {
    const texte = msg.text();
    if (!texte.startsWith('[Tourmentin] verdict')) return;
    const arg = msg.args()[1];
    if (arg) verdicts.push({ tempsMs: performance.now(), promesse: arg.jsonValue().catch(() => undefined) });
  };
  page.on('console', ecouteur);

  let finNavigationMs;
  try {
    await page.goto(URL_TEST, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    finNavigationMs = performance.now();
    await page.waitForTimeout(FENETRE_ATTENTE_VERDICT_MS);
  } finally {
    page.off('console', ecouteur);
    await page.unroute(URL_TEST).catch(() => {});
    await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 8_000))]);
  }

  const resolus = (await Promise.all(verdicts.map(async (v) => ({ tempsMs: v.tempsMs, verdict: await v.promesse })))).filter((r) => r.verdict !== undefined);
  const premier = resolus[0];
  if (!premier) return { issue: 'sans-verdict' };
  return { issue: 'mesure', delaiPremierVerdictMs: Math.round(premier.tempsMs - finNavigationMs) };
}

function statsDelai(valeurs) {
  if (valeurs.length === 0) return undefined;
  const triees = [...valeurs].sort((a, b) => a - b);
  const percentile = (p) => triees[Math.min(triees.length - 1, Math.ceil((p / 100) * triees.length) - 1)];
  return { n: triees.length, mediane: percentile(50), p95: percentile(95), max: triees[triees.length - 1], min: triees[0] };
}

async function main() {
  armerFiletDeSecurite();

  const userDataDir = mkdtempSync(join(tmpdir(), 'tourmentin-reveil-sw-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--mute-audio',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-features=Translate,MediaRouter,OptimizationHints,AcceptCHFrame',
    ],
  });

  const chargee = await verifierExtensionChargee(context);
  if (!chargee) {
    console.error("L'extension ne s'est pas chargée.");
    await context.close();
    process.exitCode = 1;
    return;
  }

  await context.route('**/*', (route) => {
    const requete = route.request();
    if (requete.url() === URL_TEST) { void route.continue(); return; }
    let hote = '';
    try { hote = new URL(requete.url()).hostname; } catch { /* data:, blob:... */ }
    if (doitBloquerRessource(hote, requete.resourceType(), HOTES_REGIES_PUBLICITAIRES)) void route.abort();
    else void route.continue();
  });

  const chauds = [];
  const froids = [];

  console.log(`${N_PAIRES} paire(s) chaud/froid, ${DELAI_INACTIVITE_MS / 1000} s d'inactivité pour la condition froide.`);

  // Un premier passage « perdu » pour laisser le service worker s'installer
  // et se stabiliser avant la première mesure.
  await mesurerUnPassage(context);

  for (let i = 0; i < N_PAIRES; i++) {
    const chaud = await mesurerUnPassage(context);
    if (chaud.issue === 'mesure') chauds.push(chaud.delaiPremierVerdictMs);
    console.log(`  [${i + 1}/${N_PAIRES}] chaud : ${chaud.issue === 'mesure' ? `${chaud.delaiPremierVerdictMs} ms` : chaud.issue}`);

    await new Promise((r) => setTimeout(r, DELAI_INACTIVITE_MS));

    const froid = await mesurerUnPassage(context);
    if (froid.issue === 'mesure') froids.push(froid.delaiPremierVerdictMs);
    console.log(`  [${i + 1}/${N_PAIRES}] froid (après ${DELAI_INACTIVITE_MS / 1000} s d'inactivité) : ${froid.issue === 'mesure' ? `${froid.delaiPremierVerdictMs} ms` : froid.issue}`);
  }

  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);

  const statsChaud = statsDelai(chauds);
  const statsFroid = statsDelai(froids);

  const lignes = [];
  lignes.push(`# Réveil du service worker : chronométrage direct — ${new Date().toISOString().slice(0, 10)}`);
  lignes.push('');
  lignes.push(
    `Spec 12.3.3.13/12.3.3.18, point 5. Même page locale (hors réseau, page.route()), ${N_PAIRES} paires chaud/froid. ` +
      "« chaud » : la mesure précédente vient de se terminer (< 5 s). « froid » : " +
      `${DELAI_INACTIVITE_MS / 1000} s d'inactivité totale du contexte avant la mesure, au-delà des 30 s d'arrêt du ` +
      "service worker (règle 7 de CLAUDE.md). Aucun code de production modifié.",
  );
  lignes.push('');
  lignes.push('| Condition | n | Médiane | p95 | Min | Max |');
  lignes.push('|---|---|---|---|---|---|');
  const l = (nom, s) => (s ? `| ${nom} | ${s.n} | ${s.mediane} ms | ${s.p95} ms | ${s.min} ms | ${s.max} ms |` : `| ${nom} | 0 | — | — | — | — |`);
  lignes.push(l('Chaud', statsChaud));
  lignes.push(l('Froid (après 32 s d\'inactivité)', statsFroid));
  lignes.push('');
  if (statsChaud && statsFroid) {
    const deltaMediane = statsFroid.mediane - statsChaud.mediane;
    lignes.push(
      `**Écart de médiane, froid moins chaud : ${deltaMediane >= 0 ? '+' : ''}${deltaMediane} ms.** ` +
        (deltaMediane > 20
          ? "Écart net : le réveil du service worker porte une partie mesurable de la latence, l'hypothèse de 12.3.3.13 est confirmée."
          : "Écart faible ou nul : le réveil du service worker n'explique pas la queue de C4, l'hypothèse est écartée comme les précédentes (débounce, poids de page, iframes, champs)."),
    );
  }
  lignes.push('');

  mkdirSync(DOSSIER_DOCS, { recursive: true });
  const chemin = join(DOSSIER_DOCS, `REVEIL-SERVICE-WORKER-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(chemin, lignes.join('\n'), 'utf8');
  console.log(`\nRapport écrit : ${chemin}`);
  console.log(`Chaud : médiane ${statsChaud?.mediane ?? '—'} ms, p95 ${statsChaud?.p95 ?? '—'} ms (n=${chauds.length})`);
  console.log(`Froid : médiane ${statsFroid?.mediane ?? '—'} ms, p95 ${statsFroid?.p95 ?? '—'} ms (n=${froids.length})`);
}

main()
  .catch((erreur) => { console.error(erreur); process.exitCode = 1; })
  .finally(() => process.exit());
