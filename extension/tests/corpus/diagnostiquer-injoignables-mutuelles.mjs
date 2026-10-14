// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.17, point 5 : diagnostic seul, pas de contournement. Cinq
// établissements du relevé des mires étaient déclarés « injoignables »
// (accueil-reponse-non-2xx) alors que leurs sites fonctionnent -- très
// probablement une protection anti-robot. Ce script se contente d'observer
// ce que deux méthodes honnêtes reçoivent comme réponse : un fetch() avec un
// agent explicite et non trompeur (le même que sonderChemins dans
// trouver-connexion.mjs), et une navigation Playwright normale, identique à
// celle du harnais -- pas de user-agent de navigateur usurpé au niveau
// fetch, pas de résolution de défi JavaScript, pas de contournement.
//
// Objectif : savoir si c'est un 403 explicite, un blocage réseau/TLS, un
// défi JavaScript (page interstitielle avant le vrai contenu), ou autre
// chose -- pour distinguer, dans le rapport, « site indisponible » de
// « accès refusé au harnais ».
//
// Aucune saisie, aucune soumission de formulaire.
//
// À exécuter depuis extension/ : node tests/corpus/diagnostiquer-injoignables-mutuelles.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lancerContexteNavigateur } from './navigateur-sans-extension.mjs';
import { armerFiletDeSecurite } from './filet-de-securite.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_PROJET = join(ICI, '..', '..', '..');
const DOSSIER_DOCS = join(RACINE_PROJET, 'docs');

const AGENT_SONDAGE =
  'TourmentinCorpusBot/1.0 (recherche de pages de connexion legitimes pour un corpus de test anti-hameconnage ; usage interne, non public)';

const HOTES = ['www.allianz.fr', 'www.allianz-trade.com', 'www.gmf.fr', 'www.maaf.fr', 'www.mma.fr'];
const TIMEOUT_FETCH_MS = 15_000;
const TIMEOUT_NAVIGATION_MS = 20_000;
const LONGUEUR_EXTRAIT = 600;

async function sonderFetch(hote) {
  const url = `https://${hote}/`;
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_FETCH_MS);
  try {
    const reponse = await fetch(url, { signal: controleur.signal, redirect: 'follow', headers: { 'User-Agent': AGENT_SONDAGE } });
    const corps = await reponse.text().catch(() => '');
    return {
      methode: 'fetch',
      statut: reponse.status,
      urlFinale: reponse.url,
      entetes: Object.fromEntries(reponse.headers.entries()),
      extraitCorps: corps.slice(0, LONGUEUR_EXTRAIT),
    };
  } catch (erreur) {
    return { methode: 'fetch', erreur: String(erreur?.message ?? erreur).split('\n')[0] };
  } finally {
    clearTimeout(minuteur);
  }
}

async function sonderNavigateur(context, hote) {
  const url = `https://${hote}/`;
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  try {
    const reponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
    const titre = await page.title().catch(() => '');
    const corps = await page.evaluate(() => document.body?.innerText?.slice(0, 600) ?? '').catch(() => '');
    return {
      methode: 'navigateur',
      statut: reponse?.status(),
      urlFinale: page.url(),
      entetes: reponse ? Object.fromEntries(Object.entries(await reponse.allHeaders())) : {},
      titre,
      extraitTexteVisible: corps,
    };
  } catch (erreur) {
    return { methode: 'navigateur', erreur: String(erreur?.message ?? erreur).split('\n')[0] };
  } finally {
    await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
  }
}

const ENTETES_UTILES = ['server', 'content-type', 'cf-ray', 'cf-mitigated', 'x-akamai-transformed', 'retry-after', 'set-cookie', 'x-frame-options', 'location'];

function resumerEntetes(entetes) {
  if (!entetes) return '—';
  const trouves = ENTETES_UTILES.filter((h) => entetes[h] !== undefined).map((h) => `${h}: ${entetes[h]}`.slice(0, 120));
  return trouves.length > 0 ? trouves.join('; ') : '(aucun en-tête notable)';
}

async function main() {
  armerFiletDeSecurite();
  const context = await lancerContexteNavigateur({ fenetre: false });

  const resultats = [];
  for (const hote of HOTES) {
    console.log(`\n== ${hote}`);
    const f = await sonderFetch(hote);
    const n = await sonderNavigateur(context, hote);
    console.log(`  fetch      : ${f.statut ?? `erreur (${f.erreur})`}`);
    console.log(`  navigateur : ${n.statut ?? `erreur (${n.erreur})`} — titre : "${n.titre ?? ''}"`);
    resultats.push({ hote, fetch: f, navigateur: n });
  }

  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);

  const lignes = [];
  lignes.push(`# Diagnostic des cinq établissements injoignables — ${new Date().toISOString().slice(0, 10)}`);
  lignes.push('');
  lignes.push(
    "Spec 12.3.3.17, point 5 : diagnostic seul, aucun contournement. Deux méthodes honnêtes par hôte -- fetch() " +
      'avec un agent explicite et non trompeur, et une navigation Playwright normale, identique à celle du harnais. ' +
      "Aucune imitation de navigateur au niveau fetch, aucune résolution de défi JavaScript.",
  );
  lignes.push('');
  lignes.push('| Hôte | Code (fetch) | Code (navigateur) | En-têtes notables (navigateur) | Titre de la page | Lecture |');
  lignes.push('|---|---|---|---|---|---|');
  for (const r of resultats) {
    const codeFetch = r.fetch.statut ?? `err: ${r.fetch.erreur}`;
    const codeNav = r.navigateur.statut ?? `err: ${r.navigateur.erreur}`;
    const entetes = resumerEntetes(r.navigateur.entetes);
    const titre = (r.navigateur.titre ?? '').replace(/\|/g, '\\|');
    lignes.push(`| ${r.hote} | ${codeFetch} | ${codeNav} | ${entetes} | ${titre} | voir §2 |`);
  }
  lignes.push('');
  lignes.push('## Détail par hôte, extrait de corps (600 premiers caractères)');
  lignes.push('');
  for (const r of resultats) {
    lignes.push(`### ${r.hote}`);
    lignes.push('');
    lignes.push('**fetch()** : ' + (r.fetch.statut !== undefined ? `HTTP ${r.fetch.statut}, url finale ${r.fetch.urlFinale}` : `erreur — ${r.fetch.erreur}`));
    lignes.push('');
    if (r.fetch.entetes) lignes.push('En-têtes notables : ' + resumerEntetes(r.fetch.entetes));
    lignes.push('');
    if (r.fetch.extraitCorps) {
      lignes.push('```');
      lignes.push(r.fetch.extraitCorps.replace(/```/g, "'''"));
      lignes.push('```');
    }
    lignes.push('');
    lignes.push('**navigateur (Playwright, comme le harnais)** : ' + (r.navigateur.statut !== undefined ? `HTTP ${r.navigateur.statut}, url finale ${r.navigateur.urlFinale}, titre « ${r.navigateur.titre} »` : `erreur — ${r.navigateur.erreur}`));
    lignes.push('');
    if (r.navigateur.entetes) lignes.push('En-têtes notables : ' + resumerEntetes(r.navigateur.entetes));
    lignes.push('');
    if (r.navigateur.extraitTexteVisible) {
      lignes.push('```');
      lignes.push(r.navigateur.extraitTexteVisible.replace(/```/g, "'''"));
      lignes.push('```');
    }
    lignes.push('');
  }

  mkdirSync(DOSSIER_DOCS, { recursive: true });
  const chemin = join(DOSSIER_DOCS, `DIAGNOSTIC-INJOIGNABLES-MUTUELLES-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(chemin, lignes.join('\n'), 'utf8');
  console.log(`\nRapport écrit : ${chemin}`);
}

main()
  .catch((erreur) => { console.error(erreur); process.exitCode = 1; })
  .finally(() => process.exit());
