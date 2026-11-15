// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.67 : les adresses du réseau local ne sont pas analysées ; les IP publiques, les faux domaines à numéros et les fichiers locaux le restent.
import { describe, expect, it } from 'vitest';
import { analyser, estHorsPerimetre, estReseauLocal } from '../../src/moteur/analyser.js';
import { estAdresseReseauLocal } from '../../src/moteur/reseau-local.js';
import type { ChampFormulaire, Config, EmpreinteMarque, EntreeAnalyse, Listes, UrlAnalysee } from '../../src/moteur/types.js';

const exclu = (h: string) => expect(estAdresseReseauLocal(h), h).toBe(true);
const analyse = (h: string) => expect(estAdresseReseauLocal(h), h).toBe(false);

describe('IPv4 : une plage à la fois, bornes comprises', () => {
  it('10.0.0.0/8', () => {
    exclu('10.0.0.0'); exclu('10.0.0.1'); exclu('10.255.255.255');
    analyse('9.255.255.255'); analyse('11.0.0.0');
  });
  it('172.16.0.0/12 : de 172.16 à 172.31 seulement', () => {
    exclu('172.16.0.0'); exclu('172.16.0.1'); exclu('172.20.1.1'); exclu('172.31.255.255');
    analyse('172.15.255.255'); analyse('172.15.0.1'); analyse('172.32.0.0'); analyse('172.32.0.1');
  });
  it('192.168.0.0/16 (dont 192.168.0.250, le routeur du faux positif)', () => {
    exclu('192.168.0.0'); exclu('192.168.0.250'); exclu('192.168.255.255');
    analyse('192.167.255.255'); analyse('192.169.0.0');
  });
  it('127.0.0.0/8 (boucle locale)', () => {
    exclu('127.0.0.0'); exclu('127.0.0.1'); exclu('127.255.255.255');
    analyse('126.255.255.255'); analyse('128.0.0.0');
  });
  it('169.254.0.0/16 (liaison locale)', () => {
    exclu('169.254.0.0'); exclu('169.254.169.254'); exclu('169.254.255.255');
    analyse('169.253.255.255'); analyse('169.255.0.0');
  });
  it('adresses IP publiques : analysées (technique d\'hameçonnage courante)', () => {
    analyse('45.12.34.56'); analyse('8.8.8.8'); analyse('203.0.113.7'); analyse('1.1.1.1');
  });
  it('hors de la liste de Ph : analysées (0.0.0.0, 100.64.0.0/10)', () => {
    analyse('0.0.0.0'); analyse('100.64.0.1');
  });
  it('un faux domaine à numéros n\'est pas une adresse IP : analysé', () => {
    analyse('192.168.0.250.exemple.com'); analyse('10.0.0.1.exemple.fr'); analyse('127.0.0.1.evil.example.org'); analyse('www.192.168.0.1.com');
  });
  it('quatre nombres valides exigés, sans zéro initial', () => {
    analyse('192.168.0.256'); analyse('192.168.0'); analyse('192.168.0.1.5'); analyse('192.168.00.1'); analyse('010.0.0.1');
  });
});

describe('IPv6 : ::1, fc00::/7, fe80::/10', () => {
  it('::1, avec ou sans crochets, et forme développée', () => {
    exclu('::1'); exclu('[::1]'); exclu('0:0:0:0:0:0:0:1');
    analyse('::2'); analyse('::'); analyse('[::]');
  });
  it('fc00::/7 (fc00 à fdff)', () => {
    exclu('fc00::1'); exclu('fd12:3456:789a::1'); exclu('[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]');
    analyse('fbff::1'); analyse('fe00::1');
  });
  it('fe80::/10 (fe80 à febf)', () => {
    exclu('fe80::1'); exclu('[fe80::1ff:fe23:4567:890a]'); exclu('febf::1');
    analyse('fe7f::1'); analyse('fec0::1');
  });
  it('IPv6 publiques : analysées', () => {
    analyse('2001:db8::1'); analyse('[2606:4700:4700::1111]'); analyse('2a00:1450:4007:80e::200e');
  });
  it('texte invalide : analysé, sans erreur', () => {
    analyse('::::1'); analyse('1:2:3'); analyse('zz::1'); analyse('1:2:3:4:5:6:7:8:9');
  });
});

describe('noms', () => {
  it('localhost, .local, .lan, .home.arpa, .internal', () => {
    exclu('localhost'); exclu('LOCALHOST'); exclu('imprimante.local'); exclu('nas.lan'); exclu('routeur.home.arpa'); exclu('serveur.interne.internal'); exclu('a.b.c.local');
  });
  it('noms sans point (intranet)', () => {
    exclu('intranet'); exclu('wiki'); exclu('routeur');
  });
  it('un point final ne change rien', () => {
    exclu('localhost.'); exclu('imprimante.local.'); analyse('exemple.fr.');
  });
  it('noms publics : analysés (y compris ceux qui ressemblent)', () => {
    analyse('impots.gouv.fr'); analyse('exemple.com'); analyse('local.example.org'); analyse('lan.fr'); analyse('monlocal.fr'); analyse('home-arpa.com'); analyse('internal.example.com');
  });
  it('hôte vide (fichier ouvert depuis le disque) : analysé', () => {
    analyse(''); analyse('  ');
  });
});

describe('Z4 : estHorsPerimetre et estReseauLocal', () => {
  const u = (schema: string, hote: string) => ({ schema, hote });
  it('page web d\'une adresse du réseau local : hors périmètre, statut « réseau local »', () => {
    for (const h of ['192.168.0.250', '10.1.2.3', '172.16.5.5', '127.0.0.1', '169.254.1.1', '[::1]', 'localhost', 'nas.lan', 'intranet']) {
      expect(estHorsPerimetre(u('http', h)), h).toBe(true);
      expect(estReseauLocal(u('http', h)), h).toBe(true);
      expect(estReseauLocal(u('https', h)), h).toBe(true);
    }
  });
  it('IP publique, faux domaine à numéros : analysés', () => {
    for (const h of ['45.12.34.56', '172.15.0.1', '172.32.0.1', '192.168.0.250.exemple.com']) {
      expect(estHorsPerimetre(u('http', h)), h).toBe(false);
      expect(estReseauLocal(u('http', h)), h).toBe(false);
    }
  });
  it('file:// : analysé, ce n\'est pas une adresse du réseau local', () => {
    expect(estHorsPerimetre(u('file', ''))).toBe(false);
    expect(estReseauLocal(u('file', ''))).toBe(false);
  });
  it('pages internes du navigateur : hors périmètre, mais pas « réseau local » (même sans point dans le nom)', () => {
    expect(estHorsPerimetre(u('chrome', 'settings'))).toBe(true);
    expect(estReseauLocal(u('chrome', 'settings'))).toBe(false);
    expect(estHorsPerimetre(u('about', ''))).toBe(true);
    expect(estHorsPerimetre(u('moz-extension', 'abc'))).toBe(true);
  });
  it('les exclusions existantes restent (.localhost, .test, .invalid, .example) sans devenir « réseau local »', () => {
    for (const h of ['app.localhost', 'x.test', 'x.invalid', 'x.example']) {
      expect(estHorsPerimetre(u('https', h)), h).toBe(true);
      expect(estReseauLocal(u('https', h)), h).toBe(false);
    }
  });
});

// ---- le moteur lui-même : la page de connexion d'un routeur, et une vraie imitation sur une IP publique -----------------------------------------------------------
function empreinte(): EmpreinteMarque {
  return {
    id: 'impots-gouv', libelle: 'Impôts / DGFiP (fictif)', domaines: ['impots.gouv.fr'], domainePrincipal: 'impots.gouv.fr',
    termesForts: ['espace particulier', 'numéro fiscal'], termesFaibles: ['dgfip', "avis d'imposition", "taxe d'habitation", 'prélèvement à la source', 'télédéclaration'],
    termesSaisie: ['numéro fiscal', 'mot de passe'], faviconHash: ['h'], couleurs: ['#000091'], racinesTypo: ['impot', 'impots', 'dgfip'], criticite: 3,
  };
}
function url(schema: string, hote: string): UrlAnalysee {
  return { href: `${schema}://${hote}/`, hote, schema, domaineEnregistrable: hote, suffixePublic: '', sousDomaines: [], chemin: '/impots', punycode: false, estAdresseIp: /^[\d.]+$/.test(hote) };
}
const champMdp: ChampFormulaire = { type: 'password', visible: true };
function page(u: UrlAnalysee, texte: string): EntreeAnalyse {
  return { source: 'page', url: u, titre: 'Connexion', texteVisible: texte, liens: [], formulaires: [{ champs: [champMdp], dansIframeCrossOrigin: false }], ressources: { logosHash: [], couleursDominantes: [] }, comportements: [], horodatage: 0 };
}
const listes: Listes = { socle: [empreinte()], revocation: [], exclusionsPersonnelles: [], communautaireValidee: [], domainesDejaVus: [], tldAbusifs: [] };
const config: Config = { sensibilite: 'equilibre', motsClesPersonnels: [], secretsSurveilles: [] };
const IMITATION = "Votre espace particulier — déclarer mes revenus, DGFiP, avis d'imposition, taxe d'habitation";

describe('analyser : réseau local et IP publique', () => {
  it('routeur en http://192.168.0.250 (champ mot de passe, aucun terme de marque) : N0 hors périmètre', () => {
    const v = analyser(page(url('http', '192.168.0.250'), 'TP-LINK Connexion Mot de passe'), listes, config);
    expect(v.niveau).toBe('N0');
    expect(v.motif).toBe('schéma non pertinent ou domaine local');
    expect(v.scoreExposition).toBeUndefined(); // jamais allé jusqu'à l'exposition : donc rien à retenir en mémoire (14.57)
  });
  it('même une imitation parfaite d\'un service connu sur une adresse locale n\'est pas analysée', () => {
    for (const h of ['192.168.0.250', '10.0.0.5', '172.31.0.9', '[::1]', 'localhost', 'nas.lan']) {
      expect(analyser(page(url('http', h), IMITATION), listes, config).motif, h).toBe('schéma non pertinent ou domaine local');
    }
  });
  it('IP publique avec une imitation (http://45.12.34.56/impots) : analysée, alerte', () => {
    const v = analyser(page(url('http', '45.12.34.56'), IMITATION), listes, config);
    expect(v.motif).not.toBe('schéma non pertinent ou domaine local');
    expect(['N1', 'N2']).toContain(v.niveau);
    expect(v.marqueDetectee).toBe('impots-gouv');
  });
  it('bornes de 172 : 172.15 et 172.32 sont analysés (alerte), 172.16 et 172.31 exclus', () => {
    for (const h of ['172.15.0.1', '172.32.0.1']) expect(['N1', 'N2'], h).toContain(analyser(page(url('http', h), IMITATION), listes, config).niveau);
    for (const h of ['172.16.0.1', '172.31.255.255']) expect(analyser(page(url('http', h), IMITATION), listes, config).niveau, h).toBe('N0');
  });
  it('faux domaine 192.168.0.250.exemple.com : analysé, alerte', () => {
    const v = analyser(page(url('https', '192.168.0.250.exemple.com'), IMITATION), listes, config);
    expect(['N1', 'N2']).toContain(v.niveau);
    expect(v.motif).not.toBe('schéma non pertinent ou domaine local');
  });
  it('fichier ouvert depuis le disque (file://) : analysé, alerte sur une imitation', () => {
    const v = analyser(page(url('file', ''), IMITATION), listes, config);
    expect(v.motif).not.toBe('schéma non pertinent ou domaine local');
    expect(['N1', 'N2']).toContain(v.niveau);
    expect(v.marqueDetectee).toBe('impots-gouv');
  });
  it('page interne du navigateur : toujours hors périmètre', () => {
    expect(analyser(page(url('chrome', 'settings'), IMITATION), listes, config).motif).toBe('schéma non pertinent ou domaine local');
  });
});

describe('IPv6 mal formées et formes limites : jamais exclues par erreur, jamais d\'exception (couverture de toutes les branches)', () => {
  it.each(['1::2::3', 'g::1', '1::g', '1:2:3:4:5:6:7:8::9', 'fe80:::1', '1:2:3:4:5:6:7', '12345::1'])('%s est refusée comme adresse', (h) => analyse(h));
  it('« . » seul (point final retiré, nom vide) n\'est pas une adresse locale', () => analyse('.'));
  it('formes compressées valides', () => {
    exclu('::1');
    exclu('fe80::');
    exclu('fd00:0:0:0:0:0:0:1');
    analyse('::');
  });
});
