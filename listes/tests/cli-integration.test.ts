// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Exécute réellement les scripts (node outils/xxx.ts <args>) plutôt que
// d'appeler leurs fonctions exportées : c'est le seul moyen de couvrir les
// blocs `if (estAppeleDirectement(...))`, et ça teste ce que Pierre-Hervé
// tapera vraiment (npm run generer / signer / verifier).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import { afterEach, describe, expect, it } from 'vitest';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..');
const FICHIER_PUBLIE = join(RACINE, 'publie', 'socle.json');

const cleSecrete = ed25519.utils.randomSecretKey();
const cleSecreteHex = Buffer.from(cleSecrete).toString('hex');
const clePubliqueHex = Buffer.from(ed25519.getPublicKey(cleSecrete)).toString('hex');

function executer(script: string, args: string[] = [], env: NodeJS.ProcessEnv = process.env) {
  try {
    const sortie = execFileSync('node', [join(RACINE, 'outils', script), ...args], {
      cwd: RACINE,
      env,
      encoding: 'utf8',
    });
    return { code: 0, sortie };
  } catch (erreur) {
    const e = erreur as { status: number | null; stdout: string; stderr: string };
    return { code: e.status ?? 1, sortie: e.stdout + e.stderr };
  }
}

let dossierTemporaire: string | undefined;

afterEach(() => {
  if (dossierTemporaire) {
    rmSync(dossierTemporaire, { recursive: true, force: true });
    dossierTemporaire = undefined;
  }
});

describe('node outils/generer.ts', () => {
  it('écrit listes/publie/socle.json avec les 9 marques actives', () => {
    const { code } = executer('generer.ts');
    expect(code).toBe(0);
    expect(existsSync(FICHIER_PUBLIE)).toBe(true);
    const socle = JSON.parse(readFileSync(FICHIER_PUBLIE, 'utf8'));
    expect(socle.entrees.length).toBe(9);
    expect(socle.version).toMatch(/^\d{4}\.\d{2}\.\d{3}$/);

    const idsPublies = socle.entrees.map((e: { id: string }) => e.id);
    for (const idInactif of ['chorus-pro', 'msa', 'timbres-fiscaux']) {
      expect(idsPublies).not.toContain(idInactif);
    }
  });
});

describe('node outils/signer.ts', () => {
  it('signe un fichier avec la clé fournie par variable d\'environnement', () => {
    dossierTemporaire = mkdtempSync(join(tmpdir(), 'tourmentin-cli-'));
    const entree = join(dossierTemporaire, 'liste.json');
    const sortie = join(dossierTemporaire, 'liste.signee.json');
    writeFileSync(entree, JSON.stringify({ version: '2026.09.001', genere_le: '2026-09-12T00:00:00.000Z', entrees: [] }));

    const { code } = executer('signer.ts', [entree, sortie], { ...process.env, TOURMENTIN_CLE_PRIVEE_SOCLE: cleSecreteHex });
    expect(code).toBe(0);
    const signee = JSON.parse(readFileSync(sortie, 'utf8'));
    expect(typeof signee.signature).toBe('string');

    const { code: codeVerif, sortie: sortieVerif } = executer('verifier.ts', [sortie, clePubliqueHex]);
    expect(codeVerif).toBe(0);
    expect(sortieVerif).toContain('valide');
  });

  it('négatif : sans la variable d\'environnement, échoue et n\'écrit rien', () => {
    dossierTemporaire = mkdtempSync(join(tmpdir(), 'tourmentin-cli-'));
    const entree = join(dossierTemporaire, 'liste.json');
    const sortie = join(dossierTemporaire, 'liste.signee.json');
    writeFileSync(entree, JSON.stringify({ version: '2026.09.001', genere_le: '2026-09-12T00:00:00.000Z', entrees: [] }));

    const envSansCle = { ...process.env };
    delete envSansCle.TOURMENTIN_CLE_PRIVEE_SOCLE;
    const { code, sortie: journal } = executer('signer.ts', [entree, sortie], envSansCle);
    expect(code).not.toBe(0);
    expect(journal).toMatch(/absente/);
    expect(existsSync(sortie)).toBe(false);
  });

  it('cas limite : arguments manquants → usage et code non nul', () => {
    const { code, sortie } = executer('signer.ts', []);
    expect(code).not.toBe(0);
    expect(sortie).toMatch(/Usage/);
  });
});

describe('node outils/verifier.ts', () => {
  it('rejette une signature invalide avec le code de sortie 1', () => {
    dossierTemporaire = mkdtempSync(join(tmpdir(), 'tourmentin-cli-'));
    const fichier = join(dossierTemporaire, 'liste.signee.json');
    writeFileSync(fichier, JSON.stringify({ version: '2026.09.001', genere_le: '...', entrees: [], signature: '00'.repeat(64) }));

    const { code, sortie } = executer('verifier.ts', [fichier, clePubliqueHex]);
    expect(code).toBe(1);
    expect(sortie).toContain('INVALIDE');
  });

  it('cas limite : arguments manquants → usage et code non nul', () => {
    const { code, sortie } = executer('verifier.ts', []);
    expect(code).not.toBe(0);
    expect(sortie).toMatch(/Usage/);
  });
});
