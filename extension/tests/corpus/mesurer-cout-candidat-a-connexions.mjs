// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.19 / ordre du 26/09/2026, point 1 : coût réel du candidat A
// (champ identifiant isolé + page évoquant la connexion) sur le sous-corpus
// des pages de connexion (corpus/corpus-connexions.csv). Mesure seule, rien
// d'implémenté : pour chaque page qui passerait de E = 0 à E > 0, le score
// d'imitation réel (analyser()) et le niveau qui en résulterait.
//
// Hypothèse de poids, posée ici faute de décision : A pèserait POIDS_EXPOSITION.E1
// (35), le plus petit poids qui autorise N1/N2 (SEUIL_E_POUR_N1/N2 = 35). En
// dessous, aucune page ne pourrait dépasser N0 ; entre 35 et 55 le niveau est
// le même (N3 exige E >= 55). Le niveau est calculé avec le seuil réel
// (calculerSeuil / evaluerModificateurs de production).
//
// Ne concerne que les pages qui atteignent les axes : une page éteinte par
// Z2-Z5 ne change pas de niveau.
// Aucune saisie, aucune soumission. Aucun texte de page ne sort du navigateur.
//
// À exécuter depuis extension/ : node tests/corpus/mesurer-cout-candidat-a-connexions.mjs
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

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_PROJET = join(ICI, '..', '..', '..');
const CORPUS_CSV = join(RACINE_PROJET, 'corpus', 'corpus-connexions.csv');
const CACHE = join(ICI, '.cache', 'cout-candidat-a-connexions');
const FICHIER_RESULTATS = join(ICI, 'cout-candidat-a-connexions.jsonl');
const POIDS_A_HYPOTHETIQUE = 30; // provisoire, sous E1 (14.3 point 4), à trancher au L6
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
    return { hote: c[idx('hote')], url: c[idx('url')], origine: c[idx('segment_origine')], mode: c[idx('mode')], etape: c[idx('etape')] };
  });
}

function ecrireEntree() {
  const chemin = join(ICI, 'entree-cout-candidat-a.ts');
  writeFileSync(chemin, `import { construireEntreeAnalyse } from '../../src/adaptateurs/dom.js';
import { analyser } from '../../src/moteur/analyser.js';
import { normaliser } from '../../src/moteur/texte.js';
import { construireListes, configParDefaut } from '../../src/listes/chargement.js';
import { calculerSeuil, evaluerModificateurs } from '../../src/moteur/seuils.js';
import { SEUIL_E_POUR_N1, SEUIL_E_POUR_N2, SEUIL_I_POUR_N1 } from '../../src/moteur/constantes.js';

const listes = construireListes();
const config = configParDefaut();
const POIDS_A = ${POIDS_A_HYPOTHETIQUE};
const LEXIQUE_IDENTIFIANT = ['identifiant', 'adresse e-mail', 'adresse email', 'adresse electronique', 'adresse mail', 'courriel', 'e-mail', 'email', "nom d'utilisateur", 'login', 'username'];
const MOTS_PAGE_CONNEXION = ['connexion', 'se connecter', 'mon compte', 'espace client', 'identifiez-vous', 'espace personnel', 'login', 'sign in', 'connecter', 'identification', 'authentification', 'signin', 'log in'];
const evoque = (texte, mots) => { const t = normaliser(texte ?? ''); return mots.some((m) => t.includes(normaliser(m))); };
function estChampIdentifiant(champ) {
  if (!champ.visible || champ.type === 'search' || champ.type === 'hidden') return false;
  const ac = (champ.autocomplete ?? '').toLowerCase().split(/\\s+/);
  if (ac.includes('username') || ac.includes('email')) return true;
  return evoque([champ.libelle, champ.nom, champ.placeholder].filter(Boolean).join(' '), LEXIQUE_IDENTIFIANT);
}
const visiblesNonRecherche = (f) => f.champs.filter((c) => c.visible && c.type !== 'search' && c.type !== 'hidden');

(globalThis)['__tourmentinCoutA'] = () => {
  const entree = construireEntreeAnalyse(document);
  const verdict = analyser(entree, listes, config);
  const expositionActuelle = (verdict.scoreExposition ?? 0) > 0;
  const atteintLesAxes = verdict.motif === 'aucune exposition détectée' || expositionActuelle;
  const contexte = evoque(\`\${entree.titre} \${entree.url?.chemin ?? ''}\`, MOTS_PAGE_CONNEXION);
  let isole = false;
  for (const f of entree.formulaires) {
    const v = visiblesNonRecherche(f);
    if (f.champs.some(estChampIdentifiant) && v.length === 1) isole = true;
  }
  const declencheA = atteintLesAxes && !expositionActuelle && isole && contexte;
  let niveauHypothetique = null;
  let seuil = null;
  if (declencheA) {
    seuil = calculerSeuil(evaluerModificateurs(entree, listes).total, config.sensibilite);
    const I = verdict.scoreImitation ?? 0;
    if (I >= seuil && POIDS_A >= SEUIL_E_POUR_N2) niveauHypothetique = 'N2';
    else if (I >= SEUIL_I_POUR_N1 && POIDS_A >= SEUIL_E_POUR_N1) niveauHypothetique = 'N1';
    else niveauHypothetique = 'N0';
  }
  return {
    motif: verdict.motif, niveauActuel: verdict.niveau, expositionActuelle, atteintLesAxes,
    declencheA, scoreImitation: verdict.scoreImitation ?? 0, marque: verdict.marqueDetectee ?? null,
    seuil, niveauHypothetique,
  };
};
`, 'utf8');
  return chemin;
}

async function construireBundle() {
  await build({
    configFile: false, logLevel: 'error', root: join(ICI, '..', '..'),
    build: { outDir: CACHE, emptyOutDir: true, minify: false,
      lib: { entry: ecrireEntree(), formats: ['iife'], name: 'TourmentinCoutA', fileName: () => 'cout-a.js' } },
  });
  return readFileSync(join(CACHE, 'cout-a.js'), 'utf8');
}

async function main() {
  armerFiletDeSecurite();
  mkdirSync(CACHE, { recursive: true });
  const bundle = await construireBundle();
  let corpus = chargerCorpus();
  if (LIMITE) corpus = corpus.slice(0, LIMITE);
  console.log(`Sous-corpus des connexions : ${corpus.length} lignes.`);
  const deja = new Set([...chargerResultatsPourReprise(FICHIER_RESULTATS, REPARTIR_DE_ZERO).values()].map((e) => e.url));
  const aTraiter = corpus.filter((l) => !deja.has(l.url));
  const context = await lancerContexteNavigateur({ fenetre: false });
  if (aTraiter.length > 0) {
    const debut = performance.now();
    await traiterEnParallele(context, aTraiter, CONCURRENCE, async (page, ligne) => {
      let mesure;
      let issue = 'analyse';
      try {
        await page.goto(ligne.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.waitForTimeout(FENETRE_FP_MS);
        await page.evaluate(bundle);
        mesure = await page.evaluate(() => globalThis.__tourmentinCoutA());
      } catch {
        issue = 'non-joignable';
      }
      ecrireResultat(FICHIER_RESULTATS, { cle: `url:${ligne.url}`, url: ligne.url, hote: ligne.hote, origine: ligne.origine, mode: ligne.mode, etape: ligne.etape, issue, ...mesure });
    }, { surProgression: ({ termines, restants, ecouleS }) => console.log(`  ${termines} traité(s), ${restants} restant(s), écoulé ${formaterDuree(ecouleS)}.`) });
    console.log(`Traité en ${formaterDuree((performance.now() - debut) / 1000)}.`);
  }
  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);

  const tous = [...lireTousLesResultats(FICHIER_RESULTATS).values()];
  const ok = tous.filter((r) => r.issue === 'analyse');
  const aux = ok.filter((r) => r.atteintLesAxes);
  const dejaE = aux.filter((r) => r.expositionActuelle);
  const eZero = aux.filter((r) => !r.expositionActuelle);
  const passent = ok.filter((r) => r.declencheA);
  const par = (n) => passent.filter((r) => r.niveauHypothetique === n).length;
  const jour = new Date().toISOString().slice(0, 10);
  const L = [];
  L.push(`# Coût du candidat A sur le sous-corpus des connexions — ${jour}`, '');
  L.push(`Mesure seule, rien d'implémenté. ${ok.length} page(s) analysée(s) sur ${tous.length} (${tous.length - ok.length} non joignable(s)). Hypothèse de poids : A = E1 = ${POIDS_A_HYPOTHETIQUE}.`, '');
  L.push('| Population | Pages |', '|---|---|');
  L.push(`| Analysées | ${ok.length} |`, `| Atteignent les axes (hors Z2-Z5) | ${aux.length} |`, `| dont E > 0 déjà aujourd'hui | ${dejaE.length} |`, `| dont E = 0 aujourd'hui | ${eZero.length} |`, `| **Passeraient de E = 0 à E > 0 avec A** | **${passent.length}** |`, '');
  L.push('## Niveau qui en résulterait, pour ces pages', '', '| Niveau | Pages |', '|---|---|', `| N0 | ${par('N0')} |`, `| N1 | ${par('N1')} |`, `| N2 | ${par('N2')} |`, '');
  L.push('## Pages concernées', '', '| Hôte | Origine | Imitation | Marque | Seuil | Niveau résultant |', '|---|---|---|---|---|---|');
  for (const r of [...passent].sort((a, b) => b.scoreImitation - a.scoreImitation)) L.push(`| ${r.hote} | ${r.origine} | ${r.scoreImitation} | ${r.marque ?? '—'} | ${r.seuil} | ${r.niveauHypothetique} |`);
  L.push('');
  const chemin = join(RACINE_PROJET, 'docs', `COUT-CANDIDAT-A-CONNEXIONS-${jour}.md`);
  writeFileSync(chemin, L.join('\n'), 'utf8');
  console.log(`Rapport : ${chemin}\nAnalysées ${ok.length}, aux axes ${aux.length}, passent ${passent.length} (N0 ${par('N0')}, N1 ${par('N1')}, N2 ${par('N2')})`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => process.exit());
