// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { verifierListeSignee, type NomListe } from '../../src/listes/verification.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const CLE = Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url').toString('hex');
const AUTRE = generateKeyPairSync('ed25519');

const OFFICIELS = [{ hote: 'www.exemple.fr', marque: 'ameli', valide_le: '2026-10-06' }, { hote: 'sans-marque.fr', valide_le: '2026-10-06' }];
const FRAUDULEUX = [{ hote: 'faux.example.net', portee: 'hote', confirme_le: '2026-10-05' }];

/** Même construction que listes/outils/publication.ts (14.33 D) ; l'essai de bout en bout vérifie l'accord des deux. */
function fichier(liste: string, entrees: unknown[], surcharge: Record<string, unknown> = {}, cle = privateKey): string {
  const version = (surcharge.version as string | undefined) ?? '2026.10.001';
  const genere_le = '2026-10-06T10:00:00.000Z';
  const octets = Buffer.from(`tmt-liste-v1\n${liste}\n${JSON.stringify({ version, genere_le, entrees })}`, 'utf8');
  return JSON.stringify({ liste, version, genere_le, entrees, signature: sign(null, octets, cle).toString('hex'), ...surcharge });
}

const verifier = (texte: string, nom: NomListe = 'officiels', cle: string | null = CLE, appliquee: string | null = null) => verifierListeSignee(texte, nom, cle, appliquee);

describe('14.33 E : une liste conforme est acceptée', () => {
  it('officiels, avec et sans marque', async () => {
    const r = await verifier(fichier('officiels', OFFICIELS));
    expect(r).toEqual({ ok: true, liste: { liste: 'officiels', version: '2026.10.001', genereLe: '2026-10-06T10:00:00.000Z', entrees: [{ hote: 'www.exemple.fr', marque: 'ameli' }, { hote: 'sans-marque.fr' }] } });
  });
  it('14.44 : un hôte répertorié (statut « repertorie », sans marque) est accepté et le statut est conservé', async () => {
    const entrees = [{ hote: 'www.mairie-exemple.fr', statut: 'repertorie', valide_le: '2026-10-08' }, ...OFFICIELS];
    const r = await verifier(fichier('officiels', entrees));
    expect(r.ok && r.liste.entrees).toEqual([{ hote: 'www.mairie-exemple.fr', statut: 'repertorie' }, { hote: 'www.exemple.fr', marque: 'ameli' }, { hote: 'sans-marque.fr' }]);
  });
  it('frauduleux', async () => {
    const r = await verifier(fichier('frauduleux', FRAUDULEUX), 'frauduleux');
    expect(r.ok).toBe(true);
  });
  it('liste vide', async () => {
    expect((await verifier(fichier('officiels', []))).ok).toBe(true);
  });
  it('une version strictement supérieure à celle appliquée', async () => {
    expect((await verifier(fichier('officiels', OFFICIELS, { version: '2026.10.002' }), 'officiels', CLE, '2026.10.001')).ok).toBe(true);
  });
});

describe('14.33 E : rejets', () => {
  const code = async (texte: string, nom: NomListe = 'officiels', cle: string | null = CLE, appliquee: string | null = null) => {
    const r = await verifier(texte, nom, cle, appliquee);
    return r.ok ? 'ok' : r.code;
  };

  it('sans clé publique (ou clé mal formée), aucune liste n\'est acceptée', async () => {
    expect(await code(fichier('officiels', OFFICIELS), 'officiels', null)).toBe('cle');
    expect(await code(fichier('officiels', OFFICIELS), 'officiels', 'zz')).toBe('cle');
  });
  it('une clé qui ne s\'importe pas est un rejet de clé', async () => {
    const espion = vi.spyOn(crypto.subtle, 'importKey').mockRejectedValueOnce(new Error('non'));
    expect(await code(fichier('officiels', OFFICIELS))).toBe('cle');
    espion.mockRestore();
  });
  it('trop gros, JSON invalide, forme invalide', async () => {
    expect(await code('x'.repeat(2_000_001))).toBe('taille');
    expect(await code('{pas du json')).toBe('json');
    for (const t of ['"x"', 'null', '[]']) expect(await code(t)).toBe('format');
  });
  it('chaque champ de l\'enveloppe est exigé', async () => {
    const ok = JSON.parse(fichier('officiels', OFFICIELS)) as Record<string, unknown>;
    const mauvais: Record<string, unknown>[] = [
      { liste: 1 },
      { version: 2 },
      { version: '2026.1.1' },
      { genere_le: 3 },
      { signature: 4 },
      { signature: 'ab' },
      { entrees: 'x' },
      { entrees: new Array(20_001).fill({ hote: 'a.fr', valide_le: '2026-10-06' }) },
    ];
    for (const m of mauvais) expect(await code(JSON.stringify({ ...ok, ...m }))).toBe('format');
  });
  it('un fichier ne peut pas être rejoué sous un autre nom', async () => {
    expect(await code(fichier('officiels', FRAUDULEUX), 'frauduleux')).toBe('liste');
    expect(await code(fichier('frauduleux', FRAUDULEUX))).toBe('liste');
  });
  it('une entrée invalide fait rejeter toute la liste', async () => {
    const mauvaisOfficiels: unknown[] = [null, 'x', [], { hote: 3, valide_le: '2026-10-06' }, { hote: 'Majuscule.fr', valide_le: '2026-10-06' }, { hote: '*.a.fr', valide_le: '2026-10-06' },
      { hote: 'a.fr', marque: 3, valide_le: '2026-10-06' }, { hote: 'a.fr', marque: 'Pas Valable', valide_le: '2026-10-06' }, { hote: 'a.fr', valide_le: 6 }, { hote: 'a.fr', valide_le: '6 octobre' }];
    for (const e of mauvaisOfficiels) expect(await code(fichier('officiels', [...OFFICIELS, e]))).toBe('entree');
    // 14.44 : statut inconnu, « valide » explicite (le validé est l'absence de champ), répertorié avec une marque
    for (const e of [{ hote: 'a.fr', statut: 'valide', valide_le: '2026-10-06' }, { hote: 'a.fr', statut: 3, valide_le: '2026-10-06' }, { hote: 'a.fr', statut: 'repertorie', marque: 'ameli', valide_le: '2026-10-06' }]) {
      expect(await code(fichier('officiels', [...OFFICIELS, e]))).toBe('entree');
    }
    const mauvaisFrauduleux: unknown[] = [{ hote: 'a.fr', portee: 'domaine', confirme_le: '2026-10-06' }, { hote: 'a.fr', portee: 'hote', confirme_le: 5 }, { hote: 'a.fr', portee: 'hote', confirme_le: 'hier' }];
    for (const e of mauvaisFrauduleux) expect(await code(fichier('frauduleux', [e]), 'frauduleux')).toBe('entree');
  });
  it('signature altérée, contenu altéré, mauvaise clé', async () => {
    const ok = JSON.parse(fichier('officiels', OFFICIELS)) as { signature: string; entrees: { hote: string }[] };
    expect(await code(JSON.stringify({ ...ok, signature: (ok.signature[0] === '0' ? '1' : '0') + ok.signature.slice(1) }))).toBe('signature');
    expect(await code(JSON.stringify({ ...ok, entrees: [...ok.entrees, { hote: 'pirate.fr', valide_le: '2026-10-06' }] }))).toBe('signature');
    expect(await code(JSON.stringify({ ...ok, version: '2026.10.009' }))).toBe('signature');
    expect(await code(fichier('officiels', OFFICIELS, {}, AUTRE.privateKey))).toBe('signature');
  });
  it('pas de retour en arrière : version inférieure refusée, même correctement signée ; version identique : rien à faire', async () => {
    expect(await code(fichier('officiels', OFFICIELS), 'officiels', CLE, '2026.10.001')).toBe('identique');
    expect(await code(fichier('officiels', OFFICIELS), 'officiels', CLE, '2026.10.002')).toBe('retour-arriere');
    expect(await code(fichier('officiels', OFFICIELS), 'officiels', CLE, '2027.01.001')).toBe('retour-arriere');
  });
});
