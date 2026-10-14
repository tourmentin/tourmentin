// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3 : localise la vraie page de connexion de chaque marque active
// du socle, en partant de son domaine vérifié — pas par crawl du corpus,
// par la même méthode de suivi de liens (12.3.3), appliquée à un seul hôte
// connu par marque plutôt qu'à 3 448 hôtes inconnus.
//
// N'invente aucune URL de mémoire : ce que produit ce script devient le
// champ url_connexion des empreintes, données durables, pas un résultat de
// script. Une marque où la mire n'est pas atteinte reste incomplète et
// a_verifier — jamais complétée par une URL non vérifiée.
//
// Vérifie aussi, pour chaque marque trouvée, que l'hôte de la mire
// appartient déjà à `domaines` de l'empreinte : sinon c'est un défaut du
// socle (la vraie page de connexion ne serait pas reconnue comme
// officielle), signalé mais jamais corrigé silencieusement ici.
//
// Aucune saisie, aucune soumission de formulaire.
//
// À exécuter depuis extension/ : npm run verifier-mires-socle
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'tldts';
import { champCsv } from './csv.mjs';
import { lancerContexteNavigateur } from './navigateur-sans-extension.mjs';
import { trouverPageConnexion } from './trouver-connexion.mjs';
import { construireBundleAdaptateur } from './bundle-adaptateur.mjs';
import { armerFiletDeSecurite } from './filet-de-securite.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_PROJET = join(ICI, '..', '..', '..');
const DOSSIER_SOCLE = join(RACINE_PROJET, 'listes', 'socle');
const SORTIE_CSV = join(RACINE_PROJET, 'corpus', 'connexions-socle.csv');

const FENETRE = process.argv.slice(2).includes('--fenetre');

// Même critère que le moteur (moteur/domaine.ts, appartientAuxDomaines) : un
// hôte appartient au socle si son domaine enregistrable égale celui d'un
// domaine listé — c'est ce que la règle Z2 vérifiera réellement.
const domaineEnregistrable = (h) => parse(h.toLowerCase()).domain ?? h.toLowerCase();
function appartientAuxDomaines(hote, domaines) {
  return domaines.some((d) => domaineEnregistrable(d) === domaineEnregistrable(hote));
}

function chargerEmpreintesActives() {
  return readdirSync(DOSSIER_SOCLE)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ fichier: join(DOSSIER_SOCLE, f), empreinte: JSON.parse(readFileSync(join(DOSSIER_SOCLE, f), 'utf8')) }))
    .filter((e) => e.empreinte.actif);
}

async function main() {
  armerFiletDeSecurite();
  const empreintes = chargerEmpreintesActives();
  console.log(`${empreintes.length} marque(s) active(s) du socle à vérifier.`);

  const bundle = await construireBundleAdaptateur();
  const context = await lancerContexteNavigateur({ fenetre: FENETRE });
  const page = await context.newPage();
    page.on('dialog', (dialog) => { dialog.dismiss().catch(() => {}); });

  const lignesRapport = [];
  const lignesCsv = [];
  const dateAujourdhui = new Date().toISOString().slice(0, 10);

  for (const { fichier, empreinte } of empreintes) {
    const domainePrincipal = empreinte.domaines_verifies?.[0] ?? empreinte.domaines[0];
    const urlDepart = `https://${domainePrincipal}/`;
    console.log(`${empreinte.id} : recherche depuis ${urlDepart}...`);

    let resultat;
    try {
      resultat = await trouverPageConnexion(page, urlDepart, bundle);
    } catch (erreur) {
      resultat = { issue: 'erreur-inattendue', motif: erreur?.message ?? String(erreur) };
    }

    if (resultat.issue === 'retenue') {
      // Hôte où la navigation a réellement abouti, pas celui du lien suivi :
      // c'est celui que le moteur verra, et celui qui révèle un changement de
      // domaine (service-public.fr -> service-public.gouv.fr).
      const hoteTrouve = new URL(resultat.urlFinale).hostname;
      const horsDomaines = !appartientAuxDomaines(hoteTrouve, empreinte.domaines);

      // url_connexion : URL du lien suivi depuis l'accueil, point d'entrée
      // stable (12.3.3.2). url_connexion_finale : origine + chemin, sans
      // state ni nonce.
      empreinte.url_connexion = resultat.url;
      empreinte.url_connexion_finale = resultat.urlFinale;
      empreinte.etape_connexion = resultat.etape;
      empreinte.mode_verification_connexion = 'automatique';
      empreinte.date_verification_connexion = dateAujourdhui;
      delete empreinte.url_connexion_motif_echec;
      if (horsDomaines) empreinte.url_connexion_hors_domaines = true;
      else delete empreinte.url_connexion_hors_domaines;
      writeFileSync(fichier, `${JSON.stringify(empreinte, null, 2)}\n`, 'utf8');

      lignesCsv.push(
        [
          champCsv(domainePrincipal),
          champCsv(hoteTrouve),
          champCsv(resultat.url),
          champCsv(resultat.urlFinale),
          champCsv(empreinte.libelle),
          champCsv(resultat.chemin),
          resultat.etape,
          dateAujourdhui,
        ].join(','),
      );
      lignesRapport.push({ id: empreinte.id, url: resultat.url, urlFinale: resultat.urlFinale, hote: hoteTrouve, mode: resultat.mode, etape: resultat.etape, horsDomaines });
      console.log(`  trouvée (${resultat.mode}, étape ${resultat.etape}) : ${resultat.url} -> ${resultat.urlFinale}${horsDomaines ? '  <-- HÔTE HORS DE domaines !' : ''}`);
    } else {
      empreinte.a_verifier = true;
      delete empreinte.url_connexion;
      delete empreinte.url_connexion_finale;
      delete empreinte.etape_connexion;
      delete empreinte.date_verification_connexion;
      delete empreinte.url_connexion_hors_domaines;
      empreinte.url_connexion_motif_echec = `${resultat.issue}${resultat.motif ? ` (${resultat.motif})` : ''}`;
      writeFileSync(fichier, `${JSON.stringify(empreinte, null, 2)}\n`, 'utf8');

      lignesRapport.push({ id: empreinte.id, libelle: empreinte.libelle, url: undefined, motifEchec: empreinte.url_connexion_motif_echec });
      console.log(`  non trouvée : ${empreinte.url_connexion_motif_echec}`);
    }
  }

  await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);

  const entetes = 'domaine,hote,url,url_finale,libelle,chemin,etape,date_verification';
  writeFileSync(SORTIE_CSV, [entetes, ...lignesCsv].join('\r\n') + '\r\n', 'utf8');
  console.log(`\nÉcrit : ${SORTIE_CSV} (${lignesCsv.length}/${empreintes.length} mire(s) trouvée(s))`);

  // 12.3.3.2 : tout hors-domaines passe en tête du rapport, avant le tableau.
  const horsDomainesListe = lignesRapport.filter((l) => l.horsDomaines);
  if (horsDomainesListe.length > 0) {
    console.log(`\n### HORS DOMAINES : ${horsDomainesListe.length} marque(s) dont la mire n'appartient pas à domaines (défaut du socle, non corrigé automatiquement)`);
    for (const l of horsDomainesListe) console.log(`  ${l.id} : ${l.hote}  (${l.urlFinale})`);
  } else {
    console.log('\n### HORS DOMAINES : aucun.');
  }

  console.log('\n| Marque | Étape | Mode | Entrée (lien suivi) | Aboutit sur | Hors domaines |');
  console.log('|---|---|---|---|---|---|');
  for (const l of lignesRapport) {
    if (l.url) console.log(`| ${l.id} | ${l.etape} | ${l.mode} | ${l.url} | ${l.urlFinale} | ${l.horsDomaines ? 'OUI' : 'non'} |`);
    else console.log(`| ${l.id} | non trouvée : ${l.motifEchec} | — | — | — | — |`);
  }
}

const ESTAPPELEDIRECTEMENT = fileURLToPath(import.meta.url) === process.argv[1];
if (ESTAPPELEDIRECTEMENT) {
  main()
    .catch((erreur) => {
      console.error(erreur);
      process.exitCode = 1;
    })
    .finally(() => process.exit());
}
