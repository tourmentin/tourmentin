// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, createPublicKey, verify as verifierNode } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { construireEntreeAnalyse } from '../../src/adaptateurs/dom.js';
import { collecterAdressesImages } from '../../src/adaptateurs/images.js';
import { nettoyerTexte } from '../../src/arriere-plan/nettoyage.js';
import { adressesImages, construireRapport, LIMITE_IMAGES, LIMITE_SIGNAUX, LIMITE_TEXTES } from '../../src/arriere-plan/rapport.js';
import { API_BASE, appelerApi, EnvoiDesactive, estModeEnvoi, MODE_ENVOI_PAR_DEFAUT } from '../../src/arriere-plan/reseau.js';
import { clePubliqueBase64Url, genererPaire, identifiantInstallation, preuveEnregistrement, signer, versBase64Url } from '../../src/arriere-plan/signature.js';
import type { SignalDeclenche, Verdict } from '../../src/moteur/types.js';

describe('nettoyerTexte — 14.19 B : e-mails, téléphones, IBAN', () => {
  it('positif : adresse e-mail', () => {
    expect(nettoyerTexte('Écrivez à jean.dupont+essai@exemple.fr pour confirmer')).toBe('Écrivez à [adresse e-mail retirée] pour confirmer');
  });

  it('positif : numéros de téléphone français sous leurs formes courantes', () => {
    for (const tel of ['06 12 34 56 78', '0612345678', '06.12.34.56.78', '+33 6 12 34 56 78', '0033612345678', '01-23-45-67-89']) {
      const sortie = nettoyerTexte(`Appelez le ${tel} maintenant`);
      expect(sortie, tel).toContain('[numéro de téléphone retiré]');
      expect(sortie, tel).not.toMatch(/\d{2}[ .-]?\d{2}[ .-]?\d{2}/);
    }
  });

  it('positif : IBAN avec et sans espaces', () => {
    expect(nettoyerTexte('IBAN FR76 3000 6000 0112 3456 7890 189 merci')).toBe('IBAN [IBAN retiré] merci');
    expect(nettoyerTexte('FR7630006000011234567890189')).toBe('[IBAN retiré]');
  });

  it('positif : plusieurs motifs dans un même texte', () => {
    const sortie = nettoyerTexte('Mme Martin, a@b.fr, 06 12 34 56 78, FR76 3000 6000 0112 3456 7890 189');
    expect(sortie).toBe('Mme Martin, [adresse e-mail retirée], [numéro de téléphone retiré], [IBAN retiré]');
  });

  it('négatif : un texte ordinaire n\'est pas modifié (dates, montants, codes postaux, numéros courts)', () => {
    const texte = 'Votre avis d\'imposition du 12/03/2026 : 1 250,00 € ; code postal 38850 ; dossier n° 4521 ; ref ABC-2026-12';
    expect(nettoyerTexte(texte)).toBe(texte);
  });

  it('cas limite : texte vide', () => {
    expect(nettoyerTexte('')).toBe('');
  });
});

const E1: SignalDeclenche = { code: 'E1', poids: 40, famille: 'identifiant', detail: 'champ mot de passe visible' };
const E8: SignalDeclenche = { code: 'E8', poids: 60, famille: 'paiement', detail: 'champ numéro de carte' };
const I1: SignalDeclenche = { code: 'I1', poids: 40, famille: 'textuelle', detail: 'terme fort « espace particulier »' };
const verdictN1: Verdict = { niveau: 'N1', motif: 'm', marqueDetectee: 'impots-gouv', signauxImitation: [I1], signauxExposition: [E1] };

describe('construireRapport — 14.28 B : ce qui peut partir', () => {
  it('positif : hôte, chemin sans requête ni fragment, marque, niveau, signaux', () => {
    const r = construireRapport({
      type: 'frauduleuse', href: 'https://Faux-Impots.example.fr/connexion/etape?jeton=abc123&u=jean@mail.fr#secret', verdict: verdictN1,
      textes: 'Espace particulier', maintenant: new Date('2026-10-03T10:00:00.000Z'), versionExtension: '0.1.76',
    });
    expect(r).toMatchObject({ v: 1, type: 'frauduleuse', hote: 'faux-impots.example.fr', chemin: '/connexion/etape', marque: 'impots-gouv', niveau: 'N1', paiement: false, horodatage: '2026-10-03T10:00:00.000Z' });
    expect(r.signaux).toEqual([{ code: 'I1', poids: 40, detail: 'terme fort « espace particulier »' }, { code: 'E1', poids: 40, detail: 'champ mot de passe visible' }]);
    expect(JSON.stringify(r)).not.toMatch(/jeton|abc123|jean|secret|\?/);
  });

  it('négatif : seules les clés prévues par le contrat existent', () => {
    const r = construireRapport({ type: 'officiel', href: 'https://x.example.fr/', verdict: verdictN1, textes: 't', images: ['https://x.example.fr/a.png'], versionExtension: '1' });
    const permises = ['v', 'type', 'marque', 'hote', 'chemin', 'paiement', 'niveau', 'signaux', 'textes', 'images', 'horodatage', 'version_extension'];
    expect(Object.keys(r).every((k) => permises.includes(k))).toBe(true);
  });

  it('positif : une page de paiement est marquée', () => {
    const v: Verdict = { niveau: 'N0', motif: 'm', signauxExposition: [E8] };
    expect(construireRapport({ type: 'frauduleuse', href: 'https://boutique.example.fr/', verdict: v }).paiement).toBe(true);
  });

  it('négatif : le texte est nettoyé avant d\'entrer dans le rapport, et plafonné APRÈS nettoyage', () => {
    const r = construireRapport({ type: 'frauduleuse', href: 'https://x.example.fr/', verdict: verdictN1, textes: 'a@b.fr '.repeat(5000) });
    expect(r.textes!.length).toBeLessThanOrEqual(LIMITE_TEXTES);
    expect(r.textes).not.toContain('a@b.fr');
  });

  it('négatif : les détails de signaux et le chemin sont nettoyés aussi', () => {
    const v: Verdict = { niveau: 'N1', motif: 'm', marqueDetectee: 'caf', signauxImitation: [{ code: 'I1', poids: 10, famille: 'textuelle', detail: 'contact jean@exemple.fr' }] };
    const r = construireRapport({ type: 'frauduleuse', href: 'https://x.example.fr/jean@exemple.fr/page', verdict: v });
    expect(JSON.stringify(r)).not.toContain('jean@exemple.fr');
  });

  it('cas limite : 40 signaux au plus', () => {
    const beaucoup: SignalDeclenche[] = Array.from({ length: 60 }, () => I1);
    const r = construireRapport({ type: 'frauduleuse', href: 'https://x.example.fr/', verdict: { niveau: 'N1', motif: 'm', marqueDetectee: 'caf', signauxImitation: beaucoup } });
    expect(r.signaux).toHaveLength(LIMITE_SIGNAUX);
  });

  it('négatif : aucune valeur de champ saisie ne se retrouve dans le rapport (même fixture que dom.test.ts)', () => {
    const dom = new JSDOM(`<!doctype html><html><head><title>Espace Particulier</title></head><body>
      <p>Espace Particulier — avis d'imposition</p>
      <form><label for="mdp">Mot de passe</label><input id="mdp" type="password" name="mdp"><input type="text" name="identifiant" id="id"></form></body></html>`, { url: 'https://faux-impots.example.fr/connexion?x=1' });
    (dom.window.document.getElementById('mdp') as HTMLInputElement).value = 'hunter2-secret';
    (dom.window.document.getElementById('id') as HTMLInputElement).value = 'jean-identifiant-tape';
    const entree = construireEntreeAnalyse(dom.window.document);
    const r = construireRapport({ type: 'frauduleuse', href: 'https://faux-impots.example.fr/connexion?x=1', verdict: verdictN1, textes: entree.texteVisible, images: collecterAdressesImages(dom.window.document) });
    const json = JSON.stringify(r);
    expect(json).not.toContain('hunter2-secret');
    expect(json).not.toContain('jean-identifiant-tape');
    expect(json).toContain('Espace Particulier');
  });
});

describe('adressesImages et collecterAdressesImages — adresses seulement', () => {
  it('positif : http(s), sans requête ni fragment, uniques', () => {
    expect(adressesImages(['https://x.fr/a.png?v=1#f', 'https://x.fr/a.png', 'http://y.fr/b.jpg'])).toEqual([{ url: 'https://x.fr/a.png' }, { url: 'http://y.fr/b.jpg' }]);
  });

  it('négatif : data: et blob: (du contenu) sont écartés, comme une adresse illisible', () => {
    expect(adressesImages(['data:image/png;base64,AAAA', 'blob:https://x.fr/uuid', 'pas une adresse'])).toEqual([]);
  });

  it('cas limite : 20 images au plus', () => {
    const beaucoup = Array.from({ length: 50 }, (_, i) => `https://x.fr/${i}.png`);
    expect(adressesImages(beaucoup)).toHaveLength(LIMITE_IMAGES);
  });

  it('positif : le collecteur lit les images de la page', () => {
    const dom = new JSDOM('<img src="https://x.fr/logo.png"><img src="data:image/png;base64,AAAA"><p>texte</p>', { url: 'https://x.fr/' });
    expect(adressesImages(collecterAdressesImages(dom.window.document))).toEqual([{ url: 'https://x.fr/logo.png' }]);
  });
});

describe('signature — format identique à celui que vérifie le serveur (14.28 B)', () => {
  it('l\'identifiant est l\'empreinte SHA-256 de la clé publique brute, comme côté serveur', async () => {
    const paire = await genererPaire();
    const brute = Buffer.from(await crypto.subtle.exportKey('raw', paire.publique));
    expect(await identifiantInstallation(paire.publique)).toBe(createHash('sha256').update(brute).digest('base64url'));
    expect(await clePubliqueBase64Url(paire.publique)).toBe(brute.toString('base64url'));
  });

  it('la signature porte sur « domaine\\ncorps » : vérifiée par une implémentation indépendante (node:crypto)', async () => {
    const paire = await genererPaire();
    const brute = Buffer.from(await crypto.subtle.exportKey('raw', paire.publique));
    const cle = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: brute.toString('base64url') }, format: 'jwk' });
    const corps = '{"v":1,"type":"frauduleuse"}';
    const sig = Buffer.from(await signer(paire.privee, 'tmt-declaration-v1', corps), 'base64url');
    expect(sig).toHaveLength(64);
    expect(verifierNode(null, Buffer.from('tmt-declaration-v1\n' + corps), cle, sig)).toBe(true);
    // une signature d'un usage ne vaut pas pour un autre
    expect(verifierNode(null, Buffer.from('tmt-action-v1\n' + corps), cle, sig)).toBe(false);
    expect(verifierNode(null, Buffer.from('tmt-declaration-v1\n' + corps + ' '), cle, sig)).toBe(false);
  });

  it('la preuve d\'enregistrement signe « clé\\nhorodatage »', async () => {
    const paire = await genererPaire();
    const brute = Buffer.from(await crypto.subtle.exportKey('raw', paire.publique));
    const cle = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: brute.toString('base64url') }, format: 'jwk' });
    const cleB64 = brute.toString('base64url');
    const preuve = Buffer.from(await preuveEnregistrement(paire.privee, cleB64, '2026-10-03T10:00:00.000Z'), 'base64url');
    expect(verifierNode(null, Buffer.from(`tmt-enregistrement-v1\n${cleB64}\n2026-10-03T10:00:00.000Z`), cle, preuve)).toBe(true);
  });

  it('règle 3 de CLAUDE.md : la clé privée est non exportable', async () => {
    const paire = await genererPaire();
    await expect(crypto.subtle.exportKey('pkcs8', paire.privee)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('jwk', paire.privee)).rejects.toThrow();
  });

  it('versBase64Url : sans remplissage ni caractères d\'URL interdits', () => {
    expect(versBase64Url(new Uint8Array([251, 255, 254]))).toBe('-__-');
  });
});

describe('appelerApi — le seul passage vers tourmentin.fr (14.19 A2)', () => {
  it('« Ne jamais envoyer » : refusé AVANT toute requête, fetch n\'est jamais appelé', async () => {
    const fetchEspion = vi.fn();
    await expect(appelerApi('jamais', '/declarations', { x: 1 }, { fetch: fetchEspion as never })).rejects.toBeInstanceOf(EnvoiDesactive);
    expect(fetchEspion).not.toHaveBeenCalled();
  });

  it('« Me demander » et « automatique » : une requête POST JSON, sans cookie, vers l\'adresse de l\'API et nulle part ailleurs', async () => {
    for (const mode of ['demander', 'automatique'] as const) {
      const fetchEspion = vi.fn().mockResolvedValue({ status: 201, json: async () => ({ ok: true }) });
      const r = await appelerApi(mode, '/declarations', { a: 1 }, { fetch: fetchEspion as never });
      expect(r).toEqual({ statut: 201, json: { ok: true } });
      expect(fetchEspion).toHaveBeenCalledTimes(1);
      const [url, options] = fetchEspion.mock.calls[0]!;
      expect(url).toBe(API_BASE + '/declarations');
      expect(url).toMatch(/^https:\/\/tourmentin\.fr\/api\/v1\//);
      expect(options).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
      expect(options.body).toBe('{"a":1}');
    }
  });

  it('une réponse qui n\'est pas du JSON ne fait pas planter l\'appel', async () => {
    const fetchEspion = vi.fn().mockResolvedValue({ status: 502, json: async () => { throw new Error('pas du json'); } });
    expect(await appelerApi('demander', '/ping', {}, { fetch: fetchEspion as never })).toEqual({ statut: 502, json: null });
  });

  it('le défaut est « Me demander avant chaque envoi » ; les trois positions sont les seules valides', () => {
    expect(MODE_ENVOI_PAR_DEFAUT).toBe('demander');
    expect(['jamais', 'demander', 'automatique'].every(estModeEnvoi)).toBe(true);
    expect(estModeEnvoi('toujours')).toBe(false);
  });
});
