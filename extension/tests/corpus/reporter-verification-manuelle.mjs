// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.6 : reporte dans les empreintes du socle une vérification
// manuelle conduite par le porteur de projet lui-même, dans un navigateur réel
// — pas une donnée que ce dépôt peut produire seul. Le rôle de ce script est
// d'appliquer une transcription EXACTE des observations de 12.3.3.6, jamais
// d'aller lire quoi que ce soit : « pas à la main dans les fichiers » veut
// dire par un script versionné et relisable, pas par une saisie qui n'a que
// git pour trace.
//
// À exécuter depuis extension/ : npm run reporter-verification-manuelle
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'tldts';

const ICI = dirname(fileURLToPath(import.meta.url));
const DOSSIER_SOCLE = join(ICI, '..', '..', '..', 'listes', 'socle');
const DATE = '2026-09-22';

// Même critère que le moteur (appartientAuxDomaines) : comparaison au niveau
// du domaine enregistrable, pas de la chaîne exacte — "oui, par domaine
// enregistrable" pour urssaf en 12.3.3.6 (login.urssaf.fr, alors que domaines
// ne liste que urssaf.fr et des sous-domaines différents).
const domaineEnregistrable = (h) => parse(h.toLowerCase()).domain ?? h.toLowerCase();
function appartientAuxDomaines(hote, domaines) {
  return domaines.some((d) => domaineEnregistrable(d) === domaineEnregistrable(hote));
}

// Transcription de 12.3.3.6, telle quelle.
const VERIFICATIONS = {
  ameli: { url: 'https://assure.ameli.fr/', etape: 'identifiant' },
  caf: { url: 'https://connect.caf.fr/', etape: 'ecran-de-choix' },
  urssaf: { url: 'https://login.urssaf.fr/', etape: 'mot-de-passe' },
  laposte: {
    motif: "bouton « Se connecter » construit en script, sans adresse ; le clic n'a produit ni navigation ni URL lisible",
  },
  franceconnect: {
    motif:
      "pas de mire propre : accessible seulement depuis le bouton d'un service partenaire, qui mène à l'écran de choix du fournisseur d'identité et lancerait une authentification réelle — non vérifié pour cette raison",
  },
};

function appliquer(id, verif) {
  const fichier = join(DOSSIER_SOCLE, `${id}.json`);
  const empreinte = JSON.parse(readFileSync(fichier, 'utf8'));

  empreinte.mode_verification_connexion = 'verification-manuelle';
  empreinte.date_verification_connexion = DATE;

  if (verif.url) {
    empreinte.url_connexion = verif.url;
    empreinte.url_connexion_finale = verif.url;
    empreinte.etape_connexion = verif.etape;
    const hote = new URL(verif.url).hostname;
    empreinte.url_connexion_hors_domaines = !appartientAuxDomaines(hote, empreinte.domaines);
    delete empreinte.url_connexion_motif_echec;
    console.log(`${id} : url_connexion = ${verif.url}, étape ${verif.etape}, hors domaines = ${empreinte.url_connexion_hors_domaines}.`);
  } else {
    delete empreinte.url_connexion;
    delete empreinte.url_connexion_finale;
    delete empreinte.etape_connexion;
    delete empreinte.url_connexion_hors_domaines;
    empreinte.url_connexion_motif_echec = verif.motif;
    console.log(`${id} : sans url_connexion — ${verif.motif}`);
  }

  writeFileSync(fichier, `${JSON.stringify(empreinte, null, 2)}\n`, 'utf8');
}

function retirerCheminDesDomaines(id, entree) {
  const fichier = join(DOSSIER_SOCLE, `${id}.json`);
  const empreinte = JSON.parse(readFileSync(fichier, 'utf8'));
  const avant = empreinte.domaines.length;
  empreinte.domaines = empreinte.domaines.filter((d) => d !== entree);
  if (empreinte.domaines.length === avant) {
    console.log(`${id} : "${entree}" déjà absent de domaines, rien à faire.`);
    return;
  }
  writeFileSync(fichier, `${JSON.stringify(empreinte, null, 2)}\n`, 'utf8');
  console.log(`${id} : "${entree}" retiré de domaines (chemin, pas un hôte — 12.3.3.6).`);
}

for (const [id, verif] of Object.entries(VERIFICATIONS)) appliquer(id, verif);
// Après les url_connexion : l'entrée reste rejetable par le nouveau contrôle
// de forme du schéma (12.3.3.6) tant qu'elle est présente, mais on la retire
// explicitement plutôt que de compter sur la validation pour le remarquer.
retirerCheminDesDomaines('ameli', 'ameli.fr/assure');

console.log('\nTerminé.');
