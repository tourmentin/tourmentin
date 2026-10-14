// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { chargerCorpus, chargerRacines, detecterCollisions, type LigneCorpus } from '../outils/verifier-racines-typo.ts';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..');

let dossierTemporaire: string | undefined;

afterEach(() => {
  if (dossierTemporaire) {
    rmSync(dossierTemporaire, { recursive: true, force: true });
    dossierTemporaire = undefined;
  }
});

describe('chargerCorpus', () => {
  it('découpe correctement une ligne dont le libellé contient une virgule entre guillemets', () => {
    dossierTemporaire = mkdtempSync(join(tmpdir(), 'tourmentin-corpus-'));
    const fichier = join(dossierTemporaire, 'corpus.csv');
    writeFileSync(
      fichier,
      'domaine,hote,url,segment,libelle,vitalite_indicative\n' +
        'exemple.fr,www.exemple.fr,https://exemple.fr,association,"Fête, jeux et loisirs",vivant\n',
    );
    const lignes = chargerCorpus(fichier);
    expect(lignes).toEqual([{ domaine: 'exemple.fr', hote: 'www.exemple.fr', segment: 'association' }]);
  });

  it('ignore les lignes vides en fin de fichier', () => {
    dossierTemporaire = mkdtempSync(join(tmpdir(), 'tourmentin-corpus-'));
    const fichier = join(dossierTemporaire, 'corpus.csv');
    writeFileSync(fichier, 'domaine,hote,url,segment,libelle,vitalite_indicative\na.fr,www.a.fr,https://a.fr,commune,A,vivant\n\n');
    expect(chargerCorpus(fichier)).toHaveLength(1);
  });
});

describe('chargerRacines', () => {
  it('lit les 12 empreintes du socle réel et leurs racines_typo', () => {
    const empreintes = chargerRacines();
    expect(empreintes).toHaveLength(12);
    const impots = empreintes.find((e) => e.id === 'impots-gouv');
    expect(impots?.racines_typo).toContain('dgfip');
  });
});

describe('detecterCollisions (spec 12.3.2 : comparaison par étiquette, plus par sous-chaîne libre)', () => {
  const corpus: LigneCorpus[] = [
    { domaine: 'ants.fr', hote: 'www.ants.fr', segment: 'administration' },
    { domaine: 'avantscene.com', hote: 'www.avantscene.com', segment: 'culture' },
    { domaine: 'assurancemaladiefictive.fr', hote: 'www.assurancemaladiefictive.fr', segment: 'sante' },
    { domaine: 'impots.gouv.fr', hote: 'www.impots.gouv.fr', segment: 'administration' },
  ];

  it('positif : une racine courte perçute un hôte dont une étiquette lui est identique', () => {
    const collisions = detecterCollisions([{ id: 'ants', racines_typo: ['ants'] }], corpus);
    expect(collisions).toEqual([{ racine: 'ants', marque: 'ants', hote: 'www.ants.fr', domaine: 'ants.fr', segment: 'administration' }]);
  });

  it('négatif : une racine courte en simple sous-chaîne d\'une étiquette plus longue n\'est plus une collision (« ants » dans « avantscene »)', () => {
    expect(detecterCollisions([{ id: 'ants', racines_typo: ['ants'] }], [corpus[1]!])).toEqual([]);
  });

  it('positif : une racine d\'au moins six caractères collisionne en sous-chaîne d\'une étiquette', () => {
    const collisions = detecterCollisions([{ id: 'ameli', racines_typo: ['assurancemaladie'] }], corpus);
    expect(collisions).toEqual([
      { racine: 'assurancemaladie', marque: 'ameli', hote: 'www.assurancemaladiefictive.fr', domaine: 'assurancemaladiefictive.fr', segment: 'sante' },
    ]);
  });

  it('négatif : aucune collision quand la racine n\'apparaît nulle part', () => {
    expect(detecterCollisions([{ id: 'caf', racines_typo: ['caf'] }], corpus)).toEqual([]);
  });

  it('insensible à la casse', () => {
    const collisions = detecterCollisions([{ id: 'ants', racines_typo: ['ANTS'] }], corpus);
    expect(collisions).toHaveLength(1);
  });
});

describe('node outils/verifier-racines-typo.ts (CLI)', () => {
  it('vérifie le socle et le corpus réels, et signale les collisions connues', () => {
    const sortie = execFileSync('node', [join(RACINE, 'outils', 'verifier-racines-typo.ts')], { cwd: RACINE, encoding: 'utf8' });
    expect(sortie).toMatch(/racines vérifiées sur \d+ hôtes/);
    expect(sortie).toContain('collision');
  });
});
