// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.18, point 4 : ne touche pas à l'axe d'exposition. Mesure, pour
// deux ou trois formulations candidates d'un signal d'exposition « écran
// identifiant » (proposées, pas implémentées), combien de pages légitimes du
// corpus complet passeraient de E = 0 à E > 0. Le coût avant la discussion,
// pas une correction.
//
// Trois candidats, du plus prudent au plus large :
//   A (contextuel)  : champ identifiant isolé (seul champ de saisie visible
//                     non-recherche de son formulaire) ET page dont le titre
//                     ou le chemin évoque la connexion (même lexique que
//                     trouver-connexion.mjs, MOTS_PAGE_CONNEXION).
//   B (isolé)       : même champ identifiant isolé, sans exiger le contexte
//                     de page.
//   C (sans garde)  : tout champ identifiant visible, isolé ou non, page
//                     quelconque -- la formulation la plus permissive, pour
//                     montrer le coût de l'absence de garde-fou.
// Un « champ identifiant » : autocomplete username/email, ou libellé/nom/
// placeholder correspondant au lexique d'identifiant déjà utilisé pour
// juger les pages de connexion du corpus (LEXIQUE_IDENTIFIANT).
//
// E actuel calculé avec le moteur de production (analyser()), pas réinventé.
// Aucune valeur de champ, aucun texte de page ne sort du navigateur.
//
// Aucune saisie, aucune soumission de formulaire.
//
// À exécuter depuis extension/ : node tests/corpus/mesurer-cout-exposition-identifiant.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { decouperLigneCsv } from './csv.mjs';
import { lancerContexteNavigateur } from './navigateur-sans-extension.mjs';
import { FENETRE_FP_MS } from './fenetre-analyse.mjs';
import { lireTousLesResultats, chargerResultatsPourReprise, ecrireResultat } from './jsonl.mjs';
import { traiterEnParallele, formaterDuree } from './pool-concurrent.mjs';
import { armerFiletDeSecurite } from './filet-de-securite.mjs';
import { construireBundleAdaptateur } from './bundle-adaptateur.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_PROJET = join(ICI, '..', '..', '..');
const CORPUS_CSV = join(RACINE_PROJET, 'corpus', 'corpus-legitimes-v3.csv');
const DOSSIER_DOCS = join(RACINE_PROJET, 'docs');
const CACHE = join(ICI, '.cache', 'cout-exposition-identifiant');
const FICHIER_RESULTATS = join(ICI, 'cout-exposition-identifiant.jsonl');

const TIMEOUT_NAVIGATION_MS = 15_000;
const CONCURRENCE = 4;

const arguments_ = process.argv.slice(2);
const REPARTIR_DE_ZERO = arguments_.includes('--repartir-de-zero');
const LIMITE = Number(arguments_.find((a) => a.startsWith('--limit='))?.split('=')[1]) || undefined;

function chargerCorpus() {
  const lignes = readFileSync(CORPUS_CSV, 'utf8').split('\n').filter((l) => l.trim());
  const entetes = decouperLigneCsv(lignes[0]);
  const idx = (n) => entetes.indexOf(n);
  return lignes.slice(1).map((l) => {
    const c = decouperLigneCsv(l);
    return { domaine: c[idx('domaine')], hote: c[idx('hote')], url: c[idx('url')], segment: c[idx('segment')] };
  });
}

function ecrireEntreeCandidats() {
  const chemin = join(ICI, 'entree-cout-exposition.ts');
  writeFileSync(
    chemin,
    `import { construireEntreeAnalyse } from '../../src/adaptateurs/dom.js';
import { analyser } from '../../src/moteur/analyser.js';
import { normaliser, contientTerme } from '../../src/moteur/texte.js';
import { construireListes, configParDefaut } from '../../src/listes/chargement.js';

const listes = construireListes();
const config = configParDefaut();

const LEXIQUE_IDENTIFIANT = [
  'identifiant', 'adresse e-mail', 'adresse email', 'adresse electronique',
  'adresse mail', 'courriel', 'e-mail', 'email', "nom d'utilisateur",
  'login', 'username',
];
const MOTS_PAGE_CONNEXION = [
  'connexion', 'se connecter', 'mon compte', 'espace client', 'identifiez-vous',
  'espace personnel', 'login', 'sign in', 'connecter', 'identification',
  'authentification', 'signin', 'log in',
];
const evoque = (texte, mots) => {
  const t = normaliser(texte ?? '');
  return mots.some((m) => t.includes(normaliser(m)));
};

function estChampIdentifiant(champ) {
  if (!champ.visible) return false;
  if (champ.type === 'search' || champ.type === 'hidden') return false;
  const ac = (champ.autocomplete ?? '').toLowerCase().split(/\\s+/);
  if (ac.includes('username') || ac.includes('email')) return true;
  const libelle = [champ.libelle, champ.nom, champ.placeholder].filter(Boolean).join(' ');
  return evoque(libelle, LEXIQUE_IDENTIFIANT);
}

function champsVisiblesNonRecherche(formulaire) {
  return formulaire.champs.filter((c) => c.visible && c.type !== 'search' && c.type !== 'hidden');
}

(globalThis)['__tourmentinCoutExposition'] = () => {
  const entree = construireEntreeAnalyse(document);
  const verdict = analyser(entree, listes, config);
  const expositionActuelle = (verdict.scoreExposition ?? 0) > 0;

  const contexteConnexion = evoque(\`\${entree.titre} \${entree.url?.chemin ?? ''}\`, MOTS_PAGE_CONNEXION);

  let champIdentifiantIsole = false;
  let champIdentifiantQuelconque = false;
  for (const f of entree.formulaires) {
    const visibles = champsVisiblesNonRecherche(f);
    for (const c of f.champs) {
      if (!estChampIdentifiant(c)) continue;
      champIdentifiantQuelconque = true;
      if (visibles.length === 1) champIdentifiantIsole = true;
    }
  }

  return {
    expositionActuelle,
    candidatA: !expositionActuelle && champIdentifiantIsole && contexteConnexion,
    candidatB: !expositionActuelle && champIdentifiantIsole,
    candidatC: !expositionActuelle && champIdentifiantQuelconque,
  };
};
`,
    'utf8',
  );
  return chemin;
}

async function construireBundleCandidats() {
  const cheminEntree = ecrireEntreeCandidats();
  try {
    await build({
      configFile: false,
      logLevel: 'error',
      root: join(ICI, '..', '..'),
      build: {
        outDir: CACHE,
        emptyOutDir: true,
        minify: false,
        lib: { entry: cheminEntree, formats: ['iife'], name: 'TourmentinCoutExposition', fileName: () => 'cout-exposition.js' },
      },
    });
  } finally {
    // conservé pour inspection en cas d'échec de build ; supprimé sinon par git (gitignore)
  }
  return readFileSync(join(CACHE, 'cout-exposition.js'), 'utf8');
}

async function main() {
  armerFiletDeSecurite();
  mkdirSync(CACHE, { recursive: true });

  console.log("Construction du bundle (adaptateur réel + candidats, aucun code de production modifié)...");
  const bundle = await construireBundleCandidats();

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
        let mesure;
        let issue = 'analyse';
        try {
          await page.goto(ligne.url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
          await page.waitForTimeout(FENETRE_FP_MS);
          await page.evaluate(bundle);
          mesure = await page.evaluate(() => globalThis.__tourmentinCoutExposition());
        } catch {
          issue = 'non-joignable';
        }
        ecrireResultat(FICHIER_RESULTATS, { cle: `hote:${ligne.hote}`, hote: ligne.hote, segment: ligne.segment, issue, ...mesure });
      },
      { surProgression: ({ termines, restants, ecouleS }) => console.log(`  ${termines} traité(s), ${restants} restant(s), écoulé ${formaterDuree(ecouleS)}.`) },
    );
    console.log(`Corpus traité en ${formaterDuree((performance.now() - debut) / 1000)}.`);
  }

  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);

  const tous = [...lireTousLesResultats(FICHIER_RESULTATS).values()];
  const exploitables = tous.filter((r) => r.issue === 'analyse');
  const nbNonJoignables = tous.length - exploitables.length;

  const compter = (cle) => exploitables.filter((r) => r[cle]);
  const a = compter('candidatA');
  const b = compter('candidatB');
  const cc = compter('candidatC');

  const parSegment = (liste) => {
    const m = {};
    for (const r of liste) m[r.segment] = (m[r.segment] ?? 0) + 1;
    return Object.entries(m).sort((x, y) => y[1] - x[1]);
  };

  const lignes = [];
  lignes.push(`# Coût de trois formulations candidates d'un signal « écran identifiant » — ${new Date().toISOString().slice(0, 10)}`);
  lignes.push('');
  lignes.push(
    "Spec 12.3.3.18, point 4 : formulations proposées, pas implémentées. Aucun code de production modifié " +
      `(\`analyser()\`, \`signaux-exposition.ts\` inchangés). ${exploitables.length} page(s) analysée(s) sur ${corpus.length} ` +
      `du corpus légitime (${nbNonJoignables} non joignable(s), hors dénominateur).`,
  );
  lignes.push('');
  lignes.push('## Candidats');
  lignes.push('');
  lignes.push('- **A (contextuel)** : champ identifiant isolé (seul champ visible non-recherche de son formulaire) ET titre ou chemin de page évoquant la connexion.');
  lignes.push('- **B (isolé)** : même champ identifiant isolé, sans exiger le contexte de page.');
  lignes.push('- **C (sans garde)** : tout champ identifiant visible, isolé ou non, page quelconque.');
  lignes.push('');
  lignes.push('## Coût, en pages qui passeraient de E = 0 à E > 0');
  lignes.push('');
  lignes.push('| Candidat | Pages concernées | Part du corpus analysé |');
  lignes.push('|---|---|---|');
  const pct = (n) => `${((100 * n) / exploitables.length).toFixed(2)} %`;
  lignes.push(`| A (contextuel) | ${a.length} | ${pct(a.length)} |`);
  lignes.push(`| B (isolé) | ${b.length} | ${pct(b.length)} |`);
  lignes.push(`| C (sans garde) | ${cc.length} | ${pct(cc.length)} |`);
  lignes.push('');
  lignes.push('## Répartition par segment');
  lignes.push('');
  for (const [nom, liste] of [['A', a], ['B', b], ['C', cc]]) {
    lignes.push(`**Candidat ${nom}** : ` + (parSegment(liste).map(([s, n]) => `${s} ${n}`).join(', ') || 'aucune page concernée'));
    lignes.push('');
  }
  lignes.push("Diagnostic seul : aucune formulation n'est implémentée, l'axe d'exposition n'est pas modifié (12.3.3.18, point 4).");
  lignes.push('');

  mkdirSync(DOSSIER_DOCS, { recursive: true });
  const chemin = join(DOSSIER_DOCS, `COUT-EXPOSITION-IDENTIFIANT-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(chemin, lignes.join('\n'), 'utf8');
  console.log(`\nRapport écrit : ${chemin}`);
  console.log(`A : ${a.length} — B : ${b.length} — C : ${cc.length} (sur ${exploitables.length} pages analysées)`);
}

main()
  .catch((erreur) => { console.error(erreur); process.exitCode = 1; })
  .finally(() => process.exit());
