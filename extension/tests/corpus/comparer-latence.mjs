// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.8 : un écart de centile sur un échantillon de quelques centaines
// de pages n'est pas une mesure tant que sa dispersion n'est pas connue. Ce
// script lit trois campagnes --mesure-latence --suffixe=1/2/3 (même échantillon,
// aucun changement de code entre les trois) et donne les trois p95, pour juger
// si un écart observé entre deux passes est du bruit de tirage ou une régression.
//
// Ne relance rien : lit mesure-latence-1.jsonl, mesure-latence-2.jsonl,
// mesure-latence-3.jsonl, déjà produits par :
//   npm run mesure-latence -- --suffixe=1
//   npm run mesure-latence -- --suffixe=2
//   npm run mesure-latence -- --suffixe=3
//
// À exécuter depuis extension/ : npm run comparer-latence
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const SUFFIXES = ['1', '2', '3'];

function lireMesures(suffixe) {
  const chemin = join(ICI, `mesure-latence-${suffixe}.jsonl`);
  let contenu;
  try {
    contenu = readFileSync(chemin, 'utf8');
  } catch {
    return null;
  }
  const parCle = new Map();
  for (const ligne of contenu.split('\n')) {
    if (!ligne.trim()) continue;
    const entree = JSON.parse(ligne);
    parCle.set(entree.cle, entree); // dernière écriture gagne, comme jsonl.mjs
  }
  return [...parCle.values()].filter((e) => e.issue === 'mesure');
}

function statsDelai(valeurs) {
  if (valeurs.length === 0) return undefined;
  const triees = [...valeurs].sort((a, b) => a - b);
  const percentile = (p) => triees[Math.min(triees.length - 1, Math.ceil((p / 100) * triees.length) - 1)];
  return { n: triees.length, mediane: percentile(50), p90: percentile(90), p95: percentile(95), p99: percentile(99), max: triees[triees.length - 1] };
}

const lignes = [];
lignes.push('| Répétition | n | Médiane | p90 | p95 | p99 | Max |');
lignes.push('|---|---|---|---|---|---|---|');

const p95s = [];
for (const suffixe of SUFFIXES) {
  const mesures = lireMesures(suffixe);
  if (!mesures) {
    console.log(`mesure-latence-${suffixe}.jsonl absent — lancer d'abord : npm run mesure-latence -- --suffixe=${suffixe}`);
    continue;
  }
  const stats = statsDelai(mesures.map((e) => e.premier?.depuisNavigationMs).filter((v) => typeof v === 'number'));
  if (!stats) {
    console.log(`Répétition ${suffixe} : aucune mesure exploitable.`);
    continue;
  }
  p95s.push(stats.p95);
  lignes.push(`| ${suffixe} | ${stats.n} | ${stats.mediane} ms | ${stats.p90} ms | ${stats.p95} ms | ${stats.p99} ms | ${stats.max} ms |`);
}

console.log('# Comparaison des trois répétitions — premier verdict depuis navigation (12.3.3.8)\n');
console.log(lignes.join('\n'));

if (p95s.length === SUFFIXES.length) {
  const ecart = Math.max(...p95s) - Math.min(...p95s);
  console.log(`\nÉcart entre le plus grand et le plus petit p95 des trois répétitions : ${ecart} ms.`);
  console.log(
    ecart > 13
      ? "Cet écart dépasse déjà les 13 ms relevés entre le 15/09 et le 22/09 : la dispersion de mesure à elle seule explique l'écart observé, la question d'une régression est close."
      : "Cet écart reste sous les 13 ms relevés entre le 15/09 et le 22/09 : la dispersion de mesure ne suffit pas à l'expliquer, un écart réel reste possible — voir le chronométrage direct de l'adaptateur (npm run mesurer-cout-adaptateur).",
  );
} else {
  console.log(`\n${SUFFIXES.length - p95s.length} répétition(s) manquante(s) — comparaison incomplète.`);
}
