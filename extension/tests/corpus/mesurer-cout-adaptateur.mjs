// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.8 : une hypothèse de cause (ici, candidatsHorsFormulaire comme
// origine d'une éventuelle hausse de latence) se vérifie au chronomètre, elle
// ne se déduit pas du chiffre qu'elle est censée expliquer. Ce script
// chronomètre directement construireEntreeAnalyse() — la collecte DOM de
// l'adaptateur, rien d'autre — avant et après le correctif du 12.3.3.7, sur
// les MÊMES pages réelles déjà chargées, pour isoler ce coût de tout le reste
// de la chaîne (réseau, message, moteur).
//
// Méthode : les deux versions de dom.ts (avant = 6ee54b1, avant le correctif ;
// après = HEAD, code actuel) sont bundlées séparément et injectées toutes les
// deux dans la même page déjà chargée et stabilisée (attente du harnais
// écoulée). construireEntreeAnalyse() est appelée R fois de suite pour chaque
// version, dans le même contexte JS, sans navigation ni attente entre les
// deux — la seule variable qui change est le code exécuté.
//
// Aucune saisie, aucune soumission de formulaire.
//
// À exécuter depuis extension/ : npm run mesurer-cout-adaptateur
// Écrit docs/COUT-ADAPTATEUR-<date>.md.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { decouperLigneCsv } from './csv.mjs';
import { lancerContexteNavigateur } from './navigateur-sans-extension.mjs';
import { FENETRE_FP_MS } from './fenetre-analyse.mjs';
import { armerFiletDeSecurite } from './filet-de-securite.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_PROJET = join(ICI, '..', '..', '..');
const DOSSIER_ADAPTATEURS = join(RACINE_PROJET, 'extension', 'src', 'adaptateurs');
const CORPUS_CONNEXIONS_CSV = join(RACINE_PROJET, 'corpus', 'corpus-connexions.csv');
const DOSSIER_DOCS = join(RACINE_PROJET, 'docs');
const CACHE = join(ICI, '.cache', 'cout-adaptateur');

// Commit juste avant 12.3.3.7 (be55545) : dom.ts tel qu'il lisait uniquement
// les <form> réels, sans formulaires implicites ni candidatsHorsFormulaire().
const REVISION_AVANT = '6ee54b1';

const NB_PAGES = 60;
const REPETITIONS_PAR_PAGE = 30;
const TIMEOUT_NAVIGATION_MS = 15_000;

const arguments_ = process.argv.slice(2);
const FENETRE = arguments_.includes('--fenetre');

function chargerEchantillonPages() {
  const lignes = readFileSync(CORPUS_CONNEXIONS_CSV, 'utf8').split('\n').filter((l) => l.trim());
  const entetes = decouperLigneCsv(lignes[0]);
  const idx = (n) => entetes.indexOf(n);
  const toutes = lignes.slice(1).map((l) => decouperLigneCsv(l));
  // Pages de connexion réelles seulement : c'est là que candidatsHorsFormulaire()
  // a le plus de champs à examiner, le cas le plus favorable à l'hypothèse.
  const connexions = toutes.filter((c) => (c[idx('segment')] ?? '').startsWith('connexion'));
  const urls = connexions.map((c) => c[idx('url_finale')] || c[idx('url')]).filter(Boolean);
  return urls.slice(0, NB_PAGES);
}

/** Écrit une copie de dom.ts telle qu'à REVISION_AVANT, dans le même dossier (imports relatifs inchangés). */
function ecrireDomAvant() {
  const contenu = execFileSync('git', ['show', `${REVISION_AVANT}:extension/src/adaptateurs/dom.ts`], {
    cwd: RACINE_PROJET,
    encoding: 'utf8',
  });
  const chemin = join(DOSSIER_ADAPTATEURS, 'dom-avant-12-3-3-7.ts');
  writeFileSync(chemin, contenu, 'utf8');
  return chemin;
}

function ecrireEntree(nomFichier, cheminDom, nomGlobal) {
  const chemin = join(ICI, nomFichier);
  const nomModule = basename(cheminDom).replace(/\.ts$/, '.js');
  writeFileSync(
    chemin,
    `import { construireEntreeAnalyse } from '../../src/adaptateurs/${nomModule}';\n` +
      `(globalThis)['${nomGlobal}'] = construireEntreeAnalyse;\n`,
    'utf8',
  );
  return chemin;
}

async function bundlerEntree(cheminEntree, nomFichierSortie) {
  await build({
    configFile: false,
    logLevel: 'error',
    root: join(ICI, '..', '..'),
    build: {
      outDir: CACHE,
      emptyOutDir: false,
      minify: false,
      lib: { entry: cheminEntree, formats: ['iife'], name: 'TourmentinCout', fileName: () => nomFichierSortie },
    },
  });
  return readFileSync(join(CACHE, nomFichierSortie), 'utf8');
}

function statsDelai(valeurs) {
  if (valeurs.length === 0) return undefined;
  const triees = [...valeurs].sort((a, b) => a - b);
  const percentile = (p) => triees[Math.min(triees.length - 1, Math.ceil((p / 100) * triees.length) - 1)];
  const moyenne = triees.reduce((s, v) => s + v, 0) / triees.length;
  return { n: triees.length, moyenne: Math.round(moyenne * 100) / 100, mediane: percentile(50), p95: percentile(95), max: triees[triees.length - 1] };
}

async function main() {
  armerFiletDeSecurite();
  mkdirSync(CACHE, { recursive: true });

  console.log(`Extraction de dom.ts à la révision ${REVISION_AVANT} (avant 12.3.3.7)...`);
  const cheminDomAvant = ecrireDomAvant();
  const cheminEntreeAvant = ecrireEntree('entree-cout-avant.ts', cheminDomAvant, '__tourmentinCoutAvant');
  const cheminEntreeApres = ecrireEntree(
    'entree-cout-apres.ts',
    join(DOSSIER_ADAPTATEURS, 'dom.ts'),
    '__tourmentinCoutApres',
  );

  let bundleAvant;
  let bundleApres;
  try {
    console.log('Construction des deux bundles (avant / après)...');
    bundleAvant = await bundlerEntree(cheminEntreeAvant, 'cout-avant.js');
    bundleApres = await bundlerEntree(cheminEntreeApres, 'cout-apres.js');
  } finally {
    rmSync(cheminDomAvant, { force: true });
    rmSync(cheminEntreeAvant, { force: true });
    rmSync(cheminEntreeApres, { force: true });
  }

  const urls = chargerEchantillonPages();
  console.log(`${urls.length} page(s) de connexion réelles, ${REPETITIONS_PAR_PAGE} répétitions chacune.`);

  const context = await lancerContexteNavigateur({ fenetre: FENETRE });
  const parPage = [];

  for (const [i, url] of urls.entries()) {
    const page = await context.newPage();
    page.on('dialog', (dialog) => { dialog.dismiss().catch(() => {}); });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
      await page.waitForTimeout(FENETRE_FP_MS);
      await page.evaluate(bundleAvant);
      await page.evaluate(bundleApres);
      const mesure = await page.evaluate(
        ({ repetitions }) => {
          function chronometrer(fn) {
            const durees = [];
            for (let i = 0; i < repetitions; i++) {
              const debut = performance.now();
              fn(document);
              durees.push(performance.now() - debut);
            }
            return durees;
          }
          return {
            avant: chronometrer(globalThis.__tourmentinCoutAvant),
            apres: chronometrer(globalThis.__tourmentinCoutApres),
          };
        },
        { repetitions: REPETITIONS_PAR_PAGE },
      );
      parPage.push({ url, ...mesure });
      console.log(`  [${i + 1}/${urls.length}] ${url}`);
    } catch (erreur) {
      console.log(`  [${i + 1}/${urls.length}] ${url} — écartée : ${String(erreur?.message ?? erreur).split('\n')[0]}`);
    } finally {
      await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
    }
  }

  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);

  const toutesAvant = parPage.flatMap((p) => p.avant);
  const toutesApres = parPage.flatMap((p) => p.apres);
  // Médiane par page : une exécution isolée peut être perturbée par le GC ou
  // un minuteur de page ; la médiane de chaque page lisse ce bruit avant
  // d'agréger, comme pour les autres campagnes de ce script.
  const medianesAvant = parPage.map((p) => [...p.avant].sort((a, b) => a - b)[Math.floor(p.avant.length / 2)]);
  const medianesApres = parPage.map((p) => [...p.apres].sort((a, b) => a - b)[Math.floor(p.apres.length / 2)]);

  const statsAvant = statsDelai(toutesAvant);
  const statsApres = statsDelai(toutesApres);
  const statsMedianesAvant = statsDelai(medianesAvant);
  const statsMedianesApres = statsDelai(medianesApres);

  const lignes = [];
  lignes.push(`# Coût de collecte de l'adaptateur, avant / après 12.3.3.7 — ${new Date().toISOString().slice(0, 10)}`);
  lignes.push('');
  lignes.push(
    `Chronométrage direct de \`construireEntreeAnalyse()\` seule (aucun réseau, aucun message, aucun moteur), ` +
      `sur ${parPage.length} page(s) de connexion réelles, ${REPETITIONS_PAR_PAGE} répétitions par page et par version, ` +
      `les deux versions exécutées dans le même contexte de page déjà chargée. Révision « avant » : \`${REVISION_AVANT}\` ` +
      "(dom.ts tel qu'avant les formulaires implicites). Révision « après » : code actuel.",
  );
  lignes.push('');
  lignes.push('| Version | n (appels) | Moyenne | Médiane | p95 | Max |');
  lignes.push('|---|---|---|---|---|---|');
  const l = (nom, s) => (s ? `| ${nom} | ${s.n} | ${s.moyenne} ms | ${s.mediane} ms | ${s.p95} ms | ${s.max} ms |` : `| ${nom} | — | — | — | — | — |`);
  lignes.push(l('Avant 12.3.3.7 (tous appels)', statsAvant));
  lignes.push(l('Après 12.3.3.7 (tous appels)', statsApres));
  lignes.push('');
  lignes.push('Médiane par page (une valeur par page, lisse le bruit ponctuel de chaque appel) :');
  lignes.push('');
  lignes.push('| Version | n (pages) | Moyenne | Médiane | p95 | Max |');
  lignes.push('|---|---|---|---|---|---|');
  lignes.push(l('Avant 12.3.3.7', statsMedianesAvant));
  lignes.push(l('Après 12.3.3.7', statsMedianesApres));
  lignes.push('');
  if (statsMedianesAvant && statsMedianesApres) {
    const delta = Math.round((statsMedianesApres.mediane - statsMedianesAvant.mediane) * 100) / 100;
    lignes.push(
      `Écart de médiane (par page) : ${delta >= 0 ? '+' : ''}${delta} ms. ` +
        (Math.abs(delta) < 1
          ? "Sous la milliseconde : candidatsHorsFormulaire() n'explique pas un écart de plusieurs dizaines de millisecondes au 95e centile — l'hypothèse est écartée."
          : 'Écart mesurable — à rapprocher des trois répétitions de la campagne de latence avant toute conclusion sur C4.'),
    );
  }
  lignes.push('');

  mkdirSync(DOSSIER_DOCS, { recursive: true });
  const cheminRapport = join(DOSSIER_DOCS, `COUT-ADAPTATEUR-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(cheminRapport, lignes.join('\n'), 'utf8');
  console.log(`\nRapport écrit : ${cheminRapport}`);
  console.log(lignes.join('\n'));
}

main()
  .catch((erreur) => {
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
