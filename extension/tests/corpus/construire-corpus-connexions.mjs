// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3, 12.3.3.2 et 12.3.3.3 : constitue corpus/corpus-connexions.csv en
// suivant les liens d'identification depuis la page d'accueil de chaque hôte —
// pas en sondant des chemins usuels en aveugle (méthode écartée, v1.18).
//
// v1.21 : deux changements de fond (repris ci-dessous). v1.25 : détection
// avec l'adaptateur DOM corrigé (12.3.3.7, formulaires implicites) —
// jsonl encore renommé pour ne reprendre aucun résultat de l'ancien adaptateur.
// v1.26 : trouver-connexion.mjs écarte désormais toute réponse HTTP hors 2xx
// (12.3.3.8) — jsonl renommé une troisième fois, une page retenue par
// l'ancienne logique peut avoir été une page d'erreur.
//  1. Une page se juge « de connexion » avec l'adaptateur DOM de l'extension
//     (bundle vite de src/adaptateurs/dom.ts), plus avec une détection propre
//     au script, avec l'attente du harnais puis une relecture périodique.
//  2. L'axe principal n'est plus sectoriel mais le segment `socle-affiche` :
//     pages qui affichent légitimement une marque du socle hors de ses
//     domaines, avec un formulaire (le bouton « S'identifier avec
//     FranceConnect » en tête). Repérées avec l'axe d'imitation du moteur sur
//     les pages déjà visitées : accueil de chaque hôte du corpus et page de
//     connexion suivie — aucune requête de plus. Cible 100, dont au moins 50
//     avec FranceConnect ; jamais complétée par des pages qui n'en sont pas.
//
// Tous les hôtes du corpus sont visités (ordre mélangé, graine fixe). Les pages
// de connexion trouvées par lien suivi et par chemin sondé sont rapportées à
// part ; les écrans d'administration de CMS sont plafonnés à 20 (back-office).
//
// Réutilise le harnais : page neuve par hôte (12.3.1.1), concurrence 4,
// filtrage de ressources inchangé (12.3.1), reprise par jsonl. Aucune
// extension chargée : le bundle de l'adaptateur est injecté dans la page.
//
// Aucune saisie, aucune soumission de formulaire, sur aucun site.
//
// À exécuter depuis extension/ : npm run construire-corpus-connexions
// Options :
//   --concurrence=N     pages simultanées, 4 par défaut
//   --limit=N           les N premiers hôtes de l'ordre mélangé (essai)
//   --fenetre           force l'affichage (headless par défaut)
//   --repartir-de-zero  ignore connexions-v1.26.jsonl existant
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decouperLigneCsv, champCsv } from './csv.mjs';
import { lireTousLesResultats, chargerResultatsPourReprise, ecrireResultat } from './jsonl.mjs';
import { traiterEnParallele, formaterDuree } from './pool-concurrent.mjs';
import { lancerContexteNavigateur } from './navigateur-sans-extension.mjs';
import { trouverPageConnexion, estBackOffice } from './trouver-connexion.mjs';
import { construireBundleAdaptateur } from './bundle-adaptateur.mjs';
import { tirerAuHasard } from './tirage.mjs';
import { trouverCandidats, selectionnerSocleAffiche, CIBLE_SOCLE_AFFICHE, MIN_FRANCECONNECT } from './selection-socle-affiche.mjs';
import { armerFiletDeSecurite } from './filet-de-securite.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_PROJET = join(ICI, '..', '..', '..');
const CORPUS_CSV = join(RACINE_PROJET, 'corpus', 'corpus-legitimes-v3.csv');
const SOCLE_CONNEXIONS_CSV = join(RACINE_PROJET, 'corpus', 'connexions-socle.csv');
const SORTIE_CSV = join(RACINE_PROJET, 'corpus', 'corpus-connexions.csv');
// Nom versionné : les jsonl précédents (détection propre au script, sans
// imitation) ne doivent pas être repris par accident.
const FICHIER_RESULTATS = join(ICI, 'connexions-v1.26.jsonl');

const GRAINE = 1;
// Garde-fou : aucun hôte ne peut suspendre la passe (une exécution est restée
// bloquée plus d'une heure sur un serveur qui répondait au compte-gouttes).
const DELAI_MAX_PAR_HOTE_MS = 180_000;
const PLAFOND_BACK_OFFICE = 20;

const arguments_ = process.argv.slice(2);
const optionNombre = (nom, defaut) => {
  const brut = arguments_.find((a) => a.startsWith(`--${nom}=`))?.split('=')[1];
  return brut ? Number(brut) : defaut;
};
const CONCURRENCE = optionNombre('concurrence', 4);
const LIMITE = optionNombre('limit', undefined);
const FENETRE = arguments_.includes('--fenetre');
const REPARTIR_DE_ZERO = arguments_.includes('--repartir-de-zero');

function chargerCorpus() {
  const lignes = readFileSync(CORPUS_CSV, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  const entetes = decouperLigneCsv(lignes[0]);
  const idx = (n) => entetes.indexOf(n);
  return lignes.slice(1).map((ligne) => {
    const c = decouperLigneCsv(ligne);
    return { domaine: c[idx('domaine')], hote: c[idx('hote')], url: c[idx('url')], segment: c[idx('segment')], libelle: c[idx('libelle')] };
  });
}

function chargerConnexionsSocle() {
  // Sous-ensemble distinct : rempli par verifier-mires-socle.mjs depuis les
  // empreintes de listes/socle/*.json — les mires officielles ne se cherchent
  // pas par crawl du corpus.
  try {
    const lignes = readFileSync(SOCLE_CONNEXIONS_CSV, 'utf8').split('\n').filter((l) => l.trim().length > 0);
    const entetes = decouperLigneCsv(lignes[0]);
    return lignes.slice(1).map((ligne) => Object.fromEntries(decouperLigneCsv(ligne).map((v, i) => [entetes[i], v])));
  } catch {
    return [];
  }
}

const pct = (n, total) => (total === 0 ? '—' : `${((100 * n) / total).toFixed(0)} %`);
const compter = (liste, cle) => {
  const o = {};
  for (const x of liste) o[cle(x)] = (o[cle(x)] ?? 0) + 1;
  return o;
};

async function fermer(context) {
  if (!context) return;
  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);
}

async function main() {
  armerFiletDeSecurite();
  const corpus = chargerCorpus();
  let ordre = tirerAuHasard(corpus, corpus.length, GRAINE);
  if (LIMITE) ordre = ordre.slice(0, LIMITE);
  console.log(`Corpus : ${corpus.length} hôtes, ${ordre.length} à visiter. Ordre mélangé, graine ${GRAINE}.`);

  const resultatsExistants = chargerResultatsPourReprise(FICHIER_RESULTATS, REPARTIR_DE_ZERO);
  const hotesDejaTraites = new Set([...resultatsExistants.values()].map((e) => e.hote));
  let backOffice = [...resultatsExistants.values()].filter((e) => e.issue === 'retenue-back-office').length;
  const aTraiter = ordre.filter((l) => !hotesDejaTraites.has(l.hote));
  if (hotesDejaTraites.size > 0) console.log(`Reprise : ${hotesDejaTraites.size} hôte(s) déjà traité(s), ${aTraiter.length} restant(s).`);

  let context;
  if (aTraiter.length > 0) {
    console.log("Construction du bundle de l'adaptateur DOM de l'extension...");
    const bundle = await construireBundleAdaptateur();
    context = await lancerContexteNavigateur({ fenetre: FENETRE });
    console.log(`Visite de ${aTraiter.length} hôte(s), concurrence ${CONCURRENCE}...`);
    const debut = performance.now();
    await traiterEnParallele(
      context,
      aTraiter,
      CONCURRENCE,
      async (page, ligne) => {
        const recherche = trouverPageConnexion(page, ligne.url, bundle);
        recherche.catch(() => {}); // la page est fermée à l'échéance : une rejection tardive n'est pas une erreur
        let minuteur;
        const echeance = new Promise((resolve) => {
          minuteur = setTimeout(() => resolve({ issue: 'delai-depasse' }), DELAI_MAX_PAR_HOTE_MS);
        });
        const resultat = await Promise.race([recherche, echeance]).finally(() => clearTimeout(minuteur));
        // Section synchrone : un seul ouvrier la traverse à la fois.
        if (resultat.issue === 'retenue' && (estBackOffice(resultat.urlFinale) || estBackOffice(resultat.chemin))) {
          if (backOffice < PLAFOND_BACK_OFFICE) {
            backOffice++;
            resultat.issue = 'retenue-back-office';
          } else {
            resultat.issue = 'back-office-hors-plafond';
          }
        }
        ecrireResultat(FICHIER_RESULTATS, {
          cle: `connexion:${ligne.hote}`,
          hote: ligne.hote,
          domaine: ligne.domaine,
          segmentOrigine: ligne.segment,
          libelle: ligne.libelle,
          horodatage: new Date().toISOString(),
          ...resultat,
        });
      },
      {
        surProgression: ({ termines, restants, ecouleS }) => {
          console.log(`  ${termines} visité(s), ${restants} restant(s), back-office ${backOffice}/${PLAFOND_BACK_OFFICE}, écoulé ${formaterDuree(ecouleS)}.`);
        },
      },
    );
    console.log(`Visite terminée en ${formaterDuree((performance.now() - debut) / 1000)}.`);
  }

  // --- CSV final, relu depuis le jsonl ---------------------------------------

  const resultatsFinaux = [...lireTousLesResultats(FICHIER_RESULTATS).values()];
  const retenues = resultatsFinaux.filter((e) => e.issue === 'retenue');
  const retenuesBackOffice = resultatsFinaux.filter((e) => e.issue === 'retenue-back-office');
  const dateSondage = new Date().toISOString().slice(0, 10);

  const candidats = trouverCandidats(resultatsFinaux);
  const selection = selectionnerSocleAffiche(candidats);

  const entetes =
    'domaine,hote,url,url_finale,segment,segment_origine,libelle,vitalite_indicative,chemin,mode,etape,marque_affichee,marqueurs,score_imitation,source,date_sondage';
  const ligneConnexion = (e, segment) =>
    [champCsv(e.domaine), champCsv(e.hote), champCsv(e.url), champCsv(e.urlFinale), segment, champCsv(e.segmentOrigine), champCsv(e.libelle), 'vivant', champCsv(e.chemin), e.mode, e.etape, '', '', '', '', dateSondage].join(',');
  const ligneAffichee = (c) =>
    [
      champCsv(c.domaine),
      champCsv(c.hote),
      champCsv(c.url),
      champCsv(c.url),
      'socle-affiche',
      champCsv(c.segmentOrigine),
      champCsv(c.libelle),
      'vivant',
      champCsv(new URL(c.url).pathname),
      '',
      c.etape ?? '',
      champCsv(c.marques.map((m) => m.marque).join(' ')),
      champCsv(c.marques.map((m) => `${m.marque}: ${m.termesForts.join(' | ')}`).join(' ; ')),
      c.scoreImitation,
      c.source,
      dateSondage,
    ].join(',');

  const lignesCsv = [
    ...retenues.map((e) => ligneConnexion(e, 'connexion')),
    ...retenuesBackOffice.map((e) => ligneConnexion(e, 'connexion-back-office')),
    ...selection.retenues.map(ligneAffichee),
  ];
  const socle = chargerConnexionsSocle();
  for (const s of socle) {
    lignesCsv.push(
      [champCsv(s.domaine), champCsv(s.hote), champCsv(s.url), champCsv(s.url_finale), 'connexion-socle', '', champCsv(s.libelle), 'vivant', champCsv(s.chemin), 'socle', s.etape, '', '', '', '', s.date_verification].join(','),
    );
  }
  mkdirSync(dirname(SORTIE_CSV), { recursive: true });
  writeFileSync(SORTIE_CSV, [entetes, ...lignesCsv].join('\r\n') + '\r\n', 'utf8');
  await fermer(context);
  console.log(`Écrit : ${SORTIE_CSV} (${retenues.length} connexion, ${retenuesBackOffice.length} back-office, ${selection.retenues.length} socle-affiche, ${socle.length} socle)`);

  // --- rapport ---------------------------------------------------------------

  console.log(`\n## Segment socle-affiche (priorité, 12.3.3.3)`);
  console.log(`Candidates repérées (une par hôte, marqueur fort hors domaines + formulaire) : ${selection.disponibles}, dont FranceConnect ${selection.disponiblesFranceConnect}.`);
  console.log(`Retenues : ${selection.retenues.length}/${CIBLE_SOCLE_AFFICHE}, dont FranceConnect ${selection.retenuesFranceConnect} (minimum ${MIN_FRANCECONNECT} : ${selection.minFranceConnectAtteint ? 'atteint' : 'NON ATTEINT'}).`);
  if (selection.manque > 0) console.log(`Cible non atteinte : il manque ${selection.manque} page(s) ; le corpus n'en contient pas davantage, on ne complète pas.`);
  const parMarque = compter(selection.retenues.flatMap((c) => c.marques), (m) => m.marque);
  console.log(`Par marque affichée : ${Object.entries(parMarque).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}.`);
  const parSource = compter(selection.retenues, (c) => c.source);
  console.log(`Page retenue : ${Object.entries(parSource).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}.`);
  const parScore = compter(selection.retenues, (c) => (c.scoreImitation === 0 ? '0' : c.scoreImitation < 55 ? '1-54' : '>=55'));
  console.log(`Score d'imitation : ${Object.entries(parScore).map(([k, v]) => `${k} : ${v}`).join(', ') || '—'} (seuil minimal d'alerte 55).`);

  console.log(`\n## Pages de connexion (segment connexion)`);
  const parModeSegment = compter(retenues, (e) => `${e.segmentOrigine}|${e.mode}`);
  const segments = [...new Set(retenues.map((e) => e.segmentOrigine))].sort();
  console.log('| Segment d\'origine | Retenues | dont lien suivi | dont chemin sondé |');
  console.log('|---|---|---|---|');
  for (const s of segments) {
    const l = parModeSegment[`${s}|lien-suivi`] ?? 0;
    const c = parModeSegment[`${s}|chemin-sonde`] ?? 0;
    console.log(`| ${s} | ${l + c} | ${l} | ${c} |`);
  }
  const lien = retenues.filter((e) => e.mode === 'lien-suivi').length;
  console.log(`\nTotal ${retenues.length} : lien suivi ${lien} (${pct(lien, retenues.length)}), chemin sondé ${retenues.length - lien}. Étapes : ${Object.entries(compter(retenues, (e) => e.etape)).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  console.log(`Back-office (hors quotas) : ${retenuesBackOffice.length}/${PLAFOND_BACK_OFFICE}, ${resultatsFinaux.filter((e) => e.issue === 'back-office-hors-plafond').length} au-delà du plafond.`);

  console.log('\nCauses de non-rétention :');
  const causes = compter(
    resultatsFinaux.filter((e) => e.issue !== 'retenue' && e.issue !== 'retenue-back-office'),
    (e) => e.issue,
  );
  for (const [cause, n] of Object.entries(causes).sort((a, b) => b[1] - a[1])) console.log(`  ${cause} : ${n}`);
  const horsForm = resultatsFinaux.filter((e) => e.issue === 'champs-hors-formulaire');
  if (horsForm.length > 0) {
    console.log(`\nCandidats d'angle mort du produit : ${horsForm.length} page(s) de connexion dont les champs sont hors de tout <form> (invisibles pour Z5), par exemple :`);
    for (const e of horsForm.slice(0, 8)) console.log(`  ${e.hote} -> ${e.urlLien}`);
  }
}

const ESTAPPELEDIRECTEMENT = fileURLToPath(import.meta.url) === process.argv[1];
if (ESTAPPELEDIRECTEMENT) {
  main()
    .catch((erreur) => {
      console.error(erreur);
      process.exitCode = 1;
    })
    // Le navigateur peut refuser de se fermer proprement : le CSV est déjà écrit, on sort.
    .finally(() => process.exit());
}
