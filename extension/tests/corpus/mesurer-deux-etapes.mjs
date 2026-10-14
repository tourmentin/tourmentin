// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 14.57 : mesure seule, rien n'est activé.
//  (1) mémoire d'imitation : sur des sites légitimes, combien de pages retiendraient une imitation (champ d'identifiant + I >= 45), et un écran 2 hypothétique
//      du même hôte (page dépouillée à mot de passe) changerait-il de verdict ? Attendu : aucun changement.
//  (2) bandeau de connexion étendu aux pages d'identifiant : bandeaux SUPPLÉMENTAIRES par rapport à aujourd'hui (N0, champ mot de passe, hors paiement).
// Corpus : corpus/corpus-connexions.csv (pages de connexion) et un échantillon tiré (graine fixe) du corpus général. Aucune saisie, aucune soumission.
//   node tests/corpus/mesurer-deux-etapes.mjs [--limit=N] [--echantillon=N] [--repartir-de-zero]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
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
const CACHE = join(ICI, '.cache', 'deux-etapes');
const FICHIER_RESULTATS = join(ICI, 'deux-etapes.jsonl');
const PUBLICATION = process.env.TMT_SORTIE_ESSAI ?? process.env.TOURMENTIN_DOSSIER_PUBLICATION ?? join(homedir(), 'Tourmentin-publication');
const CONCURRENCE = 4;
const TIMEOUT_NAVIGATION_MS = 15_000;
const args = process.argv.slice(2);
const REPARTIR = args.includes('--repartir-de-zero');
const LIMITE = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || undefined;
const TAILLE_ECHANTILLON = Number(args.find((a) => a.startsWith('--echantillon='))?.split('=')[1]) || 600;

function lireCsv(chemin) {
  const lignes = readFileSync(chemin, 'utf8').split('\n').filter((l) => l.trim());
  const entetes = decouperLigneCsv(lignes[0]);
  return lignes.slice(1).map((l) => Object.fromEntries(decouperLigneCsv(l).map((v, i) => [entetes[i], v])));
}
function graine(seed) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function chargerCorpus() {
  const connexions = lireCsv(join(RACINE_PROJET, 'corpus', 'corpus-connexions.csv')).map((r) => ({ ensemble: 'connexions', hote: r.hote, url: r.url, segment: r.segment_origine, etape: r.etape }));
  const dejaVus = new Set(connexions.map((c) => c.hote));
  const general = lireCsv(join(RACINE_PROJET, 'corpus', 'corpus-legitimes-v3.csv')).filter((r) => !dejaVus.has(r.hote));
  const alea = graine(20261013);
  const melange = general.map((r) => [alea(), r]).sort((a, b) => a[0] - b[0]).map((x) => x[1]).slice(0, TAILLE_ECHANTILLON);
  return [...connexions, ...melange.map((r) => ({ ensemble: 'general', hote: r.hote, url: r.url, segment: r.segment, etape: '' }))];
}

async function construireBundle() {
  await build({
    configFile: false, logLevel: 'error', root: join(ICI, '..', '..'),
    build: { outDir: CACHE, emptyOutDir: true, minify: false, lib: { entry: join(ICI, 'entree-deux-etapes.ts'), formats: ['iife'], name: 'TourmentinDeuxEtapes', fileName: () => 'deux-etapes.js' } },
  });
  return readFileSync(join(CACHE, 'deux-etapes.js'), 'utf8');
}

async function main() {
  armerFiletDeSecurite();
  mkdirSync(CACHE, { recursive: true });
  console.log('Construction du bundle (adaptateur et moteur de production)...');
  const bundle = await construireBundle();
  let corpus = chargerCorpus();
  if (LIMITE) corpus = corpus.slice(0, LIMITE);
  console.log(`Pages à mesurer : ${corpus.length} (${corpus.filter((c) => c.ensemble === 'connexions').length} connexions, ${corpus.filter((c) => c.ensemble === 'general').length} échantillon général).`);
  const existants = chargerResultatsPourReprise(FICHIER_RESULTATS, REPARTIR);
  const faits = new Set([...existants.values()].map((e) => e.cle));
  const aTraiter = corpus.filter((l) => !faits.has(`${l.ensemble}:${l.hote}`));
  if (faits.size) console.log(`Reprise : ${faits.size} déjà fait(s), ${aTraiter.length} restant(s).`);
  const context = await lancerContexteNavigateur({ fenetre: false });
  if (aTraiter.length) {
    const debut = performance.now();
    await traiterEnParallele(context, aTraiter, CONCURRENCE, async (page, ligne) => {
      let mesure;
      let issue = 'analyse';
      try {
        await page.goto(ligne.url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
        await page.waitForTimeout(FENETRE_FP_MS);
        await page.evaluate(bundle);
        mesure = await page.evaluate(() => globalThis.__tourmentinDeuxEtapes());
      } catch { issue = 'non-joignable'; }
      ecrireResultat(FICHIER_RESULTATS, { cle: `${ligne.ensemble}:${ligne.hote}`, ensemble: ligne.ensemble, hote: ligne.hote, segment: ligne.segment, etape: ligne.etape, issue, ...mesure });
    }, { surProgression: ({ termines, restants, ecouleS }) => console.log(`  ${termines} traité(s), ${restants} restant(s), écoulé ${formaterDuree(ecouleS)}.`) });
    console.log(`Mesure faite en ${formaterDuree((performance.now() - debut) / 1000)}.`);
  }
  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);
  rapporter();
}

function rapporter() {
  const tous = [...lireTousLesResultats(FICHIER_RESULTATS).values()];
  const off = existsSync(join(PUBLICATION, 'officiels.json')) ? JSON.parse(readFileSync(join(PUBLICATION, 'officiels.json'), 'utf8')) : { entrees: [] };
  const connus = new Set(off.entrees.map((e) => e.hote));
  const out = [];
  out.push(`# Mesure 14.57 : mémoire d'imitation et bandeau étendu — ${new Date().toISOString().slice(0, 10)}`);
  out.push('');
  out.push("Mesure seule : rien n'est activé. Adaptateur et moteur de production (`analyser()`, `imitationARetenir()`), pages réelles, aucune saisie, aucune soumission. « Aujourd'hui » : bandeau si N0, champ mot de passe, hors paiement, site non connu. « Étendu » : N0, sans mot de passe ni paiement, champ d'identifiant de connexion avec bouton d'envoi, site non connu, une fois par site.");
  out.push('');
  for (const [nom, ens] of [['Pages de connexion (corpus/corpus-connexions.csv)', 'connexions'], ['Échantillon du corpus général (graine fixe)', 'general']]) {
    const lot = tous.filter((r) => r.ensemble === ens);
    const ok = lot.filter((r) => r.issue === 'analyse');
    const parHote = (liste) => new Set(liste.map((r) => r.hote)).size;
    const aujourdhui = ok.filter((r) => r.niveau === 'N0' && r.aMdp && !r.paiement);
    const etendu = ok.filter((r) => r.niveau === 'N0' && !r.aMdp && !r.paiement && r.aIdentifiant && r.aBouton);
    const inconnu = (liste) => liste.filter((r) => !connus.has(r.hote));
    const retenues = ok.filter((r) => r.retenue);
    const changees = retenues.filter((r) => r.simulation && r.simulation.sans !== r.simulation.avec);
    out.push(`## ${nom}`);
    out.push('');
    out.push(`${lot.length} pages, ${ok.length} analysées (${lot.length - ok.length} non joignables, hors dénominateur).`);
    out.push('');
    out.push('| Mesure | Toutes les pages analysées | Dont site non connu de la liste publiée |');
    out.push('|---|---|---|');
    out.push(`| Bandeau d'aujourd'hui (mot de passe) | ${aujourdhui.length} | ${inconnu(aujourdhui).length} |`);
    out.push(`| **Bandeaux supplémentaires** (pages d'identifiant) | **${etendu.length}** | **${inconnu(etendu).length}** |`);
    out.push(`| Pages avec un champ d'identifiant (tous cas) | ${ok.filter((r) => r.aIdentifiant).length} | ${inconnu(ok.filter((r) => r.aIdentifiant)).length} |`);
    out.push(`| Pages qui retiendraient une imitation en mémoire (I ≥ 45) | ${retenues.length} | ${inconnu(retenues).length} |`);
    out.push(`| …dont l'écran 2 hypothétique changerait de verdict | **${changees.length}** | ${inconnu(changees).length} |`);
    out.push('');
    if (retenues.length) {
      out.push('Imitations retenues : ' + retenues.map((r) => `${r.hote} (${r.retenue.marque}, I=${r.retenue.scoreImitation}, écran 2 : ${r.simulation?.sans}→${r.simulation?.avec})`).join(' ; '));
      out.push('');
    }
    if (ens === 'connexions') {
      const deux = ok.filter((r) => r.etape === 'identifiant');
      out.push(`Sites en deux étapes (étape d'entrée = identifiant) : ${deux.length} analysés ; imitation retenue : ${deux.filter((r) => r.retenue).length} ; changement de verdict de l'écran 2 : ${deux.filter((r) => r.simulation && r.simulation.sans !== r.simulation.avec).length}.`);
      out.push('');
    }
    const parSegment = {};
    for (const r of etendu) parSegment[r.segment] = (parSegment[r.segment] ?? 0) + 1;
    out.push('Bandeaux supplémentaires par segment : ' + (Object.entries(parSegment).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ') || 'aucun'));
    out.push('');
    out.push(`Hôtes concernés par un bandeau supplémentaire : ${parHote(etendu)} sur ${parHote(ok)} hôtes analysés.`);
    out.push('');
  }
  const chemin = join(RACINE_PROJET, 'docs', `MESURE-DEUX-ETAPES-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(chemin, out.join('\n'), 'utf8');
  console.log(out.join('\n'));
  console.log(`\nRapport écrit : ${chemin}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => process.exit());
