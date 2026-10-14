// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.11, points 3 et « ensuite » : deux mesures sur le segment
// socle-affiche déjà constitué (corpus/corpus-connexions.csv), sans deviner :
//
//   a) Collision au niveau termes_faibles — la limite de méthode notée le
//      23/09/2026 (le moteur ne teste que termes_forts) devient mesurable
//      maintenant que le reclassement de 12.3.3.11 y a versé trois termes.
//      Confronte chaque page socle-affiche aux termes_faibles ACTUELS
//      (après reclassement) : marque, terme, hôte — jamais de texte de page.
//   b) Effet du reclassement sur le score d'imitation, page par page : les
//      mêmes pages, revisitées, scorées avec les empreintes d'AVANT
//      (révision 7d4565e, avant 12.3.3.11) puis celles d'APRÈS (état actuel),
//      dans le même contexte de page — pas de différence de réseau ou de
//      minuterie entre les deux mesures.
//
// Les empreintes « avant » sont lues via `git show` (jamais réécrites sur
// disque de façon durable) et embarquées telles quelles dans un bundle
// séparé ; aucun fichier de listes/socle/ n'est modifié par ce script.
//
// Aucune saisie, aucune soumission de formulaire.
//
// À exécuter depuis extension/ : npm run reevaluer-socle-affiche
// Écrit docs/REEVALUATION-SOCLE-AFFICHE-<date>.md.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { decouperLigneCsv } from './csv.mjs';
import { lancerContexteNavigateur } from './navigateur-sans-extension.mjs';
import { FENETRE_FP_MS } from './fenetre-analyse.mjs';
import { armerFiletDeSecurite } from './filet-de-securite.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_PROJET = join(ICI, '..', '..', '..');
const DOSSIER_SOCLE = join(RACINE_PROJET, 'listes', 'socle');
const CORPUS_CONNEXIONS_CSV = join(RACINE_PROJET, 'corpus', 'corpus-connexions.csv');
const DOSSIER_DOCS = join(RACINE_PROJET, 'docs');
const CACHE = join(ICI, '.cache', 'reevaluer-socle-affiche');

// Dernier commit avant le reclassement de 12.3.3.11 (listes/socle/*.json).
const REVISION_AVANT = '7d4565e';
const TIMEOUT_NAVIGATION_MS = 15_000;

const arguments_ = process.argv.slice(2);
const FENETRE = arguments_.includes('--fenetre');

function projeter(brute) {
  return {
    id: brute.id,
    libelle: brute.libelle,
    domaines: brute.domaines,
    termesForts: brute.termes_forts,
    termesFaibles: brute.termes_faibles,
    termesSaisie: brute.termes_saisie,
    faviconHash: brute.favicon_hash ?? [],
    couleurs: brute.couleurs,
    racinesTypo: brute.racines_typo,
    criticite: brute.criticite,
  };
}

function chargerEmpreintesActuelles() {
  return readdirSync(DOSSIER_SOCLE)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(DOSSIER_SOCLE, f), 'utf8')))
    .filter((e) => e.actif)
    .map(projeter);
}

function chargerEmpreintesAvant() {
  const noms = readdirSync(DOSSIER_SOCLE).filter((f) => f.endsWith('.json'));
  return noms
    .map((f) => JSON.parse(execFileSync('git', ['show', `${REVISION_AVANT}:listes/socle/${f}`], { cwd: RACINE_PROJET, encoding: 'utf8' })))
    .filter((e) => e.actif)
    .map(projeter);
}

function chargerPagesSocleAffiche() {
  const lignes = readFileSync(CORPUS_CONNEXIONS_CSV, 'utf8').split('\n').filter((l) => l.trim());
  const entetes = decouperLigneCsv(lignes[0]);
  const idx = (n) => entetes.indexOf(n);
  const rows = lignes.slice(1).map(decouperLigneCsv);
  return rows.filter((r) => r[idx('segment')] === 'socle-affiche').map((r) => ({ hote: r[idx('hote')], url: r[idx('url_finale')] || r[idx('url')] }));
}

/** Entrée bundlée : score + signaux, pour une liste d'empreintes donnée. Jamais de texte de page en sortie. */
function ecrireEntreeScore(nomFichier, empreintes, nomGlobal) {
  const chemin = join(ICI, nomFichier);
  writeFileSync(
    chemin,
    `import { construireEntreeAnalyse } from '../../src/adaptateurs/dom.js';\n` +
      `import { evaluerAxeImitation } from '../../src/moteur/signaux-imitation.js';\n` +
      `const EMPREINTES = ${JSON.stringify(empreintes)};\n` +
      `const CONFIG = { sensibilite: 'equilibre', motsClesPersonnels: [], secretsSurveilles: [] };\n` +
      `(globalThis)['${nomGlobal}'] = () => {\n` +
      `  const entree = construireEntreeAnalyse(document);\n` +
      `  const axe = evaluerAxeImitation(entree, EMPREINTES, CONFIG);\n` +
      `  return { score: axe.score, marqueDetectee: axe.marqueDetectee ?? null, signaux: axe.signaux.map((s) => ({ code: s.code, poids: s.poids, famille: s.famille, detail: s.detail })) };\n` +
      `};\n`,
    'utf8',
  );
  return chemin;
}

/** Entrée bundlée : collisions termes_faibles pour les empreintes actuelles. Marque + terme + rien d'autre en sortie. */
function ecrireEntreeFaibles(nomFichier, empreintes, nomGlobal) {
  const chemin = join(ICI, nomFichier);
  writeFileSync(
    chemin,
    `import { construireEntreeAnalyse } from '../../src/adaptateurs/dom.js';\n` +
      `import { contientTerme, normaliser } from '../../src/moteur/texte.js';\n` +
      `const EMPREINTES = ${JSON.stringify(empreintes)};\n` +
      `(globalThis)['${nomGlobal}'] = () => {\n` +
      `  const entree = construireEntreeAnalyse(document);\n` +
      `  const texte = normaliser(\`\${entree.titre} \${entree.texteVisible}\`);\n` +
      `  return EMPREINTES.map((e) => ({ marque: e.id, termesFaiblesTrouves: e.termesFaibles.filter((t) => contientTerme(texte, t)) })).filter((m) => m.termesFaiblesTrouves.length > 0);\n` +
      `};\n`,
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
      lib: { entry: cheminEntree, formats: ['iife'], name: 'TourmentinReeval', fileName: () => nomFichierSortie },
    },
  });
  return readFileSync(join(CACHE, nomFichierSortie), 'utf8');
}

async function main() {
  armerFiletDeSecurite();
  mkdirSync(CACHE, { recursive: true });

  const pages = chargerPagesSocleAffiche();
  console.log(`${pages.length} page(s) socle-affiche à réévaluer.`);

  console.log(`Empreintes « avant » lues à la révision ${REVISION_AVANT}, empreintes « après » lues sur disque (état actuel).`);
  const empreintesAvant = chargerEmpreintesAvant();
  const empreintesApres = chargerEmpreintesActuelles();

  const cheminAvant = ecrireEntreeScore('entree-score-avant.ts', empreintesAvant, '__tourmentinScoreAvant');
  const cheminApres = ecrireEntreeScore('entree-score-apres.ts', empreintesApres, '__tourmentinScoreApres');
  const cheminFaibles = ecrireEntreeFaibles('entree-faibles-apres.ts', empreintesApres, '__tourmentinFaiblesApres');

  let bundleAvant;
  let bundleApres;
  let bundleFaibles;
  try {
    console.log('Construction des trois bundles (score avant / score après / termes_faibles après)...');
    bundleAvant = await bundlerEntree(cheminAvant, 'score-avant.js');
    bundleApres = await bundlerEntree(cheminApres, 'score-apres.js');
    bundleFaibles = await bundlerEntree(cheminFaibles, 'faibles-apres.js');
  } finally {
    rmSync(cheminAvant, { force: true });
    rmSync(cheminApres, { force: true });
    rmSync(cheminFaibles, { force: true });
  }

  const context = await lancerContexteNavigateur({ fenetre: FENETRE });
  const resultats = [];

  for (const [i, p] of pages.entries()) {
    const page = await context.newPage();
    page.on('dialog', (dialog) => { dialog.dismiss().catch(() => {}); });
    try {
      await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
      await page.waitForTimeout(FENETRE_FP_MS);
      await page.evaluate(bundleAvant);
      await page.evaluate(bundleApres);
      await page.evaluate(bundleFaibles);
      const [scoreAvant, scoreApres, faibles] = await page.evaluate(() => [
        globalThis.__tourmentinScoreAvant(),
        globalThis.__tourmentinScoreApres(),
        globalThis.__tourmentinFaiblesApres(),
      ]);
      resultats.push({ ...p, scoreAvant, scoreApres, faibles });
      console.log(`  [${i + 1}/${pages.length}] ${p.hote} : ${scoreAvant.score} -> ${scoreApres.score}${faibles.length > 0 ? ` (termes faibles : ${faibles.map((f) => `${f.marque}:${f.termesFaiblesTrouves.join('|')}`).join(', ')})` : ''}`);
    } catch (erreur) {
      console.log(`  [${i + 1}/${pages.length}] ${p.hote} — écartée : ${String(erreur?.message ?? erreur).split('\n')[0]}`);
    } finally {
      await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
    }
  }

  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);

  const lignes = [];
  lignes.push(`# Réévaluation du segment socle-affiche après reclassement (12.3.3.11) — ${new Date().toISOString().slice(0, 10)}`);
  lignes.push('');
  lignes.push(
    `${resultats.length}/${pages.length} page(s) socle-affiche revisitées. Score « avant » : empreintes à la révision ` +
      `\`${REVISION_AVANT}\` (avant 12.3.3.11). Score « après » : empreintes actuelles. Mêmes pages, même contexte de page, ` +
      'seule la liste des empreintes change entre les deux appels.',
  );
  lignes.push('');
  lignes.push('## 1. Score d\'imitation, page par page');
  lignes.push('');
  lignes.push('| Hôte | Score avant | Marque avant | Score après | Marque après | Écart |');
  lignes.push('|---|---|---|---|---|---|');
  for (const r of resultats) {
    const ecart = r.scoreApres.score - r.scoreAvant.score;
    lignes.push(
      `| ${r.hote} | ${r.scoreAvant.score} | ${r.scoreAvant.marqueDetectee ?? '—'} | ${r.scoreApres.score} | ${r.scoreApres.marqueDetectee ?? '—'} | ${ecart >= 0 ? '+' : ''}${ecart} |`,
    );
  }
  lignes.push('');
  const seuil = 55;
  const franchissentApres = resultats.filter((r) => r.scoreApres.score >= seuil && r.scoreAvant.score < seuil);
  const quittentApres = resultats.filter((r) => r.scoreAvant.score >= seuil && r.scoreApres.score < seuil);
  lignes.push(
    `Pages franchissant le seuil d'alerte (${seuil}) après reclassement, qui ne le franchissaient pas avant : ${franchissentApres.length}. ` +
      `Pages qui le franchissaient avant et ne le franchissent plus : ${quittentApres.length}.`,
  );
  lignes.push('');
  lignes.push('## 2. Collision au niveau termes_faibles (empreintes actuelles)');
  lignes.push('');
  lignes.push(
    "Le moteur ne teste `termes_faibles` qu'au travers du signal I2 (nombre de termes faibles co-présents, " +
      'pas un simple compte de correspondances) — cette section liste les correspondances individuelles trouvées, ' +
      'indépendamment du seuil I2, pour savoir si la collision constatée sur termes_forts se reproduit au niveau faible.',
  );
  lignes.push('');
  const avecFaibles = resultats.filter((r) => r.faibles.length > 0);
  if (avecFaibles.length === 0) {
    lignes.push('Aucune correspondance de terme faible relevée sur ces pages.');
  } else {
    lignes.push('| Hôte | Marque | Termes faibles trouvés |');
    lignes.push('|---|---|---|');
    for (const r of avecFaibles) {
      for (const f of r.faibles) lignes.push(`| ${r.hote} | ${f.marque} | ${f.termesFaiblesTrouves.join(' \\| ')} |`);
    }
  }
  lignes.push('');

  mkdirSync(DOSSIER_DOCS, { recursive: true });
  const cheminRapport = join(DOSSIER_DOCS, `REEVALUATION-SOCLE-AFFICHE-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(cheminRapport, lignes.join('\n'), 'utf8');
  console.log(`\nRapport écrit : ${cheminRapport}`);
}

main()
  .catch((erreur) => {
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
