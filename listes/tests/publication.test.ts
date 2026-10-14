// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { creerFichierCle, lireClePrivee } from '../outils/cle.js';
import { construirePublication, differences, octetsSignes, validerExport, versionSuivante } from '../outils/publication.js';

const MARQUES = new Set(['ameli', 'caf']);
const PARAM_RAPIDES = { N: 2 ** 10, r: 8, p: 1 };

describe('octetsSignes', () => {
  it('porte le nom de la liste : un fichier ne peut pas être rejoué sous un autre nom', () => {
    const a = octetsSignes('officiels', '2026.10.001', '2026-10-06T00:00:00.000Z', []);
    const b = octetsSignes('frauduleux', '2026.10.001', '2026-10-06T00:00:00.000Z', []);
    expect(a.equals(b)).toBe(false);
    expect(a.toString('utf8')).toBe('tmt-liste-v1\nofficiels\n{"version":"2026.10.001","genere_le":"2026-10-06T00:00:00.000Z","entrees":[]}');
  });
});

describe('validerExport', () => {
  const bon = {
    officiels: [{ hote: 'www.exemple.fr', marque: 'ameli', valide_le: '2026-10-06' }, { hote: 'sans-marque.fr', marque: null, valide_le: '2026-10-06' }, { hote: 'autre.fr', valide_le: '2026-10-06' }],
    frauduleux: [{ hote: 'faux.example.net', portee: 'hote', confirme_le: '2026-10-05' }],
  };

  it('accepte un export conforme', () => {
    const r = validerExport(bon, MARQUES);
    expect(r.problemes).toEqual([]);
    expect(r.export?.officiels).toHaveLength(3);
    expect(r.export?.officiels[2]?.marque).toBeNull();
  });

  it('refuse ce qui n\'est pas un objet ou n\'a pas les deux tableaux', () => {
    expect(validerExport(null, MARQUES).problemes).toHaveLength(1);
    expect(validerExport('x', MARQUES).problemes).toHaveLength(1);
    expect(validerExport({ officiels: [] }, MARQUES).problemes[0]).toMatch(/tableaux/);
  });

  it('refuse les hôtes invalides, les dates invalides, les doublons et les marques inconnues', () => {
    const r = validerExport(
      {
        officiels: [
          { hote: 'Majuscule.fr', valide_le: '2026-10-06' },
          { hote: '*.exemple.fr', valide_le: '2026-10-06' },
          { hote: 'localhost', valide_le: '2026-10-06' },
          { hote: 'ok.fr', valide_le: '6 octobre' },
          { hote: 'ok.fr', marque: 'inconnue', valide_le: '2026-10-06' },
          { hote: 'ok2.fr', marque: 42, valide_le: '2026-10-06' },
          null,
        ],
        frauduleux: [{ hote: 'ok.fr', portee: 'hote', confirme_le: '2026-10-06' }, null],
      },
      MARQUES,
    );
    expect(r.export).toBeUndefined();
    const t = r.problemes.join('\n');
    expect(t).toMatch(/officiels\[0\] : hôte invalide/);
    expect(t).toMatch(/officiels\[1\] : hôte invalide/);
    expect(t).toMatch(/officiels\[2\] : hôte invalide/);
    expect(t).toMatch(/valide_le invalide/);
    expect(t).toMatch(/hôte en double/);
    expect(t).toMatch(/marque inconnue/);
    expect(t).toMatch(/officiels\[6\] : hôte invalide/);
    expect(t).toMatch(/frauduleux\[1\] : hôte invalide/);
  });

  it('14.44 : accepte un répertorié (sans marque) et le conserve ; refuse un statut inconnu et un répertorié avec marque', () => {
    const ok = validerExport({ officiels: [{ hote: 'www.mairie.example.fr', marque: null, valide_le: '2026-10-08', statut: 'repertorie' }, { hote: 'b.example.fr', valide_le: '2026-10-08' }], frauduleux: [] }, MARQUES);
    expect(ok.problemes).toEqual([]);
    expect(ok.export?.officiels[0]).toMatchObject({ hote: 'www.mairie.example.fr', statut: 'repertorie', marque: null });
    expect(ok.export?.officiels[1]).not.toHaveProperty('statut');
    const mauvais = validerExport({ officiels: [{ hote: 'a.example.fr', valide_le: '2026-10-08', statut: 'valide' }, { hote: 'c.example.fr', marque: 'ameli', statut: 'repertorie', valide_le: '2026-10-08' }], frauduleux: [] }, MARQUES);
    expect(mauvais.problemes.join('\n')).toMatch(/statut « valide » inconnu/);
    expect(mauvais.problemes.join('\n')).toMatch(/répertorié n'a pas de marque/);
  });

  it('refuse la portée « domaine » et toute portée autre que « hote »', () => {
    const r = validerExport({ officiels: [], frauduleux: [{ hote: 'a.fr', portee: 'domaine', confirme_le: '2026-10-06' }, { hote: 'b.fr', confirme_le: '2026-10-06' }] }, MARQUES);
    expect(r.problemes.join('\n')).toMatch(/portée « domaine » est refusée/);
    expect(r.problemes.join('\n')).toMatch(/portée « undefined » est refusée/);
  });
});

describe('versionSuivante', () => {
  const t = new Date('2026-10-06T10:00:00Z');
  it('première version, même mois, mois suivant', () => {
    expect(versionSuivante(null, t)).toBe('2026.10.001');
    expect(versionSuivante('2026.10.001', t)).toBe('2026.10.002');
    expect(versionSuivante('2026.09.017', t)).toBe('2026.10.001');
    expect(versionSuivante('2025.12.040', t)).toBe('2026.10.001');
  });
  it('refuse une version illisible ou postérieure', () => {
    expect(() => versionSuivante('n\'importe quoi', t)).toThrow(/illisible/);
    expect(() => versionSuivante('2026.11.001', t)).toThrow(/postérieure/);
  });
});

describe('14.44 : publication d\'un répertorié', () => {
  it('le statut est signé : retirer le champ ou le changer invalide la signature', () => {
    const fichier = creerFichierCle('une phrase de passe d\'essai', PARAM_RAPIDES);
    const cle = lireClePrivee(fichier, 'une phrase de passe d\'essai');
    const pub = construirePublication(
      { officiels: [{ hote: 'www.mairie.example.fr', marque: null, valide_le: '2026-10-08', statut: 'repertorie' }, { hote: 'www.exemple.fr', marque: 'ameli', valide_le: '2026-10-08' }], frauduleux: [] },
      { officiels: '2026.10.001', frauduleux: '2026.10.001' },
      new Date('2026-10-08T10:00:00Z'),
      cle,
    );
    expect(pub.officiels.entrees).toEqual([{ hote: 'www.mairie.example.fr', statut: 'repertorie', valide_le: '2026-10-08' }, { hote: 'www.exemple.fr', marque: 'ameli', valide_le: '2026-10-08' }]);
    const publique = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(fichier.publique, 'hex').toString('base64url') }, format: 'jwk' });
    const l = pub.officiels;
    expect(verify(null, octetsSignes(l.liste, l.version, l.genere_le, l.entrees), publique, Buffer.from(l.signature, 'hex'))).toBe(true);
    const sansStatut = l.entrees.map((e) => { const { statut: _s, ...reste } = e; return reste; });
    expect(verify(null, octetsSignes(l.liste, l.version, l.genere_le, sansStatut), publique, Buffer.from(l.signature, 'hex'))).toBe(false);
  });

  it('un changement de statut compte comme une modification', () => {
    expect(differences([{ hote: 'a.fr', statut: 'repertorie' }], [{ hote: 'a.fr' }])).toEqual({ ajoutes: [], retires: [], modifies: ['a.fr'] });
  });
});

describe('differences', () => {
  it('ajoutés, retirés, modifiés', () => {
    const d = differences([{ hote: 'a.fr' }, { hote: 'b.fr', marque: 'caf' }, { hote: 'c.fr', marque: 'caf' }], [{ hote: 'b.fr', marque: 'ameli' }, { hote: 'c.fr', marque: 'caf' }, { hote: 'd.fr' }]);
    expect(d).toEqual({ ajoutes: ['d.fr'], retires: ['a.fr'], modifies: ['b.fr'] });
  });
});

describe('clé chiffrée et signature de bout en bout (Node)', () => {
  it('la clé relue signe, et la signature se vérifie avec la clé publique seule', () => {
    const fichier = creerFichierCle('une phrase de passe d\'essai', PARAM_RAPIDES);
    expect(fichier.publique).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(fichier)).not.toMatch(/PRIVATE/);
    const cle = lireClePrivee(fichier, 'une phrase de passe d\'essai');
    const pub = construirePublication(
      { officiels: [{ hote: 'www.exemple.fr', marque: 'ameli', valide_le: '2026-10-06' }, { hote: 'sans.fr', marque: null, valide_le: '2026-10-06' }], frauduleux: [{ hote: 'faux.net', portee: 'hote', confirme_le: '2026-10-05' }] },
      { officiels: '2026.10.001', frauduleux: '2026.10.001' },
      new Date('2026-10-06T10:00:00Z'),
      cle,
    );
    const publique = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(fichier.publique, 'hex').toString('base64url') }, format: 'jwk' });
    expect(pub.officiels.entrees).toEqual([{ hote: 'www.exemple.fr', marque: 'ameli', valide_le: '2026-10-06' }, { hote: 'sans.fr', valide_le: '2026-10-06' }]);
    for (const l of [pub.officiels, pub.frauduleux]) {
      expect(verify(null, octetsSignes(l.liste, l.version, l.genere_le, l.entrees), publique, Buffer.from(l.signature, 'hex'))).toBe(true);
    }
    // rejouer la signature d'« officiels » sous le nom « frauduleux » échoue
    expect(verify(null, octetsSignes('frauduleux', pub.officiels.version, pub.officiels.genere_le, pub.officiels.entrees), publique, Buffer.from(pub.officiels.signature, 'hex'))).toBe(false);
  });

  it('refuse une phrase trop courte, une mauvaise phrase et un fichier altéré', () => {
    expect(() => creerFichierCle('courte', PARAM_RAPIDES)).toThrow(/12 caractères/);
    const f = creerFichierCle('une phrase de passe d\'essai', PARAM_RAPIDES);
    expect(() => lireClePrivee(f, 'mauvaise phrase de passe')).toThrow(/incorrecte ou fichier de clé altéré/);
    expect(() => lireClePrivee({ ...f, chiffre: f.chiffre.replace(/^../, '00') }, 'une phrase de passe d\'essai')).toThrow(/altéré/);
  });

  it('le fichier de clé par défaut utilise des paramètres scrypt forts et ne contient pas la graine en clair', () => {
    const f = creerFichierCle('une phrase de passe d\'essai');
    expect(f.N).toBeGreaterThanOrEqual(2 ** 15);
    const { privateKey } = generateKeyPairSync('ed25519');
    const graineAutre = Buffer.from(privateKey.export({ format: 'jwk' }).d as string, 'base64url').toString('hex');
    expect(JSON.stringify(f)).not.toContain(graineAutre);
  });
});
