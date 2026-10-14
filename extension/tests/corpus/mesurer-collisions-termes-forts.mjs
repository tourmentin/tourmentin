// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.14, point 4 : le critère est mesurable, il est donc mesuré.
// Pour chacun des 50 termes de termes_forts (douze empreintes, actives ou
// non) : le nombre d'hôtes distincts du corpus de 3 448 sites légitimes qui
// le portent, hors domaines de la marque elle-même. Même instrument que le
// relevé des collisions de racines typographiques du 14/09 (12.6).
//
// Ajoute la famille suggérée par l'audit du 23/09 : le nom de domaine propre
// de chaque marque (impots.gouv.fr, ameli.fr...) écrit en toutes lettres sur
// une page qui n'est pas servie depuis ce domaine. Comptée, jamais promue.
//
// Aucune valeur de champ, aucun texte de page ne sort du navigateur : le
// bundle injecté renvoie des correspondances structurelles (marque, terme,
// hôte), jamais le texte qui a produit la correspondance.
//
// Aucune saisie, aucune soumission de formulaire.
//
// À exécuter depuis extension/ : node tests/corpus/mesurer-collisions-termes-forts.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { decouperLigneCsv } from './csv.mjs';
import { lancerContexteNavigateur } from './navigateur-sans-extension.mjs';
import { FENETRE_FP_MS } from './fenetre-analyse.mjs';
import { lireTousLesResultats, chargerResultatsPourReprise, ecrireResultat } from './jsonl.mjs';
import { traiterEnParallele, formaterDuree } from './pool-concurrent.mjs';
import { armerFiletDeSecurite } from './filet-de-securite.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_PROJET = join(ICI, '..', '..', '..');
const DOSSIER_SOCLE = join(RACINE_PROJET, 'listes', 'socle');
const CORPUS_CSV = join(RACINE_PROJET, 'corpus', 'corpus-legitimes-v3.csv');
const DOSSIER_DOCS = join(RACINE_PROJET, 'docs');
const CACHE = join(ICI, '.cache', 'collisions-termes-forts');
const FICHIER_RESULTATS = join(ICI, 'collisions-termes-forts.jsonl');

const TIMEOUT_NAVIGATION_MS = 15_000;
const CONCURRENCE = 4;

const arguments_ = process.argv.slice(2);
const REPARTIR_DE_ZERO = arguments_.includes('--repartir-de-zero');
const LIMITE = Number(arguments_.find((a) => a.startsWith('--limit='))?.split('=')[1]) || undefined;

function projeter(brute) {
  return {
    id: brute.id, domaines: brute.domaines, termesForts: brute.termes_forts,
  };
}

function chargerEmpreintes() {
  return readdirSync(DOSSIER_SOCLE).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(DOSSIER_SOCLE, f), 'utf8')))
    .map(projeter);
}

function chargerCorpus() {
  const lignes = readFileSync(CORPUS_CSV, 'utf8').split('\n').filter((l) => l.trim());
  const entetes = decouperLigneCsv(lignes[0]);
  const idx = (n) => entetes.indexOf(n);
  return lignes.slice(1).map((l) => {
    const c = decouperLigneCsv(l);
    return { domaine: c[idx('domaine')], hote: c[idx('hote')], url: c[idx('url')], segment: c[idx('segment')] };
  });
}

function ecrireEntreeCollision(empreintes) {
  const chemin = join(ICI, 'entree-collision-termes-forts.ts');
  writeFileSync(
    chemin,
    "import { construireEntreeAnalyse } from '../../src/adaptateurs/dom.js';\n" +
      "import { normaliser, contientTerme } from '../../src/moteur/texte.js';\n" +
      "import { appartientAuxDomaines } from '../../src/moteur/domaine.js';\n" +
      `const EMPREINTES = ${JSON.stringify(empreintes)};\n` +
      "(globalThis)['__tourmentinCollisions'] = () => {\n" +
      '  const entree = construireEntreeAnalyse(document);\n' +
      '  if (!entree.url) return [];\n' +
      '  const texte = normaliser(`${entree.titre} ${entree.texteVisible}`);\n' +
      '  const hote = entree.url.domaineEnregistrable;\n' +
      '  const resultats = [];\n' +
      '  for (const e of EMPREINTES) {\n' +
      '    if (appartientAuxDomaines(hote, e.domaines)) continue;\n' +
      '    for (const terme of e.termesForts) {\n' +
      '      if (contientTerme(texte, terme)) resultats.push({ type: "termeFort", marque: e.id, terme });\n' +
      '    }\n' +
      '    for (const domaine of e.domaines) {\n' +
      '      if (contientTerme(texte, domaine)) resultats.push({ type: "domainePropre", marque: e.id, domaine });\n' +
      '    }\n' +
      '  }\n' +
      '  return resultats;\n' +
      '};\n',
    'utf8',
  );
  return chemin;
}

async function construireBundleCollision(empreintes) {
  const cheminEntree = ecrireEntreeCollision(empreintes);
  await build({
    configFile: false,
    logLevel: 'error',
    root: join(ICI, '..', '..'),
    build: {
      outDir: CACHE,
      emptyOutDir: true,
      minify: false,
      lib: { entry: cheminEntree, formats: ['iife'], name: 'TourmentinCollisions', fileName: () => 'collisions.js' },
    },
  });
  return readFileSync(join(CACHE, 'collisions.js'), 'utf8');
}

async function main() {
  armerFiletDeSecurite();
  mkdirSync(CACHE, { recursive: true });

  const empreintes = chargerEmpreintes();
  console.log(`${empreintes.length} empreinte(s) (actives et inactives), ${empreintes.reduce((n, e) => n + e.termesForts.length, 0)} termes forts au total.`);
  const bundle = await construireBundleCollision(empreintes);

  let corpus = chargerCorpus();
  if (LIMITE) corpus = corpus.slice(0, LIMITE);
  console.log(`Corpus : ${corpus.length} hôtes.`);

  const resultatsExistants = chargerResultatsPourReprise(FICHIER_RESULTATS, REPARTIR_DE_ZERO);
  const hotesDejaTraites = new Set([...resultatsExistants.values()].map((e) => e.hote));
  const aTraiter = corpus.filter((l) => !hotesDejaTraites.has(l.hote));
  if (hotesDejaTraites.size > 0) console.log(`Reprise : ${hotesDejaTraites.size} déjà traité(s), ${aTraiter.length} restant(s).`);

  const context = await lancerContexteNavigateur({ fenetre: false });

  if (aTraiter.length > 0) {
    const debut = performance.now();
    await traiterEnParallele(
      context,
      aTraiter,
      CONCURRENCE,
      async (page, ligne) => {
        let collisions = [];
        let issue = 'analyse';
        try {
          await page.goto(ligne.url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
          await page.waitForTimeout(FENETRE_FP_MS);
          await page.evaluate(bundle);
          collisions = await page.evaluate(() => globalThis.__tourmentinCollisions());
        } catch {
          issue = 'non-joignable';
        }
        ecrireResultat(FICHIER_RESULTATS, { cle: `hote:${ligne.hote}`, hote: ligne.hote, domaine: ligne.domaine, segment: ligne.segment, issue, collisions });
      },
      { surProgression: ({ termines, restants, ecouleS }) => console.log(`  ${termines} traité(s), ${restants} restant(s), écoulé ${formaterDuree(ecouleS)}.`) },
    );
    console.log(`Corpus traité en ${formaterDuree((performance.now() - debut) / 1000)}.`);
  }

  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);

  // --- agrégation, même forme que le relevé des collisions de racines (14/09) ---
  const tous = [...lireTousLesResultats(FICHIER_RESULTATS).values()];
  const parTerme = new Map(); // cle "marque|terme" -> [{hote, segment}]
  const parDomaine = new Map(); // cle "marque|domaine" -> [{hote, segment}]
  let nbNonJoignables = 0;
  for (const r of tous) {
    if (r.issue !== 'analyse') { nbNonJoignables++; continue; }
    for (const col of r.collisions ?? []) {
      if (col.type === 'termeFort') {
        const cle = `${col.marque}\u0000${col.terme}`;
        if (!parTerme.has(cle)) parTerme.set(cle, []);
        parTerme.get(cle).push({ hote: r.hote, segment: r.segment });
      } else {
        const cle = `${col.marque}\u0000${col.domaine}`;
        if (!parDomaine.has(cle)) parDomaine.set(cle, []);
        parDomaine.get(cle).push({ hote: r.hote, segment: r.segment });
      }
    }
  }

  const empreintesParId = new Map(empreintes.map((e) => [e.id, e]));
  const lignesTermes = [...parTerme.entries()].map(([cle, occurrences]) => {
    const [marque, terme] = cle.split('\u0000');
    return { marque, terme, occurrences };
  }).sort((a, b) => b.occurrences.length - a.occurrences.length);

  const lignesDomaines = [...parDomaine.entries()].map(([cle, occurrences]) => {
    const [marque, domaine] = cle.split('\u0000');
    return { marque, domaine, occurrences };
  }).sort((a, b) => b.occurrences.length - a.occurrences.length);

  const lignes = [];
  lignes.push(`# Collisions de termes_forts sur le corpus légitime — ${new Date().toISOString().slice(0, 10)}`);
  lignes.push('');
  lignes.push(
    `Spec 12.3.3.14, point 4. ${empreintes.reduce((n, e) => n + e.termesForts.length, 0)} termes forts des ` +
      `${empreintes.length} empreintes (actives et inactives) confrontés à ${corpus.length} hôtes du corpus légitime, ` +
      `hors domaines de la marque elle-même. Même instrument que le relevé des collisions de racines typographiques ` +
      `du 14/09/2026 (12.6). ${nbNonJoignables} hôte(s) non joignable(s), hors dénominateur.`,
  );
  lignes.push('');
  lignes.push('## 1. Termes forts — collisions par terme, tous ceux qui en portent au moins une');
  lignes.push('');
  lignes.push(`${lignesTermes.length} terme(s) sur ${empreintes.reduce((n, e) => n + e.termesForts.length, 0)} ont au moins une collision.`);
  lignes.push('');
  lignes.push('| Marque | Terme | Hôtes distincts | Exemples (jusqu\'à 5) |');
  lignes.push('|---|---|---|---|');
  for (const l of lignesTermes) {
    const exemples = l.occurrences.slice(0, 5).map((o) => o.hote).join(', ');
    lignes.push(`| ${l.marque} | ${l.terme} | ${l.occurrences.length} | ${exemples} |`);
  }
  lignes.push('');
  const sansCollision = empreintes.flatMap((e) => e.termesForts.map((t) => ({ marque: e.id, terme: t })))
    .filter((t) => !parTerme.has(`${t.marque}\u0000${t.terme}`));
  lignes.push(`**${sansCollision.length} terme(s) sans aucune collision sur les ${corpus.length} hôtes :**`);
  lignes.push('');
  for (const t of sansCollision) lignes.push(`- ${t.marque} : ${t.terme}`);
  lignes.push('');
  lignes.push('## 2. Nom de domaine propre écrit en toutes lettres hors de ce domaine (compté, non promu)');
  lignes.push('');
  if (lignesDomaines.length === 0) {
    lignes.push('Aucune occurrence.');
  } else {
    lignes.push('| Marque | Domaine cité | Hôtes distincts | Exemples (jusqu\'à 5) |');
    lignes.push('|---|---|---|---|');
    for (const l of lignesDomaines) {
      const exemples = l.occurrences.slice(0, 5).map((o) => o.hote).join(', ');
      lignes.push(`| ${l.marque} | ${l.domaine} | ${l.occurrences.length} | ${exemples} |`);
    }
  }
  lignes.push('');
  lignes.push("Diagnostic seul : aucun seuil de coupure n'est posé ici, aucune empreinte modifiée (12.3.3.14).");
  lignes.push('');

  mkdirSync(DOSSIER_DOCS, { recursive: true });
  const chemin = join(DOSSIER_DOCS, `COLLISIONS-TERMES-FORTS-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(chemin, lignes.join('\n'), 'utf8');
  console.log(`\nRapport écrit : ${chemin}`);
  console.log(`${lignesTermes.length} terme(s) en collision, ${sansCollision.length} sans collision, ${lignesDomaines.length} entrée(s) « domaine propre cité ».`);
}

main()
  .catch((erreur) => { console.error(erreur); process.exitCode = 1; })
  .finally(() => process.exit());
