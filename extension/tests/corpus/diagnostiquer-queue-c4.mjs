// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.13, point 1 : diagnostic de la queue de C4, pas une
// optimisation. Revisite les pages les plus lentes (au-delà du 95e centile,
// delaiPremierVerdictMs dans resultats.jsonl) et un échantillon de
// comparaison, AVEC l'extension chargée (comme harnais.mjs), pour recueillir
// ce que la passe normale ne consigne pas : l'origine du premier verdict
// (initiale / mutation / reanalyse-forcee -- déjà journalisée par le content
// script en production, jamais ajoutée), le poids de la page, le nombre
// d'iframes, le nombre de champs.
//
// Ne modifie ni le code de production ni le seuil de 150 ms. Diagnostic seul.
//
// Aucune saisie, aucune soumission de formulaire.
//
// À exécuter depuis extension/ : npm run diagnostiquer-queue-c4
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { doitBloquerRessource } from './filtrage-ressources.mjs';
import { HOTES_REGIES_PUBLICITAIRES } from './regies-publicitaires.mjs';
import { FENETRE_FP_MS } from './fenetre-analyse.mjs';
import { decouperLigneCsv } from './csv.mjs';
import { traiterEnParallele, formaterDuree } from './pool-concurrent.mjs';
import { armerFiletDeSecurite } from './filet-de-securite.mjs';
import { construireBundleAdaptateur } from './bundle-adaptateur.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_PROJET = join(ICI, '..', '..', '..');
const DIST = join(ICI, '..', '..', 'dist', 'chrome-mesure');
const CORPUS_CSV = join(RACINE_PROJET, 'corpus', 'corpus-legitimes-v3.csv');
const RESULTATS_JSONL = join(ICI, 'resultats.jsonl');
const DOSSIER_DOCS = join(RACINE_PROJET, 'docs');

const TIMEOUT_NAVIGATION_MS = 15_000;
const ATTENTE_ANALYSE_MS = FENETRE_FP_MS;
const N_LENTES = 149;
const N_COMPARAISON = 149;
const GRAINE = 7;
const CONCURRENCE = 4;

function tirerAuHasardSimple(liste, n, graine) {
  const copie = [...liste];
  let etat = graine;
  const alea = () => {
    etat = (etat * 1103515245 + 12345) & 0x7fffffff;
    return etat / 0x7fffffff;
  };
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie.slice(0, n);
}

function chargerCorpus() {
  const lignes = readFileSync(CORPUS_CSV, 'utf8').split('\n').filter((l) => l.trim());
  const entetes = decouperLigneCsv(lignes[0]);
  const idx = (n) => entetes.indexOf(n);
  return new Map(lignes.slice(1).map((l) => {
    const c = decouperLigneCsv(l);
    return [c[idx('hote')], { hote: c[idx('hote')], url: c[idx('url')], segment: c[idx('segment')] }];
  }));
}

function chargerEchantillon() {
  const lignes = readFileSync(RESULTATS_JSONL, 'utf8').split('\n').filter((l) => l.trim());
  const parCle = new Map();
  for (const l of lignes) { const e = JSON.parse(l); parCle.set(e.cle, e); }
  const avecDelai = [...parCle.values()].filter(
    (e) => (e.issue === 'analyse' || e.issue === 'redirection-hors-domaine') && typeof e.delaiPremierVerdictMs === 'number',
  );
  avecDelai.sort((a, b) => b.delaiPremierVerdictMs - a.delaiPremierVerdictMs);
  const lentes = avecDelai.slice(0, N_LENTES);
  const reste = avecDelai.slice(N_LENTES);
  const comparaison = tirerAuHasardSimple(reste, N_COMPARAISON, GRAINE);
  return { lentes, comparaison, total: avecDelai.length };
}

/** Comme analyserUneUrl (harnais.mjs), mais consigne aussi l'origine du premier verdict et le poids/iframes/champs. */
async function analyserAvecDiagnostic(page, url, bundleDiagnostic) {
  const verdicts = [];
  let injectionRecue = false;
  const ecouteur = (msg) => {
    const texte = msg.text();
    if (texte.startsWith('[Tourmentin] injecte')) { injectionRecue = true; return; }
    const correspondance = texte.match(/^\[Tourmentin\] verdict origine=(\S+) :/);
    if (!correspondance) return;
    const arg = msg.args()[1];
    if (arg) verdicts.push({ tempsMs: performance.now(), origine: correspondance[1], promesse: arg.jsonValue().catch(() => undefined) });
  };
  page.on('console', ecouteur);

  const debut = performance.now();
  let issue = 'analyse';
  let finNavigationMs;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
    finNavigationMs = performance.now();
  } catch (erreur) {
    issue = 'non-joignable';
  }
  if (issue === 'analyse') await page.waitForTimeout(ATTENTE_ANALYSE_MS);
  page.off('console', ecouteur);

  const resolus = (await Promise.all(verdicts.map(async (v) => ({ tempsMs: v.tempsMs, origine: v.origine, verdict: await v.promesse }))))
    .filter((r) => r.verdict !== undefined);
  const premier = resolus[0];
  if (issue !== 'analyse' || !premier || finNavigationMs === undefined) {
    return { issue: issue === 'analyse' ? (injectionRecue ? 'verdict-tardif' : 'sans-injection') : issue };
  }
  const delaiPremierVerdictMs = Math.round(premier.tempsMs - finNavigationMs);

  // Diagnostic structurel : poids de page (Performance API), iframes
  // (Playwright natif), champs (bundle de l'adaptateur, même code que la
  // production). Postérieur au verdict réel : n'influence pas sa mesure.
  let poidsOctets;
  let nbChamps;
  try {
    poidsOctets = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const ressources = performance.getEntriesByType('resource');
      const poidsNav = nav && 'transferSize' in nav ? nav.transferSize : 0;
      return ressources.reduce((s, r) => s + (r.transferSize || 0), poidsNav);
    });
  } catch { /* page instable après le verdict : diagnostic incomplet, pas une erreur */ }
  const nbIframes = page.frames().length - 1;
  try {
    await page.evaluate(bundleDiagnostic);
    nbChamps = await page.evaluate(() => {
      const e = globalThis.__tourmentinEntree();
      return e.formulaires.reduce((n, f) => n + f.champs.length, 0);
    });
  } catch { /* idem */ }

  return {
    issue: 'analyse',
    origineDuPremier: premier.origine,
    delaiPremierVerdictMs,
    poidsOctets,
    nbIframes,
    nbChamps,
  };
}

async function verifierExtensionChargee(context) {
  const debut = performance.now();
  while (performance.now() - debut < 10_000) {
    if (context.serviceWorkers().some((s) => s.url().includes('service-worker-loader'))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function statsNombre(valeurs) {
  const v = valeurs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (v.length === 0) return undefined;
  const triees = [...v].sort((a, b) => a - b);
  const somme = v.reduce((s, x) => s + x, 0);
  return { n: v.length, moyenne: Math.round(somme / v.length), mediane: triees[Math.floor(triees.length / 2)] };
}

function correlationPearson(xs, ys) {
  const paires = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y));
  const n = paires.length;
  if (n < 3) return undefined;
  const mx = paires.reduce((s, [x]) => s + x, 0) / n;
  const my = paires.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (const [x, y] of paires) {
    const dx = x - mx, dy = y - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return { n, r: denom === 0 ? 0 : num / denom };
}

async function main() {
  armerFiletDeSecurite();
  const corpus = chargerCorpus();
  const { lentes, comparaison, total } = chargerEchantillon();
  console.log(`Échantillon : ${lentes.length} lente(s) (au-delà du 95e centile, sur ${total} pages avec délai), ${comparaison.length} de comparaison.`);

  console.log("Construction du bundle de l'adaptateur DOM de l'extension...");
  const bundleDiagnostic = await construireBundleAdaptateur();

  const userDataDir = mkdtempSync(join(tmpdir(), 'tourmentin-diag-c4-'));
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
  if (!chargee) { console.error("L'extension ne s'est pas chargée."); await context.close(); process.exitCode = 1; return; }

  await context.route('**/*', (route) => {
    const requete = route.request();
    let hote = '';
    try { hote = new URL(requete.url()).hostname; } catch { /* data:, blob:... */ }
    if (doitBloquerRessource(hote, requete.resourceType(), HOTES_REGIES_PUBLICITAIRES)) void route.abort();
    else void route.continue();
  });

  const ensemble = [...lentes.map((e) => ({ ...e, groupe: 'lente' })), ...comparaison.map((e) => ({ ...e, groupe: 'comparaison' }))];
  const resultats = [];
  await traiterEnParallele(
    context,
    ensemble,
    CONCURRENCE,
    async (page, entree) => {
      const ligne = corpus.get(entree.hote);
      if (!ligne) return;
      const r = await analyserAvecDiagnostic(page, ligne.url, bundleDiagnostic);
      resultats.push({ hote: entree.hote, segment: ligne.segment, groupe: entree.groupe, delaiPasseNormale: entree.delaiPremierVerdictMs, ...r });
    },
    { surProgression: ({ termines, restants, ecouleS }) => console.log(`  ${termines} traité(s), ${restants} restant(s), écoulé ${formaterDuree(ecouleS)}.`) },
  );

  await context.close();

  const exploitables = resultats.filter((r) => r.issue === 'analyse');
  const lentesR = exploitables.filter((r) => r.groupe === 'lente');
  const comparaisonR = exploitables.filter((r) => r.groupe === 'comparaison');

  const parOrigineLentes = {};
  for (const r of lentesR) parOrigineLentes[r.origineDuPremier] = (parOrigineLentes[r.origineDuPremier] ?? 0) + 1;
  const parOrigineComparaison = {};
  for (const r of comparaisonR) parOrigineComparaison[r.origineDuPremier] = (parOrigineComparaison[r.origineDuPremier] ?? 0) + 1;

  const tousDelais = exploitables.map((r) => r.delaiPasseNormale);
  const correlPoids = correlationPearson(exploitables.map((r) => r.poidsOctets), tousDelais);
  const correlIframes = correlationPearson(exploitables.map((r) => r.nbIframes), tousDelais);
  const correlChamps = correlationPearson(exploitables.map((r) => r.nbChamps), tousDelais);

  const lignes = [];
  lignes.push(`# Diagnostic de la queue de C4 — ${new Date().toISOString().slice(0, 10)}`);
  lignes.push('');
  lignes.push(
    `Diagnostic seul (12.3.3.13) : ${lentesR.length} page(s) « lentes » (au-delà du 95e centile de la passe du ` +
      `23/09, delaiPremierVerdictMs > 334 ms) revisitées avec l'extension réelle, contre ${comparaisonR.length} page(s) ` +
      "de comparaison tirées au hasard parmi le reste. Aucun code d'optimisation touché, le budget de 150 ms n'est pas rediscuté ici.",
  );
  lignes.push('');
  lignes.push('## 1. Origine du premier verdict — le point discriminant du débounce de 300 ms');
  lignes.push('');
  lignes.push('| Origine | Pages lentes | Part | Pages de comparaison | Part |');
  lignes.push('|---|---|---|---|---|');
  for (const origine of ['initiale', 'mutation', 'reanalyse-forcee']) {
    const nL = parOrigineLentes[origine] ?? 0;
    const nC = parOrigineComparaison[origine] ?? 0;
    lignes.push(
      `| ${origine} | ${nL} | ${lentesR.length ? ((100 * nL) / lentesR.length).toFixed(0) : '—'} % | ${nC} | ${comparaisonR.length ? ((100 * nC) / comparaisonR.length).toFixed(0) : '—'} % |`,
    );
  }
  lignes.push('');
  lignes.push(
    "Le content script journalise l'origine du verdict en production, sur toutes les pages, sans instrumentation " +
      "ajoutée : ce diagnostic ne fait que la relire. Un débounce de 300 ms suit toute analyse déclenchée par une " +
      "mutation du DOM (12.3.1.3) — si les pages lentes sont majoritairement en « mutation », le débounce, pas la " +
      "collecte ni le moteur, porte une partie significative de la queue.",
  );
  lignes.push('');
  lignes.push('## 2. Corrélation avec le poids de la page, les iframes, les champs');
  lignes.push('');
  lignes.push('| Facteur | n | Corrélation de Pearson avec le délai |');
  lignes.push('|---|---|---|');
  lignes.push(`| Poids de la page (octets transférés) | ${correlPoids?.n ?? '—'} | ${correlPoids ? correlPoids.r.toFixed(2) : '—'} |`);
  lignes.push(`| Nombre d'iframes | ${correlIframes?.n ?? '—'} | ${correlIframes ? correlIframes.r.toFixed(2) : '—'} |`);
  lignes.push(`| Nombre de champs | ${correlChamps?.n ?? '—'} | ${correlChamps ? correlChamps.r.toFixed(2) : '—'} |`);
  lignes.push('');
  const statsP = (groupe) => statsNombre(groupe.map((r) => r.poidsOctets));
  const statsI = (groupe) => statsNombre(groupe.map((r) => r.nbIframes));
  const statsC = (groupe) => statsNombre(groupe.map((r) => r.nbChamps));
  lignes.push('| Groupe | Poids médian | Iframes médian | Champs médian |');
  lignes.push('|---|---|---|---|');
  const sPL = statsP(lentesR), sIL = statsI(lentesR), sCL = statsC(lentesR);
  const sPC = statsP(comparaisonR), sIC = statsI(comparaisonR), sCC = statsC(comparaisonR);
  lignes.push(`| Lentes | ${sPL ? `${Math.round(sPL.mediane / 1024)} Ko` : '—'} | ${sIL?.mediane ?? '—'} | ${sCL?.mediane ?? '—'} |`);
  lignes.push(`| Comparaison | ${sPC ? `${Math.round(sPC.mediane / 1024)} Ko` : '—'} | ${sIC?.mediane ?? '—'} | ${sCC?.mediane ?? '—'} |`);
  lignes.push('');
  lignes.push('## 3. Ce que les pages lentes ont en commun — relevé qualitatif');
  lignes.push('');
  const parSegment = {};
  for (const r of lentesR) parSegment[r.segment] = (parSegment[r.segment] ?? 0) + 1;
  lignes.push('Répartition par segment du corpus :');
  lignes.push('');
  lignes.push('| Segment | Pages lentes |');
  lignes.push('|---|---|');
  for (const [seg, n] of Object.entries(parSegment).sort((a, b) => b[1] - a[1])) lignes.push(`| ${seg} | ${n} |`);
  lignes.push('');
  lignes.push('Dix pages lentes les plus extrêmes (delaiPremierVerdictMs de la passe du 23/09, origine de cette repasse) :');
  lignes.push('');
  lignes.push('| Hôte | Délai (passe du 23/09) | Origine (cette repasse) | Poids | Iframes | Champs |');
  lignes.push('|---|---|---|---|---|---|');
  for (const r of [...lentesR].sort((a, b) => b.delaiPasseNormale - a.delaiPasseNormale).slice(0, 10)) {
    lignes.push(`| ${r.hote} | ${r.delaiPasseNormale} ms | ${r.origineDuPremier} | ${r.poidsOctets ? `${Math.round(r.poidsOctets / 1024)} Ko` : '—'} | ${r.nbIframes ?? '—'} | ${r.nbChamps ?? '—'} |`);
  }
  lignes.push('');
  lignes.push(
    "Note de méthode : cette repasse mesure l'origine et les facteurs structurels au moment de la repasse, pas au " +
      'moment exact de la passe du 23/09 — une page peut avoir changé entre les deux (contenu dynamique, publicité, ' +
      "cache). Le classement lente/comparaison, lui, reste celui de la mesure originale.",
  );
  lignes.push('');

  mkdirSync(DOSSIER_DOCS, { recursive: true });
  const chemin = join(DOSSIER_DOCS, `DIAGNOSTIC-QUEUE-C4-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(chemin, lignes.join('\n'), 'utf8');
  console.log(`\nRapport écrit : ${chemin}`);
  console.log(`Origine (lentes) : ${JSON.stringify(parOrigineLentes)}`);
  console.log(`Origine (comparaison) : ${JSON.stringify(parOrigineComparaison)}`);
}

main()
  .catch((erreur) => { console.error(erreur); process.exitCode = 1; })
  .finally(() => process.exit());
