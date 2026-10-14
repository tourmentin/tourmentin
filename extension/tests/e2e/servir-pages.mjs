// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Sert les pages d'imitation et de contrôle (tests/pages) sur cet ordinateur
// uniquement (127.0.0.1), pour le test manuel de l'extension chargée.
//
// Pourquoi *.localtest.me et pas localhost : Tourmentin éteint volontairement
// l'analyse sur localhost (Z4, 5.2). localtest.me est un nom public qui pointe
// vers 127.0.0.1 : la page est servie ici, mais l'extension la voit comme un
// vrai site. Il faut donc un accès Internet pour résoudre ce nom ; aucune donnée
// n'en sort (seule la résolution du nom passe par le DNS).
//
//   node tests/e2e/servir-pages.mjs        (depuis le dossier extension/)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', 'pages');
const PORT = 8765;

// Un nom d'hôte par page, voisin de celui du 12.5 (impots-gouv.fr, ameli-secure.fr...).
const PAGES = [
  ['imitations/01-impots-gouv.html', 'impots-gouv'],
  ['imitations/02-ameli.html', 'ameli-secure'],
  ['imitations/03-caf.html', 'caf-prestations'],
  ['imitations/04-franceconnect.html', 'franceconnect-secure'],
  ['imitations/05-laposte-colis.html', 'laposte-colis-frais'],
  ['imitations/06-urssaf.html', 'urssaf-declaration'],
  ['imitations/07-ants-carte-grise.html', 'ants-carte-grise'],
  ['imitations/08-france-travail.html', 'francetravail-actualisation'],
  ['imitations/09-service-public.html', 'service-public-demarches'],
  ['legitimes/01-mairie-contact.html', 'mairie-exemple'],
];
const url = (fichier, hote) => `http://${hote}.localtest.me:${PORT}/${fichier}`;

const serveur = createServer((req, res) => {
  const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (chemin === '/') {
    const liens = PAGES.map(([f, h]) => `<li><a href="${url(f, h)}">${f}</a></li>`).join('');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Pages de test</title><ul>${liens}</ul>`);
    return;
  }
  const cible = normalize(join(RACINE, chemin));
  if (!cible.startsWith(RACINE + sep) || !existsSync(cible) || !statSync(cible).isFile()) {
    res.writeHead(404).end('introuvable');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(readFileSync(cible));
});

serveur.listen(PORT, '127.0.0.1', () => {
  console.log('Pages de test servies sur cet ordinateur uniquement. Ctrl+C pour arrêter.\n');
  console.log(`Page à ouvrir : ${url(PAGES[0][0], PAGES[0][1])}`);
  console.log(`Toutes les pages : http://localtest.me:${PORT}/`);
});
