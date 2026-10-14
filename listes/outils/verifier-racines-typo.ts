// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lot L5, livrable 5 (chapitre 12.6) : confronte chaque racine de racines_typo
// des empreintes du socle au corpus de sites légitimes, et recense les
// collisions — une racine assez générique pour percuter un domaine honnête.
// Ne corrige rien : c'est une entrée du calibrage du lot L6, pas une
// correction du harnais.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estAppeleDirectement } from './cli.ts';
import { racineCorrespondAuHote } from './comparaison-racines.ts';

const ICI = dirname(fileURLToPath(import.meta.url));
const DOSSIER_SOCLE_DEFAUT = join(ICI, '..', 'socle');
const CORPUS_DEFAUT = join(ICI, '..', '..', 'corpus', 'corpus-legitimes-v3.csv');

export interface LigneCorpus {
  domaine: string;
  hote: string;
  segment: string;
}

export interface Collision {
  racine: string;
  marque: string;
  hote: string;
  domaine: string;
  segment: string;
}

/**
 * Découpage minimal d'une ligne CSV respectant les guillemets : suffisant ici
 * puisque les seuls champs qui nous intéressent (domaine, hote, segment)
 * précèdent toujours le champ libellé, le seul à contenir des virgules.
 */
function decouperLigneCsv(ligne: string): string[] {
  const champs: string[] = [];
  let courant = '';
  let dansGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (c === '"') {
      dansGuillemets = !dansGuillemets;
    } else if (c === ',' && !dansGuillemets) {
      champs.push(courant);
      courant = '';
    } else {
      courant += c;
    }
  }
  champs.push(courant);
  return champs;
}

export function chargerCorpus(fichier: string = CORPUS_DEFAUT): LigneCorpus[] {
  const lignes = readFileSync(fichier, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  const entetes = decouperLigneCsv(lignes[0]!);
  const indexDomaine = entetes.indexOf('domaine');
  const indexHote = entetes.indexOf('hote');
  const indexSegment = entetes.indexOf('segment');
  return lignes.slice(1).map((ligne) => {
    const champs = decouperLigneCsv(ligne);
    return { domaine: champs[indexDomaine]!, hote: champs[indexHote]!, segment: champs[indexSegment]! };
  });
}

interface EmpreinteRacines {
  id: string;
  racines_typo: string[];
}

export function chargerRacines(dossierSocle: string = DOSSIER_SOCLE_DEFAUT): EmpreinteRacines[] {
  return readdirSync(dossierSocle)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const brute = JSON.parse(readFileSync(join(dossierSocle, f), 'utf8')) as EmpreinteRacines;
      return { id: brute.id, racines_typo: brute.racines_typo };
    });
}

/**
 * Une racine « percute » un hôte légitime si elle correspond à une étiquette
 * entière de son nom (découpé sur les points et les tirets), ou à une
 * sous-chaîne d'une étiquette pour les racines d'au moins six caractères —
 * voir comparaison-racines.ts pour le raisonnement (spec 12.3.2).
 */
export function detecterCollisions(empreintes: EmpreinteRacines[], corpus: LigneCorpus[]): Collision[] {
  const collisions: Collision[] = [];
  for (const empreinte of empreintes) {
    for (const racine of empreinte.racines_typo) {
      for (const ligne of corpus) {
        if (racineCorrespondAuHote(racine, ligne.hote)) {
          collisions.push({ racine, marque: empreinte.id, hote: ligne.hote, domaine: ligne.domaine, segment: ligne.segment });
        }
      }
    }
  }
  return collisions;
}

/* v8 ignore start -- bloc CLI, exécuté par un test en sous-processus */
if (estAppeleDirectement(import.meta.url)) {
  const empreintes = chargerRacines();
  const corpus = chargerCorpus();
  const collisions = detecterCollisions(empreintes, corpus);

  console.log(`${empreintes.reduce((n, e) => n + e.racines_typo.length, 0)} racines vérifiées sur ${corpus.length} hôtes du corpus.`);
  if (collisions.length === 0) {
    console.log('Aucune collision.');
  } else {
    console.log(`${collisions.length} collision(s) :`);
    console.table(collisions);
  }
}
/* v8 ignore stop */
