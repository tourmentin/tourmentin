// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.5, point 4, et 12.3.3.17 : relevé ponctuel, pas une passe de
// faux positifs. Cherche les pages de connexion des mutuelles, assurances et
// caisses de retraite du segment `banque` du corpus, avec la détection de
// l'extension (même chemin que trouver-connexion.mjs), et donne pour chacune
// le score d'imitation, la marque retenue, les termes qui l'ont produit, ET
// (12.3.3.17, point 6) le verdict complet du moteur — niveau, signaux E,
// motif — pas seulement le score d'imitation : sans le niveau, ce relevé ne
// dit pas si C1 tient.
//
// 12.3.3.17, point 5 : « injoignable » n'est plus un motif de sortie
// accepté. Chaque échec de connexion porte son code et sa cause, et le
// rapport distingue « site indisponible » (échec réseau : DNS, TLS, délai
// dépassé) de « accès refusé au harnais » (réponse HTTP reçue, hors 2xx —
// très probablement une protection anti-robot, voir
// diagnostiquer-injoignables-mutuelles.mjs pour l'observer en détail).
//
// Aucune saisie, aucune soumission.
//
// À exécuter depuis extension/ : npm run relever-mutuelles
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decouperLigneCsv } from './csv.mjs';
import { lancerContexteNavigateur } from './navigateur-sans-extension.mjs';
import { trouverPageConnexion } from './trouver-connexion.mjs';
import { construireBundleAdaptateur } from './bundle-adaptateur.mjs';
import { armerFiletDeSecurite } from './filet-de-securite.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_PROJET = join(ICI, '..', '..', '..');
const CORPUS_CSV = join(RACINE_PROJET, 'corpus', 'corpus-legitimes-v3.csv');
const DOSSIER_DOCS = join(RACINE_PROJET, 'docs');
const FENETRE = process.argv.slice(2).includes('--fenetre');

// Repéré à la main dans le segment banque du corpus (12.3.3.5) : mutuelles,
// assurances et caisses de retraite — le vocabulaire visé par le point 4, pas
// les banques ni les studios de jeu qui partagent ce segment. Complété le
// 24/09/2026 (12.3.3.17, point 4) : mutuelles de fonction publique et
// caisses, absentes du premier tour.
const HOTES = [
  'www.ag2rlamondiale.fr',
  'www.allianz.fr',
  'www.allianz-trade.com',
  'www.april.fr',
  'www.axa.fr',
  'www.caisse-epargne.fr',
  'www.gmf.fr',
  'www.gbanque.com',
  'www.harmonie-mutuelle.fr',
  'www.klesia.fr',
  'www.maaf.fr',
  'www.maif.fr',
  'www.malakoffhumanis.com',
  'www.matmut.fr',
  'www.mma.fr',
  'www.probtp.com',
  // Ajoutés le 24/09/2026 (12.3.3.17, point 4) : mutuelles de fonction
  // publique et caisses, vérifiés un par un (recherche web, pas de domaine
  // deviné). CPAM et MSA n'ont pas de domaine propre distinct d'ameli.fr et
  // msa.fr respectivement -- non ajoutés, voir la note du relevé.
  'www.mgen.fr',
  'www.lamutuellegenerale.fr',
  'www.apicil.com',
  'www.groupe-uneo.fr',
  'www.mnh.fr',
  'www.mnt.fr',
  'www.interiale.fr',
  'www.audiens.org',
  'www.agrica.fr',
  'www.mfp.fr',
  'www.carsat-normandie.fr',
  'www.carsat-hdf.fr',
  'www.carsat-pl.fr',
  'www.carsat-sudest.fr',
  'www.carsat-alsacemoselle.fr',
];

/**
 * 12.3.3.17, point 5 : classe un échec de connexion en deux causes, jamais
 * en simple « injoignable ». Réseau (DNS, TLS, délai dépassé, jamais de
 * réponse HTTP) contre réponse HTTP reçue mais hors 2xx (très probablement
 * une protection anti-robot répondant au harnais).
 */
function classifierEchecConnexion(resultat) {
  if (resultat.issue === 'accueil-non-joignable' || resultat.issue === 'lien-non-joignable') {
    return { cause: 'site indisponible', detail: resultat.motif ?? 'motif réseau non précisé' };
  }
  if (resultat.issue === 'accueil-reponse-non-2xx' || resultat.issue === 'lien-reponse-non-2xx') {
    return { cause: 'accès refusé au harnais', detail: `HTTP ${resultat.statut}` };
  }
  return { cause: resultat.issue, detail: resultat.motif ?? '' };
}

async function main() {
  armerFiletDeSecurite();
  const corpus = readFileSync(CORPUS_CSV, 'utf8').split('\n').filter((l) => l.trim());
  const entetes = decouperLigneCsv(corpus[0]);
  const idx = (n) => entetes.indexOf(n);
  const lignes = corpus.slice(1).map((l) => decouperLigneCsv(l));
  const parHote = new Map(lignes.map((c) => [c[idx('hote')], { hote: c[idx('hote')], url: c[idx('url')], libelle: c[idx('libelle')] }]));

  console.log("Construction du bundle de l'adaptateur DOM de l'extension...");
  const bundle = await construireBundleAdaptateur();
  const context = await lancerContexteNavigateur({ fenetre: FENETRE });

  const resultats = [];
  for (const hote of HOTES) {
    const ligne = parHote.get(hote) ?? { hote, url: `https://${hote}/`, libelle: '' };
    if (!parHote.has(hote)) console.log(`${hote} : absent du corpus légitime, recherche quand même depuis https://${hote}/.`);
    const page = await context.newPage();
    page.on('dialog', (dialog) => { dialog.dismiss().catch(() => {}); });
    console.log(`\n${ligne.libelle || hote} (${hote}) : recherche depuis ${ligne.url}...`);
    let resultat;
    let verdict;
    try {
      const recherche = trouverPageConnexion(page, ligne.url, bundle);
      const echeance = new Promise((r) => setTimeout(() => r({ issue: 'delai-depasse' }), 60_000));
      resultat = await Promise.race([recherche, echeance]);
      // 12.3.3.17, point 6 : verdict complet du moteur sur la page où l'on
      // s'est arrêté (connexion trouvée ou, à défaut, dernière page lue) —
      // le bundle reste chargé tant que la page n'a pas navigué depuis son
      // dernier appel interne à analyserPage().
      verdict = await page.evaluate(() => globalThis.__tourmentinVerdict?.()).catch(() => undefined);
    } catch (erreur) {
      resultat = { issue: 'erreur', motif: String(erreur?.message ?? erreur).split('\n')[0] };
    } finally {
      await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
    }
    const imitation = resultat.imitationConnexion ?? resultat.imitationAccueil;
    resultats.push({ hote, libelle: ligne.libelle, resultat, imitation, verdict });
    if (resultat.issue === 'retenue') {
      console.log(`  page de connexion : ${resultat.urlFinale} (étape ${resultat.etape}, ${resultat.mode})`);
    } else if (['accueil-non-joignable', 'lien-non-joignable', 'accueil-reponse-non-2xx', 'lien-reponse-non-2xx'].includes(resultat.issue)) {
      const { cause, detail } = classifierEchecConnexion(resultat);
      console.log(`  ${cause} : ${detail}`);
    } else {
      console.log(`  pas de page de connexion retenue : ${resultat.issue}${resultat.motif ? ` (${resultat.motif})` : ''} — score relevé sur ${imitation ? imitation.url : "l'accueil, non lu"}`);
    }
    if (imitation) {
      console.log(`  score d'imitation : ${imitation.scoreImitation} — marque retenue : ${imitation.marqueDetectee ?? '—'}`);
      for (const s of imitation.signaux) console.log(`    ${s.code} (poids ${s.poids}, ${s.famille}) : ${s.detail}`);
      if (imitation.marqueurs.length > 0) {
        console.log('  autres marqueurs forts détectés (hors marque retenue ou sous le score max) :');
        for (const m of imitation.marqueurs) console.log(`    ${m.marque}${m.horsDomaines ? '' : ' (sur son propre domaine)'} : ${m.termesForts.join(' | ')}`);
      }
    } else {
      console.log('  aucune lecture disponible.');
    }
    if (verdict) {
      console.log(`  verdict complet : ${verdict.niveau} — ${verdict.motif}`);
      for (const s of verdict.signauxExposition ?? []) console.log(`    ${s.code} (poids ${s.poids}, ${s.famille}) : ${s.detail}`);
    }
  }

  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);

  const retenues = resultats.filter((r) => r.resultat.issue === 'retenue');
  const echecsConnexion = resultats.filter((r) => ['accueil-non-joignable', 'lien-non-joignable', 'accueil-reponse-non-2xx', 'lien-reponse-non-2xx'].includes(r.resultat.issue));
  const autresIssues = resultats.filter((r) => !retenues.includes(r) && !echecsConnexion.includes(r));

  const mdLignes = [];
  mdLignes.push(`# Relevé des mires de mutuelles, assurances et caisses — ${new Date().toISOString().slice(0, 10)}`);
  mdLignes.push('');
  mdLignes.push(
    "Spec 12.3.3.5, point 4, et 12.3.3.17. Détection de l'extension (bundle de src/adaptateurs/dom.ts), même " +
      "chemin que le sous-corpus des connexions. Score d'imitation ET verdict complet (niveau, signaux E, motif) — " +
      `${HOTES.length} hôte(s) interrogé(s), ${retenues.length} page(s) de connexion retenue(s), ${echecsConnexion.length} ` +
      `échec(s) de connexion classés, ${autresIssues.length} autre(s) issue(s).`,
  );
  mdLignes.push('');
  mdLignes.push('## 1. Pages de connexion retenues');
  mdLignes.push('');
  mdLignes.push('| Établissement | Score I | Marque retenue | Termes forts | Niveau | Signaux E | Motif du verdict |');
  mdLignes.push('|---|---|---|---|---|---|---|');
  for (const r of retenues) {
    const im = r.imitation;
    const marque = im?.marqueurs.find((m) => m.marque === im.marqueDetectee);
    const signauxE = (r.verdict?.signauxExposition ?? []).map((s) => s.code).join(', ');
    mdLignes.push(
      `| ${r.libelle || r.hote} | ${im?.scoreImitation ?? '—'} | ${im?.marqueDetectee ?? '—'} | ${marque?.termesForts.join(' \\| ') ?? '—'} | ${r.verdict?.niveau ?? '—'} | ${signauxE || '—'} | ${r.verdict?.motif ?? '—'} |`,
    );
  }
  mdLignes.push('');
  mdLignes.push('## 2. Échecs de connexion, classés (12.3.3.17, point 5 : jamais un simple « injoignable »)');
  mdLignes.push('');
  mdLignes.push('| Établissement | Cause | Détail |');
  mdLignes.push('|---|---|---|');
  for (const r of echecsConnexion) {
    const { cause, detail } = classifierEchecConnexion(r.resultat);
    mdLignes.push(`| ${r.libelle || r.hote} | ${cause} | ${detail} |`);
  }
  mdLignes.push('');
  if (autresIssues.length > 0) {
    mdLignes.push('## 3. Autres issues');
    mdLignes.push('');
    mdLignes.push('| Établissement | Issue | Score I relevé | Marque |');
    mdLignes.push('|---|---|---|---|');
    for (const r of autresIssues) {
      const im = r.imitation;
      mdLignes.push(`| ${r.libelle || r.hote} | ${r.resultat.issue}${r.resultat.motif ? ` (${r.resultat.motif})` : ''} | ${im?.scoreImitation ?? '—'} | ${im?.marqueDetectee ?? '—'} |`);
    }
    mdLignes.push('');
  }

  mkdirSync(DOSSIER_DOCS, { recursive: true });
  const cheminRapport = join(DOSSIER_DOCS, `RELEVE-MIRES-MUTUELLES-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(cheminRapport, mdLignes.join('\n'), 'utf8');
  console.log(`\nRapport écrit : ${cheminRapport}`);

  console.log('\n\n## Relevé (12.3.3.5, point 4 ; 12.3.3.17, point 6)');
  console.log('| Établissement | Score | Marque retenue | Termes forts | Niveau |');
  console.log('|---|---|---|---|---|');
  for (const r of resultats) {
    const im = r.imitation;
    const marque = im?.marqueurs.find((m) => m.marque === im.marqueDetectee);
    console.log(`| ${r.libelle || r.hote} | ${im?.scoreImitation ?? '—'} | ${im?.marqueDetectee ?? '—'} | ${marque?.termesForts.join(' \\| ') ?? '—'} | ${r.verdict?.niveau ?? '—'} |`);
  }
}

main()
  .catch((erreur) => {
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
