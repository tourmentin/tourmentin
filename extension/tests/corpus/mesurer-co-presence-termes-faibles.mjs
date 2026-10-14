// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.6 (posée le 23/09/2026, avant cette mesure) : I2 ne juge pas la
// qualité d'un terme faible, il compte la co-présence, seuil à trois
// (NB_TERMES_FAIBLES_MIN_I2). Pour chaque empreinte, combien d'hôtes du
// corpus légitime portent trois termes faibles ou plus, hors domaines de la
// marque elle-même -- et lesquels. Même instrument que la collision des
// termes forts (12.3.3.14, point 4), étendu aux termes faibles.
//
// Mesure seule : ni I2, ni son seuil, ni aucune liste ne sont modifiés ici.
//
// Aucune valeur de champ, aucun texte de page ne sort du navigateur : le
// bundle injecté renvoie des correspondances structurelles (marque, terme,
// hôte), jamais le texte qui a produit la correspondance.
//
// Aucune saisie, aucune soumission de formulaire.
//
// À exécuter depuis extension/ : node tests/corpus/mesurer-co-presence-termes-faibles.mjs
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
const CACHE = join(ICI, '.cache', 'co-presence-termes-faibles');
const FICHIER_RESULTATS = join(ICI, 'co-presence-termes-faibles.jsonl');

const TIMEOUT_NAVIGATION_MS = 15_000;
const CONCURRENCE = 4;
// NB_TERMES_FAIBLES_MIN_I2, constantes.ts -- dupliqué ici en donnée brute,
// comme comparaison-racines.ts duplique déjà la logique de racines_typo :
// ce script n'importe pas src/moteur pour ses constantes, seulement pour ses
// fonctions pures (texte.js, domaine.js), au même titre que les autres
// scripts de ce dossier.
const SEUIL_I2 = 3;

const arguments_ = process.argv.slice(2);
const REPARTIR_DE_ZERO = arguments_.includes('--repartir-de-zero');
const LIMITE = Number(arguments_.find((a) => a.startsWith('--limit='))?.split('=')[1]) || undefined;

function projeter(brute) {
  return { id: brute.id, actif: brute.actif, domaines: brute.domaines, termesFaibles: brute.termes_faibles };
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

function ecrireEntree(empreintes) {
  const chemin = join(ICI, 'entree-co-presence-faibles.ts');
  writeFileSync(
    chemin,
    "import { construireEntreeAnalyse } from '../../src/adaptateurs/dom.js';\n" +
      "import { normaliser, contientTerme } from '../../src/moteur/texte.js';\n" +
      "import { appartientAuxDomaines } from '../../src/moteur/domaine.js';\n" +
      `const EMPREINTES = ${JSON.stringify(empreintes)};\n` +
      "(globalThis)['__tourmentinCoPresence'] = () => {\n" +
      '  const entree = construireEntreeAnalyse(document);\n' +
      '  if (!entree.url) return [];\n' +
      '  const texte = normaliser(`${entree.titre} ${entree.texteVisible}`);\n' +
      '  const hote = entree.url.domaineEnregistrable;\n' +
      '  const resultats = [];\n' +
      '  for (const e of EMPREINTES) {\n' +
      '    if (appartientAuxDomaines(hote, e.domaines)) continue;\n' +
      '    const trouves = e.termesFaibles.filter((t) => contientTerme(texte, t));\n' +
      '    if (trouves.length > 0) resultats.push({ marque: e.id, termes: trouves });\n' +
      '  }\n' +
      '  return resultats;\n' +
      '};\n',
    'utf8',
  );
  return chemin;
}

async function construireBundle(empreintes) {
  const cheminEntree = ecrireEntree(empreintes);
  await build({
    configFile: false,
    logLevel: 'error',
    root: join(ICI, '..', '..'),
    build: {
      outDir: CACHE,
      emptyOutDir: true,
      minify: false,
      lib: { entry: cheminEntree, formats: ['iife'], name: 'TourmentinCoPresence', fileName: () => 'co-presence.js' },
    },
  });
  return readFileSync(join(CACHE, 'co-presence.js'), 'utf8');
}

async function main() {
  armerFiletDeSecurite();
  mkdirSync(CACHE, { recursive: true });

  const empreintes = chargerEmpreintes();
  console.log(`${empreintes.length} empreinte(s), seuil I2 = ${SEUIL_I2} termes faibles co-présents.`);
  const bundle = await construireBundle(empreintes);

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
        let correspondances = [];
        let issue = 'analyse';
        try {
          await page.goto(ligne.url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
          await page.waitForTimeout(FENETRE_FP_MS);
          await page.evaluate(bundle);
          correspondances = await page.evaluate(() => globalThis.__tourmentinCoPresence());
        } catch {
          issue = 'non-joignable';
        }
        ecrireResultat(FICHIER_RESULTATS, { cle: `hote:${ligne.hote}`, hote: ligne.hote, domaine: ligne.domaine, segment: ligne.segment, issue, correspondances });
      },
      { surProgression: ({ termines, restants, ecouleS }) => console.log(`  ${termines} traité(s), ${restants} restant(s), écoulé ${formaterDuree(ecouleS)}.`) },
    );
    console.log(`Corpus traité en ${formaterDuree((performance.now() - debut) / 1000)}.`);
  }

  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);

  // --- agrégation ---
  const tous = [...lireTousLesResultats(FICHIER_RESULTATS).values()];
  let nbNonJoignables = 0;
  const parEmpreinte = new Map(empreintes.map((e) => [e.id, { actif: e.actif, hotesDeclenchants: [], histogramme: { 0: 0, 1: 0, 2: 0, '3plus': 0 } }]));

  for (const r of tous) {
    if (r.issue !== 'analyse') { nbNonJoignables++; continue; }
    const parMarque = new Map((r.correspondances ?? []).map((c) => [c.marque, c.termes]));
    for (const [id, agg] of parEmpreinte) {
      const termes = parMarque.get(id) ?? [];
      const n = termes.length;
      if (n >= SEUIL_I2) {
        agg.histogramme['3plus']++;
        agg.hotesDeclenchants.push({ hote: r.hote, segment: r.segment, termes });
      } else {
        agg.histogramme[n] = (agg.histogramme[n] ?? 0) + 1;
      }
    }
  }

  const lignes = [];
  lignes.push(`# Co-présence de termes_faibles (I2) sur le corpus légitime — ${new Date().toISOString().slice(0, 10)}`);
  lignes.push('');
  lignes.push(
    `Question posée en 12.6 avant cette mesure. Seuil I2 = ${SEUIL_I2} termes faibles co-présents. ` +
      `${empreintes.length} empreintes confrontées à ${corpus.length} hôtes du corpus légitime, hors domaines de la ` +
      `marque elle-même. ${nbNonJoignables} hôte(s) non joignable(s), hors dénominateur. Mesure seule : I2, son seuil ` +
      "et les listes ne sont pas modifiés.",
  );
  lignes.push('');
  lignes.push('## 1. Distribution par empreinte');
  lignes.push('');
  lignes.push('| Empreinte | Active | 0 terme | 1 terme | 2 termes | 3 termes ou + (déclenche I2) |');
  lignes.push('|---|---|---|---|---|---|');
  for (const [id, agg] of [...parEmpreinte].sort((a, b) => b[1].hotesDeclenchants.length - a[1].hotesDeclenchants.length)) {
    lignes.push(`| ${id} | ${agg.actif ? 'oui' : 'non'} | ${agg.histogramme[0] ?? 0} | ${agg.histogramme[1] ?? 0} | ${agg.histogramme[2] ?? 0} | **${agg.hotesDeclenchants.length}** |`);
  }
  lignes.push('');
  lignes.push('## 2. Hôtes où I2 se déclencherait (≥ 3 termes faibles), par empreinte et par segment');
  lignes.push('');
  for (const [id, agg] of parEmpreinte) {
    if (agg.hotesDeclenchants.length === 0) continue;
    lignes.push(`### ${id}${agg.actif ? '' : ' (inactive)'} — ${agg.hotesDeclenchants.length} hôte(s)`);
    lignes.push('');
    const parSegment = {};
    for (const h of agg.hotesDeclenchants) parSegment[h.segment] = (parSegment[h.segment] ?? 0) + 1;
    lignes.push('Par segment : ' + Object.entries(parSegment).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', '));
    lignes.push('');
    lignes.push('| Hôte | Segment | Termes faibles co-présents |');
    lignes.push('|---|---|---|');
    for (const h of agg.hotesDeclenchants.slice(0, 30)) lignes.push(`| ${h.hote} | ${h.segment} | ${h.termes.join(' \\| ')} |`);
    if (agg.hotesDeclenchants.length > 30) lignes.push(`| … | | ${agg.hotesDeclenchants.length - 30} de plus |`);
    lignes.push('');
  }
  lignes.push("Diagnostic seul : aucun seuil ni aucune empreinte modifiés (12.6).");
  lignes.push('');

  mkdirSync(DOSSIER_DOCS, { recursive: true });
  const chemin = join(DOSSIER_DOCS, `CO-PRESENCE-TERMES-FAIBLES-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(chemin, lignes.join('\n'), 'utf8');
  console.log(`\nRapport écrit : ${chemin}`);
  for (const [id, agg] of parEmpreinte) console.log(`  ${id} : ${agg.hotesDeclenchants.length} hôte(s) à ≥3 termes faibles`);
}

main()
  .catch((erreur) => { console.error(erreur); process.exitCode = 1; })
  .finally(() => process.exit());
