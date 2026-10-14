// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.12/13, point 4 : ferme la question ARE ouverte en 12.6 en
// conservant 40 caractères de contexte (20 avant, 20 après, texte normalisé
// comme le moteur le compare) autour de chaque correspondance termes_faibles
// sur les pages socle-affiche. Portée volontairement étroite : uniquement ce
// qu'il faut pour trancher « mot réel » contre « sous-chaîne », jamais le
// texte entier de la page, et seulement pour ce diagnostic ponctuel -- pas
// une pratique généralisée au reste des scripts de corpus.
//
// Aucune saisie, aucune soumission de formulaire.
//
// À exécuter depuis extension/ : node tests/corpus/recenser-contexte-are.mjs
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
const CACHE = join(ICI, '.cache', 'contexte-are');
const TIMEOUT_NAVIGATION_MS = 15_000;

function projeter(brute) {
  return {
    id: brute.id, libelle: brute.libelle, domaines: brute.domaines,
    termesForts: brute.termes_forts, termesFaibles: brute.termes_faibles,
    termesSaisie: brute.termes_saisie, faviconHash: brute.favicon_hash ?? [],
    couleurs: brute.couleurs, racinesTypo: brute.racines_typo, criticite: brute.criticite,
  };
}

function chargerEmpreintesActuelles() {
  return readdirSync(DOSSIER_SOCLE).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(DOSSIER_SOCLE, f), 'utf8')))
    .filter((e) => e.actif).map(projeter);
}

function chargerPagesSocleAffiche() {
  const lignes = readFileSync(CORPUS_CONNEXIONS_CSV, 'utf8').split('\n').filter((l) => l.trim());
  const entetes = decouperLigneCsv(lignes[0]);
  const idx = (n) => entetes.indexOf(n);
  const rows = lignes.slice(1).map(decouperLigneCsv);
  return rows.filter((r) => r[idx('segment')] === 'socle-affiche').map((r) => ({ hote: r[idx('hote')], url: r[idx('url_finale')] || r[idx('url')] }));
}

function ecrireEntreeContexte(nomFichier, empreintes, nomGlobal) {
  const chemin = join(ICI, nomFichier);
  writeFileSync(
    chemin,
    "import { construireEntreeAnalyse } from '../../src/adaptateurs/dom.js';\n" +
      "import { normaliser } from '../../src/moteur/texte.js';\n" +
      `const EMPREINTES = ${JSON.stringify(empreintes)};\n` +
      `(globalThis)['${nomGlobal}'] = () => {\n` +
      '  const entree = construireEntreeAnalyse(document);\n' +
      '  const texte = normaliser(`${entree.titre} ${entree.texteVisible}`);\n' +
      '  const resultats = [];\n' +
      '  for (const e of EMPREINTES) {\n' +
      '    for (const terme of e.termesFaibles) {\n' +
      '      const t = normaliser(terme);\n' +
      '      let depart = 0;\n' +
      '      let i;\n' +
      '      while ((i = texte.indexOf(t, depart)) !== -1) {\n' +
      '        const debut = Math.max(0, i - 20);\n' +
      '        const fin = Math.min(texte.length, i + t.length + 20);\n' +
      '        resultats.push({ marque: e.id, terme, contexte: texte.slice(debut, fin) });\n' +
      '        depart = i + t.length;\n' +
      '      }\n' +
      '    }\n' +
      '  }\n' +
      '  return resultats;\n' +
      '};\n',
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
      lib: { entry: cheminEntree, formats: ['iife'], name: 'TourmentinContexteAre', fileName: () => nomFichierSortie },
    },
  });
  return readFileSync(join(CACHE, nomFichierSortie), 'utf8');
}

async function main() {
  armerFiletDeSecurite();
  mkdirSync(CACHE, { recursive: true });

  const pages = chargerPagesSocleAffiche();
  const empreintes = chargerEmpreintesActuelles();
  const cheminEntree = ecrireEntreeContexte('entree-contexte-are.ts', empreintes, '__tourmentinContexte');

  let bundle;
  try {
    bundle = await bundlerEntree(cheminEntree, 'contexte-are.js');
  } finally {
    rmSync(cheminEntree, { force: true });
  }

  const context = await lancerContexteNavigateur({ fenetre: false });
  const tout = [];

  for (const [i, p] of pages.entries()) {
    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    try {
      await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
      await page.waitForTimeout(FENETRE_FP_MS);
      await page.evaluate(bundle);
      const resultats = await page.evaluate(() => globalThis.__tourmentinContexte());
      for (const r of resultats) tout.push({ hote: p.hote, ...r });
      console.log(`  [${i + 1}/${pages.length}] ${p.hote} : ${resultats.length} correspondance(s)`);
    } catch (erreur) {
      console.log(`  [${i + 1}/${pages.length}] ${p.hote} — écartée : ${String(erreur?.message ?? erreur).split('\n')[0]}`);
    } finally {
      await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
    }
  }

  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);

  const lignes = [];
  lignes.push(`# Contexte des correspondances termes_faibles sur le segment socle-affiche — 2026-09-23`);
  lignes.push('');
  lignes.push(
    "Spec 12.3.3.12/13, point 4 : ferme la question ARE (12.6) en conservant 40 caractères de contexte " +
      "(20 avant, 20 après, texte normalisé comme le moteur le compare) autour de chaque correspondance " +
      "termes_faibles trouvée sur les pages socle-affiche. Portée volontairement étroite à ce diagnostic ponctuel.",
  );
  lignes.push('');
  lignes.push('## Toutes les correspondances ARE (France Travail)');
  lignes.push('');
  const are = tout.filter((r) => r.terme === 'ARE');
  if (are.length === 0) {
    lignes.push('Aucune correspondance ARE dans cette repasse.');
  } else {
    lignes.push('| Hôte | Contexte (± 20 car., texte normalisé) |');
    lignes.push('|---|---|');
    for (const r of are) lignes.push(`| ${r.hote} | \`…${r.contexte}…\` |`);
  }
  lignes.push('');
  lignes.push('## Toutes les correspondances termes_faibles, pour mémoire');
  lignes.push('');
  lignes.push('| Hôte | Marque | Terme | Contexte |');
  lignes.push('|---|---|---|---|');
  for (const r of tout) lignes.push(`| ${r.hote} | ${r.marque} | ${r.terme} | \`…${r.contexte}…\` |`);
  lignes.push('');

  mkdirSync(DOSSIER_DOCS, { recursive: true });
  const cheminRapport = join(DOSSIER_DOCS, 'CONTEXTE-TERMES-FAIBLES-2026-09-23.md');
  writeFileSync(cheminRapport, lignes.join('\n'), 'utf8');
  console.log(`\nRapport écrit : ${cheminRapport}`);
  console.log(`\nCorrespondances ARE : ${are.length}`);
  for (const r of are) console.log(`  ${r.hote} : …${r.contexte}…`);
}

main()
  .catch((erreur) => {
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
