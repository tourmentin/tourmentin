// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lot L2, livrable 1 : agrège listes/socle/*.json en un unique listes/publie/socle.json.
// N'inclut que les marques actives (schema.ts : estActive), et projette
// chacune vers le seul contrat publié (projection.ts) : le fichier produit
// n'est pas une copie des fichiers sources (5.3, spec v1.5). Ne signe pas —
// voir signer.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estAppeleDirectement } from './cli.ts';
import { projeterEmpreinte } from './projection.ts';
import { empreinteSchema, estActive, type EmpreinteBrute } from './schema.ts';
import type { ListeSocle } from './canonique.ts';

const ICI = dirname(fileURLToPath(import.meta.url));
export const DOSSIER_SOCLE_DEFAUT = join(ICI, '..', 'socle');
export const FICHIER_PUBLIE_DEFAUT = join(ICI, '..', 'publie', 'socle.json');

export function chargerEmpreintes(dossierSocle: string): EmpreinteBrute[] {
  return readdirSync(dossierSocle)
    .filter((f) => f.endsWith('.json'))
    .map((f) => empreinteSchema.parse(JSON.parse(readFileSync(join(dossierSocle, f), 'utf8'))));
}

/**
 * AAAA.MM.NNN : NNN reprend la séquence du mois en cours si un socle.json du
 * même mois existe déjà à `fichierPublie`, repart de 001 sinon (nouveau mois,
 * ou première génération — listes/publie/ n'est pas versionné dans git).
 */
export function calculerVersion(fichierPublie: string, maintenant: Date): string {
  const anneeMois = `${maintenant.getUTCFullYear()}.${String(maintenant.getUTCMonth() + 1).padStart(2, '0')}`;
  let sequence = 1;
  if (existsSync(fichierPublie)) {
    try {
      const precedent = JSON.parse(readFileSync(fichierPublie, 'utf8')) as { version?: unknown };
      const version = typeof precedent.version === 'string' ? precedent.version : '';
      const separateur = version.lastIndexOf('.');
      const anneeMoisPrecedent = version.slice(0, separateur);
      const sequencePrecedente = Number(version.slice(separateur + 1));
      if (anneeMoisPrecedent === anneeMois && Number.isInteger(sequencePrecedente)) {
        sequence = sequencePrecedente + 1;
      }
    } catch {
      // socle.json précédent illisible ou mal formé : on repart de 001 plutôt
      // que d'échouer la génération pour un historique corrompu.
    }
  }
  return `${anneeMois}.${String(sequence).padStart(3, '0')}`;
}

export function genererSocle(
  dossierSocle: string = DOSSIER_SOCLE_DEFAUT,
  fichierPublie: string = FICHIER_PUBLIE_DEFAUT,
  maintenant: Date = new Date(),
): ListeSocle {
  const entrees = chargerEmpreintes(dossierSocle)
    .filter(estActive)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(projeterEmpreinte);

  return {
    version: calculerVersion(fichierPublie, maintenant),
    genere_le: maintenant.toISOString(),
    entrees,
  };
}

/* v8 ignore start -- exécuté dans un sous-processus par cli-integration.test.ts (node outils/generer.ts) ;
   la couverture v8 ne voit que le process courant, pas les enfants. Comportement vérifié par ce test, pas par ce rapport. */
if (estAppeleDirectement(import.meta.url)) {
  const socle = genererSocle();
  mkdirSync(dirname(FICHIER_PUBLIE_DEFAUT), { recursive: true });
  writeFileSync(FICHIER_PUBLIE_DEFAUT, `${JSON.stringify(socle, null, 2)}\n`, 'utf8');
  console.log(`socle.json généré (non signé) : ${socle.entrees.length} marque(s) active(s), version ${socle.version}`);
  console.log("Lancer 'npm run signer' pour produire la version signée.");
}
/* v8 ignore stop */
