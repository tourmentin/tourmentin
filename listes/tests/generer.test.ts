// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DOSSIER_SOCLE_DEFAUT, calculerVersion, genererSocle } from '../outils/generer.js';
import { CHAMPS_PUBLIES } from '../outils/projection.js';

let dossierTemporaire: string | undefined;

afterEach(() => {
  if (dossierTemporaire) {
    rmSync(dossierTemporaire, { recursive: true, force: true });
    dossierTemporaire = undefined;
  }
});

const MARQUES_DESACTIVEES = ['chorus-pro', 'msa', 'timbres-fiscaux'];

describe('genererSocle', () => {
  it('n\'inclut que les 9 marques actives, triées par id', () => {
    dossierTemporaire = mkdtempSync(join(tmpdir(), 'tourmentin-generer-'));
    const fichierPublie = join(dossierTemporaire, 'inexistant.json');
    const socle = genererSocle(DOSSIER_SOCLE_DEFAUT, fichierPublie, new Date('2026-09-12T00:00:00Z'));

    expect(socle.entrees.length).toBe(9);
    expect(socle.entrees.map((e) => (e as { id: string }).id)).toEqual(
      [...socle.entrees].map((e) => (e as { id: string }).id).sort(),
    );
    expect(socle.version).toBe('2026.09.001');
    expect(socle.genere_le).toBe('2026-09-12T00:00:00.000Z');
  });

  it('correction post-L2 (spec v1.5) : aucun champ hors de la projection ne fuit dans le fichier publié', () => {
    dossierTemporaire = mkdtempSync(join(tmpdir(), 'tourmentin-generer-'));
    const fichierPublie = join(dossierTemporaire, 'inexistant.json');
    const socle = genererSocle(DOSSIER_SOCLE_DEFAUT, fichierPublie, new Date('2026-09-12T00:00:00Z'));

    for (const entree of socle.entrees as Record<string, unknown>[]) {
      const champsInattendus = Object.keys(entree).filter((champ) => !CHAMPS_PUBLIES.includes(champ as never));
      expect(champsInattendus, `champ(s) hors projection sur ${entree.id} : ${champsInattendus}`).toEqual([]);
    }
    // Les commentaires de maintenance nommément visés par la correction : jamais publiés.
    const brut = JSON.stringify(socle);
    for (const champInterdit of ['a_verifier', 'notes_verification', 'avertissement']) {
      expect(brut).not.toContain(champInterdit);
    }
  });

  it('aucune des 3 marques inactives ne figure dans le fichier publié', () => {
    dossierTemporaire = mkdtempSync(join(tmpdir(), 'tourmentin-generer-'));
    const fichierPublie = join(dossierTemporaire, 'inexistant.json');
    const socle = genererSocle(DOSSIER_SOCLE_DEFAUT, fichierPublie, new Date('2026-09-12T00:00:00Z'));

    const idsPublies = socle.entrees.map((e) => (e as { id: string }).id);
    expect(idsPublies.length).toBe(9);
    for (const idInactif of MARQUES_DESACTIVEES) {
      expect(idsPublies).not.toContain(idInactif);
    }
  });
});

describe('calculerVersion', () => {
  it('démarre à 001 quand aucun socle.json précédent n\'existe', () => {
    dossierTemporaire = mkdtempSync(join(tmpdir(), 'tourmentin-version-'));
    const fichier = join(dossierTemporaire, 'socle.json');
    expect(calculerVersion(fichier, new Date('2026-09-12T00:00:00Z'))).toBe('2026.09.001');
  });

  it('incrémente la séquence dans le même mois', () => {
    dossierTemporaire = mkdtempSync(join(tmpdir(), 'tourmentin-version-'));
    const fichier = join(dossierTemporaire, 'socle.json');
    writeFileSync(fichier, JSON.stringify({ version: '2026.09.005' }));
    expect(calculerVersion(fichier, new Date('2026-09-20T00:00:00Z'))).toBe('2026.09.006');
  });

  it('cas limite : repart à 001 sur un nouveau mois', () => {
    dossierTemporaire = mkdtempSync(join(tmpdir(), 'tourmentin-version-'));
    const fichier = join(dossierTemporaire, 'socle.json');
    writeFileSync(fichier, JSON.stringify({ version: '2026.09.005' }));
    expect(calculerVersion(fichier, new Date('2026-10-01T00:00:00Z'))).toBe('2026.10.001');
  });

  it('cas limite : fichier précédent illisible → repart à 001 sans lever', () => {
    dossierTemporaire = mkdtempSync(join(tmpdir(), 'tourmentin-version-'));
    const fichier = join(dossierTemporaire, 'socle.json');
    writeFileSync(fichier, 'pas du json valide');
    expect(calculerVersion(fichier, new Date('2026-09-12T00:00:00Z'))).toBe('2026.09.001');
  });

  it('cas limite : fichier précédent sans champ version (chaîne) → repart à 001', () => {
    dossierTemporaire = mkdtempSync(join(tmpdir(), 'tourmentin-version-'));
    const fichier = join(dossierTemporaire, 'socle.json');
    writeFileSync(fichier, JSON.stringify({ version: 123 }));
    expect(calculerVersion(fichier, new Date('2026-09-12T00:00:00Z'))).toBe('2026.09.001');
  });
});
