// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { ed25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import type { ListeSocle } from '../outils/canonique.js';
import { lireClePriveeDepuisEnv, signerListe } from '../outils/signer.js';
import { verifierSignature } from '../outils/verifier.js';

const cleSecrete = ed25519.utils.randomSecretKey();
const clePublique = Buffer.from(ed25519.getPublicKey(cleSecrete)).toString('hex');

const listeExemple: ListeSocle = {
  version: '2026.09.001',
  genere_le: '2026-09-12T00:00:00.000Z',
  entrees: [{ id: 'impots-gouv', libelle: 'Impôts / DGFiP' }],
};

describe('signerListe / verifierSignature', () => {
  it('une liste signée par la bonne clé est acceptée', () => {
    const signee = signerListe(listeExemple, cleSecrete);
    expect(verifierSignature(signee, clePublique)).toBe(true);
  });

  it('livrable 5 : altérer un seul octet du contenu signé fait rejeter la vérification', () => {
    const signee = signerListe(listeExemple, cleSecrete);
    const altere = {
      ...signee,
      entrees: [{ ...(signee.entrees[0] as Record<string, unknown>), libelle: 'Impôts / DGFiQ' }],
    };
    expect(verifierSignature(altere, clePublique)).toBe(false);
  });

  it('négatif : mauvaise clé publique', () => {
    const signee = signerListe(listeExemple, cleSecrete);
    const autrePublique = Buffer.from(ed25519.getPublicKey(ed25519.utils.randomSecretKey())).toString('hex');
    expect(verifierSignature(signee, autrePublique)).toBe(false);
  });

  it('cas limite : signature absente', () => {
    expect(verifierSignature(listeExemple, clePublique)).toBe(false);
  });

  it('cas limite : champ signature présent mais pas une chaîne', () => {
    expect(verifierSignature({ ...listeExemple, signature: 12345 }, clePublique)).toBe(false);
  });

  it('cas limite : signature ou clé publique non hexadécimale', () => {
    const signee = signerListe(listeExemple, cleSecrete);
    expect(verifierSignature({ ...signee, signature: 'pas-hexa' }, clePublique)).toBe(false);
    expect(verifierSignature(signee, 'pas-hexa')).toBe(false);
  });

  it('cas limite : hexadécimal syntaxiquement valide mais de mauvaise longueur → rejeté sans lever', () => {
    const signee = signerListe(listeExemple, cleSecrete);
    // "aa" est un hexadécimal valide mais ne fait pas une clé Ed25519 de 32 octets :
    // @noble/curves lève en interne, verifierSignature doit l'absorber et renvoyer false.
    expect(verifierSignature(signee, 'aa')).toBe(false);
  });

  it('cas limite : objet non signable (null, primitive)', () => {
    expect(verifierSignature(null, clePublique)).toBe(false);
    expect(verifierSignature('une chaîne', clePublique)).toBe(false);
  });
});

describe('lireClePriveeDepuisEnv', () => {
  const cleHex = Buffer.from(cleSecrete).toString('hex');

  it('positif : variable présente et bien formée', () => {
    const cle = lireClePriveeDepuisEnv({ TOURMENTIN_CLE_PRIVEE_SOCLE: cleHex } as NodeJS.ProcessEnv);
    expect(Buffer.from(cle).toString('hex')).toBe(cleHex);
  });

  it('négatif : variable absente', () => {
    expect(() => lireClePriveeDepuisEnv({} as NodeJS.ProcessEnv)).toThrow(/absente/);
  });

  it('cas limite : longueur incorrecte', () => {
    expect(() => lireClePriveeDepuisEnv({ TOURMENTIN_CLE_PRIVEE_SOCLE: 'abcd' } as NodeJS.ProcessEnv)).toThrow(/32 octets/);
  });
});
