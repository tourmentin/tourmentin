#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.56 : copie propre du dépôt pour une publication sans historique. Produit un DOSSIER à partir de l'état COMMITÉ (git archive HEAD : jamais les fichiers non suivis,
// jamais l'historique), retire ce qui ne doit pas partir, puis lance le contrôle de pré-publication. Ne crée aucun dépôt et ne pousse rien.
//   node publication/exporter-depot.mjs <dossier de sortie> [--avec-corpus] [--init-git]
//   --avec-corpus : inclut corpus/ (données dont la licence n'est pas décidée, 14.54 : exclu par défaut)
//   --init-git    : APRÈS un contrôle propre, initialise un dépôt local neuf dans le dossier, un seul commit, auteur « Les auteurs de Tourmentin <contact@tourmentin.fr> ».
//                   Ne pousse rien : la création du dépôt GitHub et le premier envoi attendent le feu vert de Ph.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..');
const args = process.argv.slice(2);
const sortie = args.find((a) => !a.startsWith('--'));
const AVEC_CORPUS = args.includes('--avec-corpus');
const INIT_GIT = args.includes('--init-git');
if (!sortie) { console.error('usage : node publication/exporter-depot.mjs <dossier de sortie> [--avec-corpus] [--init-git]'); process.exit(2); }
const cible = resolve(sortie);
const rel = relative(RACINE, cible);
if (!rel.startsWith('..') && !isAbsolute(rel)) { console.error(`REFUS : le dossier de sortie est dans le dépôt (${cible}).`); process.exit(2); }
if (existsSync(cible) && readdirSync(cible).length > 0) { console.error(`REFUS : ${cible} existe et n'est pas vide.`); process.exit(2); }

// exclusions (chemins relatifs, préfixes) ; chaque ligne est dite à l'écran
const EXCLUSIONS = [
  ['site/archive/', "ancienne page du 11/09/2026 (mentions d'une autre activité) : abandonnée, jamais publiée"],
  ...(AVEC_CORPUS ? [] : [['corpus/', 'données (sites légitimes, relevés) dont la licence n\'est pas décidée (14.54) ; --avec-corpus pour les inclure']]),
  ['captures-', 'captures d\'écran de contrôle'],
  ['docs/', 'la spécification et tous les documents de travail internes (relevés, mesures, rapports) : la spec n\'est pas publiée (14.56)'],
  ['CLAUDE.md', 'instructions de travail internes'],
  ['publication/README-public.md', 'modèle du README public (il devient README.md, ci-dessous)'],
];

const git = (...a) => execFileSync('git', a, { cwd: RACINE, encoding: 'utf8' });
const tarWindows = process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';

const sale = git('status', '--porcelain', '--untracked-files=no').trim();
if (sale) { console.error('REFUS : des modifications ne sont pas commitées ; l\'export part de HEAD, il ne représenterait pas votre arbre de travail.\n' + sale); process.exit(2); }
const tete = git('rev-parse', '--short', 'HEAD').trim();

mkdirSync(cible, { recursive: true });
const archive = join(cible, '..', `.export-${Date.now()}.tar`);
execFileSync('git', ['archive', '--format=tar', '-o', archive, 'HEAD'], { cwd: RACINE });
execFileSync(tarWindows, ['-xf', archive, '-C', cible]);
rmSync(archive, { force: true });
console.log(`Export de HEAD (${tete}) dans ${cible}, sans historique.`);

for (const [prefixe, raison] of EXCLUSIONS) {
  const nom = prefixe.endsWith('/') ? prefixe.slice(0, -1) : prefixe;
  // un préfixe sans « / » final et sans extension désigne les entrées de premier niveau qui commencent ainsi (captures-*) ; sinon, un chemin exact
  const cibles = prefixe.endsWith('/') || prefixe.includes('.') ? [nom] : readdirSync(cible).filter((n) => n.startsWith(prefixe));
  for (const c of cibles) {
    if (!existsSync(join(cible, c))) continue;
    rmSync(join(cible, c), { recursive: true, force: true });
    console.log(`  exclu : ${c}${prefixe.endsWith('/') ? '/' : prefixe.includes('.') ? '' : '*'}  (${raison})`);
  }
}

// README public : court, relu par Ph avant d'être figé (publication/README-public.md)
copyFileSync(join(RACINE, 'publication', 'README-public.md'), join(cible, 'README.md'));
console.log('  README.md public ajouté (modèle : publication/README-public.md)');

const controle = spawnSync(process.execPath, [join(ICI, 'controle-prepublication.mjs'), cible], { stdio: 'inherit' });
if (controle.status !== 0) { console.log('\nL\'export est refusé par le contrôle : le dossier est laissé en l\'état pour examen, rien n\'est initialisé.'); process.exit(1); }

if (INIT_GIT) {
  const g = (...a) => execFileSync('git', a, { cwd: cible, encoding: 'utf8' });
  g('init', '-b', 'main');
  g('config', 'user.name', 'Les auteurs de Tourmentin');
  g('config', 'user.email', 'contact@tourmentin.fr');
  g('add', '-A');
  g('commit', '-m', 'Version initiale');
  console.log('\nDépôt local initialisé (un seul commit, auteur neutre). Rien n\'est poussé : créer le dépôt GitHub et envoyer seulement après le feu vert de Ph.');
} else {
  console.log('\nContrôle propre. Aucun dépôt initialisé (--init-git, après le feu vert de Ph). Rien n\'est poussé.');
}
