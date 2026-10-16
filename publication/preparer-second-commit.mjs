#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.56 / 14.61 : prépare un NOUVEAU commit sur le dépôt déjà publié, sans réécrire l'historique et sans rien pousser.
//   1. exporte l'état commité de ce dépôt de travail dans un dossier temporaire (exporter-depot.mjs : exclusions, README public, contrôle de pré-publication) ;
//   2. aligne le dépôt publié (dossier local déjà poussé) sur cet export : fichiers ajoutés, modifiés, supprimés ; jamais le dossier .git ;
//   3. relance le contrôle de pré-publication sur le dépôt publié ;
//   4. crée UN commit (auteur et committeur neutres) et s'arrête : le « git push » (sans --force) est une étape séparée, après le feu vert de Ph.
//   node publication/preparer-second-commit.mjs <dossier du dépôt publié> "<message du commit>"
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const [depot, message] = process.argv.slice(2);
if (!depot || !message) { console.error('usage : node publication/preparer-second-commit.mjs <dépôt publié> "<message>"'); process.exit(2); }
const g = (...a) => execFileSync('git', a, { cwd: depot, encoding: 'utf8' }).trim();

if (!existsSync(join(depot, '.git'))) { console.error("REFUS : ce dossier n'est pas un dépôt Git."); process.exit(2); }
if (g('status', '--porcelain')) { console.error('REFUS : le dépôt publié a des modifications non commitées.'); process.exit(2); }
if (g('branch', '--show-current') !== 'main') { console.error("REFUS : la branche courante n'est pas main."); process.exit(2); }
if (g('rev-parse', 'HEAD') !== g('rev-parse', 'origin/main')) { console.error("REFUS : le dépôt local n'est pas aligné sur origin/main."); process.exit(2); }
const avant = g('rev-parse', '--short', 'HEAD');

const tmp = mkdtempSync(join(tmpdir(), 'tmt-export-'));
const sortie = join(tmp, 'export');
const exp = spawnSync(process.execPath, [join(ICI, 'exporter-depot.mjs'), sortie], { stdio: 'inherit' });
if (exp.status !== 0) { console.error("\nSORTIE : l'export ou son contrôle a échoué ; le dépôt publié n'est pas touché."); rmSync(tmp, { recursive: true, force: true }); process.exit(1); }

const lister = (racine, prefixe = '') => readdirSync(join(racine, prefixe)).flatMap((n) => {
  if (n === '.git' && prefixe === '') return [];
  const rel = prefixe ? `${prefixe}/${n}` : n;
  return statSync(join(racine, rel)).isDirectory() ? lister(racine, rel) : [rel];
});
const nouveaux = new Set(lister(sortie));
for (const f of lister(depot)) if (!nouveaux.has(f)) rmSync(join(depot, f), { force: true });
for (const f of nouveaux) { mkdirSync(dirname(join(depot, f)), { recursive: true }); copyFileSync(join(sortie, f), join(depot, f)); }
rmSync(tmp, { recursive: true, force: true });

console.log('\n--- Contrôle de pré-publication sur le dépôt publié (état à commiter) ---');
const c = spawnSync(process.execPath, [join(ICI, 'controle-prepublication.mjs'), depot], { stdio: 'inherit' });
if (c.status !== 0) { console.error('\nSORTIE : le contrôle refuse. Aucun commit créé ; les fichiers du dépôt publié ont été alignés, à examiner.'); process.exit(1); }

g('add', '-A');
if (!g('status', '--porcelain')) { console.log('\nAucune différence avec le dépôt publié : aucun commit à créer.'); process.exit(0); }
execFileSync('git', ['-c', 'user.name=Les auteurs de Tourmentin', '-c', 'user.email=contact@tourmentin.fr', 'commit', '-q', '-m', message], { cwd: depot, stdio: 'inherit' });
console.log(`\nCommit créé. Historique : ${g('log', '--format=%h %an <%ae> %s').split('\n').join('  |  ')}`);
console.log(`Premier commit inchangé : ${g('rev-list', '--max-parents=0', 'HEAD').slice(0, 7)} (avant : ${avant}). Rien n'est poussé : « git push » sans --force, après le feu vert de Ph.`);
console.log(g('diff', '--shortstat', 'HEAD~1', 'HEAD'));
