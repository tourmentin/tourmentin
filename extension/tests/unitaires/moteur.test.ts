// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { analyser } from '../../src/moteur/analyser.js';
import {
  AJUSTEMENT_SENSIBILITE,
  LONGUEUR_MIN_SAISIE_E4,
  MODIFICATEURS_SEUIL,
  NB_COULEURS_MIN_I6,
  NB_TERMES_FAIBLES_MIN_I2,
  PLAFOND_VISUEL_I5_I6,
  POIDS_EXPOSITION,
  POIDS_IMITATION,
  SEUIL_BASE,
  SEUIL_MAX,
  SEUIL_MIN,
} from '../../src/moteur/constantes.js';
import { distanceDamerauLevenshtein, sansDernierLabel } from '../../src/moteur/distance.js';
import { analyserHote, contientTokenHorsSuffixe, possedeLabelPunycodeMeleALatin } from '../../src/moteur/domaine.js';
import { calculerSeuil, evaluerM1, evaluerM2, evaluerM3, evaluerM4, evaluerM5, evaluerM6 } from '../../src/moteur/seuils.js';
import {
  compterFamillesIndependantes,
  evaluerAxeImitation,
  evaluerI1,
  evaluerI2,
  evaluerI3,
  evaluerI4,
  evaluerI5,
  evaluerI6,
  evaluerI7,
  evaluerI8,
} from '../../src/moteur/signaux-imitation.js';
import {
  evaluerAxeExposition,
  evaluerE1,
  evaluerE2,
  evaluerE3,
  evaluerE4,
  evaluerE5,
  evaluerE6,
  evaluerE7,
  evaluerE8,
} from '../../src/moteur/signaux-exposition.js';
import type {
  ChampFormulaire,
  Config,
  EmpreinteMarque,
  EntreeAnalyse,
  FormulaireNormalise,
  Listes,
  UrlAnalysee,
} from '../../src/moteur/types.js';

// ---------------------------------------------------------------------------
// Fixtures. Toutes les données sont fictives : le lot L2 fournira les
// véritables empreintes du socle.
// ---------------------------------------------------------------------------

function creerEmpreinte(partiel: Partial<EmpreinteMarque> = {}): EmpreinteMarque {
  return {
    id: 'impots-gouv',
    libelle: 'Impôts / DGFiP (fictif)',
    domaines: ['impots.gouv.fr', 'cfspart.impots.gouv.fr'],
    domainePrincipal: 'impots.gouv.fr',
    termesForts: ['espace particulier', 'numéro fiscal'],
    termesFaibles: ["dgfip", "avis d'imposition", "taxe d'habitation", 'prélèvement à la source', 'télédéclaration'],
    termesSaisie: ['numéro fiscal', 'mot de passe'],
    faviconHash: ['hash-legitime-abc'],
    couleurs: ['#000091', '#e1000f'],
    racinesTypo: ['impot', 'impots', 'dgfip'],
    criticite: 3,
    ...partiel,
  };
}

function creerUrl(partiel: Partial<UrlAnalysee> = {}): UrlAnalysee {
  return {
    href: 'https://impots.gouv.fr/',
    hote: 'impots.gouv.fr',
    schema: 'https',
    domaineEnregistrable: 'impots.gouv.fr',
    suffixePublic: 'gouv.fr',
    sousDomaines: [],
    chemin: '/',
    punycode: false,
    estAdresseIp: false,
    ...partiel,
  };
}

function creerChamp(partiel: Partial<ChampFormulaire> = {}): ChampFormulaire {
  return { type: 'text', visible: true, ...partiel };
}

function creerFormulaire(champs: ChampFormulaire[], partiel: Partial<FormulaireNormalise> = {}): FormulaireNormalise {
  return { champs, dansIframeCrossOrigin: false, ...partiel };
}

function creerEntree(partiel: Partial<EntreeAnalyse> = {}): EntreeAnalyse {
  return {
    source: 'page',
    url: creerUrl(),
    titre: '',
    texteVisible: '',
    liens: [],
    formulaires: [],
    ressources: { logosHash: [], couleursDominantes: [] },
    comportements: [],
    horodatage: Date.parse('2026-09-12T09:00:00Z'),
    ...partiel,
  };
}

function creerListes(partiel: Partial<Listes> = {}): Listes {
  return {
    socle: [creerEmpreinte()],
    revocation: [],
    exclusionsPersonnelles: [],
    communautaireValidee: [],
    domainesDejaVus: ['impots.gouv.fr'],
    tldAbusifs: ['tk', 'zip'],
    ...partiel,
  };
}

function creerConfig(partiel: Partial<Config> = {}): Config {
  return { sensibilite: 'equilibre', motsClesPersonnels: [], secretsSurveilles: [], ...partiel };
}

// ---------------------------------------------------------------------------
// Utilitaires purs : distance, domaine.
// ---------------------------------------------------------------------------

describe('distanceDamerauLevenshtein', () => {
  it('exemples de référence', () => {
    expect(distanceDamerauLevenshtein('kitten', 'sitting')).toBe(3);
    expect(distanceDamerauLevenshtein('ab', 'ba')).toBe(1); // transposition
    expect(distanceDamerauLevenshtein('impots', 'impots')).toBe(0);
  });
});

describe('sansDernierLabel', () => {
  it('retire uniquement le dernier label', () => {
    expect(sansDernierLabel('impots.gouv.fr')).toBe('impots.gouv');
    expect(sansDernierLabel('impots.gouv.com')).toBe('impots.gouv');
  });

  it('cas limite : aucun point', () => {
    expect(sansDernierLabel('localhost')).toBe('localhost');
  });
});

describe('analyserHote (Public Suffix List, tldts)', () => {
  it('impots.gouv.fr : gouv.fr est le suffixe public, domaine enregistrable = impots.gouv.fr', () => {
    const r = analyserHote('impots.gouv.fr');
    expect(r.domaineEnregistrable).toBe('impots.gouv.fr');
    expect(r.suffixePublic).toBe('gouv.fr');
    expect(r.sousDomaines).toEqual([]);
  });

  it('cfspart.impots.gouv.fr : même domaine enregistrable, un sous-domaine', () => {
    const r = analyserHote('cfspart.impots.gouv.fr');
    expect(r.domaineEnregistrable).toBe('impots.gouv.fr');
    expect(r.sousDomaines).toEqual(['cfspart']);
  });

  it('cas limite : impots-gouv.fr, gouv ne fait pas partie du suffixe réel ("fr")', () => {
    const r = analyserHote('impots-gouv.fr');
    expect(r.domaineEnregistrable).toBe('impots-gouv.fr');
    expect(r.suffixePublic).toBe('fr');
  });

  it('adresse IP littérale (v4 et v6, avec ou sans crochets) : pas de calcul PSL', () => {
    expect(analyserHote('203.0.113.5').estAdresseIp).toBe(true);
    expect(analyserHote('2001:db8::1').estAdresseIp).toBe(true);
    expect(analyserHote('[2001:db8::1]').estAdresseIp).toBe(true);
    expect(analyserHote('impots.gouv.fr').estAdresseIp).toBe(false);
  });

  it('cas limite : hôte sans aucun suffixe public reconnu → repli sur l\'hôte lui-même', () => {
    const r = analyserHote('');
    expect(r.domaineEnregistrable).toBe('');
    expect(r.suffixePublic).toBe('');
  });
});

describe('contientTokenHorsSuffixe (I8)', () => {
  it('impots.gouv.fr (légitime) : gouv fait partie du suffixe, ne déclenche pas', () => {
    const r = analyserHote('impots.gouv.fr');
    expect(contientTokenHorsSuffixe('impots.gouv.fr', r.suffixePublic, 'gouv')).toBe(false);
  });

  it('impots-gouv.fr (illégitime) : gouv est un fragment du label hors suffixe', () => {
    const r = analyserHote('impots-gouv.fr');
    expect(contientTokenHorsSuffixe('impots-gouv.fr', r.suffixePublic, 'gouv')).toBe(true);
  });

  it('cas limite : impots.gouv.fr.securise.com, gouv apparaît en sous-domaine hors du vrai suffixe ("com")', () => {
    const r = analyserHote('impots.gouv.fr.securise.com');
    expect(r.suffixePublic).toBe('com');
    expect(contientTokenHorsSuffixe('impots.gouv.fr.securise.com', r.suffixePublic, 'gouv')).toBe(true);
  });

  it('cas limite : suffixe public inconnu (chaîne vide) → tout label est hors suffixe', () => {
    expect(contientTokenHorsSuffixe('gouv', '', 'gouv')).toBe(true);
  });
});

describe('possedeLabelPunycodeMeleALatin (I7, heuristique [H])', () => {
  it('positif : un label punycode et un label latin dans le même hôte', () => {
    expect(possedeLabelPunycodeMeleALatin('xn--mpts-bub.gouv.fr')).toBe(true);
  });

  it('négatif : hôte entièrement latin', () => {
    expect(possedeLabelPunycodeMeleALatin('impots.gouv.fr')).toBe(false);
  });

  it('cas limite : hôte entièrement punycode, aucun label latin à mêler', () => {
    expect(possedeLabelPunycodeMeleALatin('xn--80ak6aa92e.xn--p1ai')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Axe I — signaux d'imitation.
// ---------------------------------------------------------------------------

describe('I1 — terme fort ou mot-clé personnel', () => {
  it('positif : terme fort de la marque dans le texte visible', () => {
    const r = evaluerI1(creerEntree({ texteVisible: 'Bienvenue dans votre Espace Particulier' }), creerEmpreinte());
    expect(r).toMatchObject({ code: 'I1', poids: POIDS_IMITATION.I1, famille: 'textuelle' });
  });

  it('négatif : aucun terme fort, aucun mot-clé personnel', () => {
    expect(evaluerI1(creerEntree({ texteVisible: 'page sans rapport' }), creerEmpreinte())).toBeNull();
  });

  it('cas limite : seul un mot-clé personnel (config) correspond, pas de terme fort', () => {
    const r = evaluerI1(
      creerEntree({ texteVisible: 'mon compte perso' }),
      creerEmpreinte(),
      creerConfig({ motsClesPersonnels: ['mon compte perso'] }),
    );
    expect(r?.code).toBe('I1');
  });
});

describe('I2 — au moins 3 termes faibles', () => {
  it(`positif : exactement ${NB_TERMES_FAIBLES_MIN_I2} termes faibles`, () => {
    const r = evaluerI2(
      creerEntree({ texteVisible: "DGFiP, avis d'imposition, taxe d'habitation" }),
      creerEmpreinte(),
    );
    expect(r).toMatchObject({ code: 'I2', poids: POIDS_IMITATION.I2 });
  });

  it('négatif : un seul terme faible', () => {
    expect(evaluerI2(creerEntree({ texteVisible: 'DGFiP' }), creerEmpreinte())).toBeNull();
  });

  it('cas limite : juste en dessous du seuil (2 termes faibles)', () => {
    expect(evaluerI2(creerEntree({ texteVisible: "DGFiP, avis d'imposition" }), creerEmpreinte())).toBeNull();
  });
});

describe('I3 — racine typo en sous-domaine/chemin, absente du domaine enregistrable', () => {
  it('positif : racine en sous-domaine, domaine enregistrable différent', () => {
    const entree = creerEntree({
      url: creerUrl({
        hote: 'impots.gouv.fr.securise.com',
        domaineEnregistrable: 'securise.com',
        sousDomaines: ['impots', 'gouv', 'fr'],
      }),
    });
    const r = evaluerI3(entree, creerEmpreinte());
    expect(r).toMatchObject({ code: 'I3', poids: POIDS_IMITATION.I3, famille: 'lexicale-url' });
  });

  it('négatif : racine absente du sous-domaine et du chemin', () => {
    const entree = creerEntree({ url: creerUrl({ hote: 'exemple.fr', domaineEnregistrable: 'exemple.fr', sousDomaines: [] }) });
    expect(evaluerI3(entree, creerEmpreinte())).toBeNull();
  });

  it('cas limite : racine présente en sous-domaine mais aussi dans le domaine enregistrable → pas de déclenchement', () => {
    const entree = creerEntree({
      url: creerUrl({ hote: 'impots.impots.gouv.fr', domaineEnregistrable: 'impots.gouv.fr', sousDomaines: ['impots'] }),
    });
    expect(evaluerI3(entree, creerEmpreinte())).toBeNull();
  });

  it('pas d\'URL (source mail) → pas de déclenchement', () => {
    expect(evaluerI3(creerEntree({ url: undefined, source: 'mail' }), creerEmpreinte())).toBeNull();
  });
});

describe('I4 — distance de Damerau-Levenshtein ≤ 2, domaine sans dernier label', () => {
  it('positif : impots-gouv.fr, distance 1 de impots.gouv.fr', () => {
    const entree = creerEntree({ url: creerUrl({ hote: 'impots-gouv.fr', domaineEnregistrable: 'impots-gouv.fr' }) });
    const r = evaluerI4(entree, creerEmpreinte());
    expect(r).toMatchObject({ code: 'I4', poids: POIDS_IMITATION.I4, famille: 'lexicale-url' });
  });

  it('négatif : domaine sans rapport', () => {
    const entree = creerEntree({ url: creerUrl({ hote: 'exemple-quelconque.fr', domaineEnregistrable: 'exemple-quelconque.fr' }) });
    expect(evaluerI4(entree, creerEmpreinte())).toBeNull();
  });

  it('cas limite : le domaine enregistrable est exactement celui de la marque (pas un typosquat) → pas de déclenchement', () => {
    const entree = creerEntree({ url: creerUrl() }); // impots.gouv.fr
    expect(evaluerI4(entree, creerEmpreinte())).toBeNull();
  });

  it('pas d\'URL (source mail) → pas de déclenchement', () => {
    expect(evaluerI4(creerEntree({ url: undefined, source: 'mail' }), creerEmpreinte())).toBeNull();
  });
});

describe('I5 — empreinte de favicon identique, domaine différent', () => {
  const empreinte = creerEmpreinte();

  it('positif : hash identique, domaine différent des domaines de la marque', () => {
    const entree = creerEntree({
      url: creerUrl({ hote: 'phishing-impots.fr', domaineEnregistrable: 'phishing-impots.fr' }),
      ressources: { logosHash: [], couleursDominantes: [], faviconHash: 'hash-legitime-abc' },
    });
    expect(evaluerI5(entree, empreinte)).toMatchObject({ code: 'I5', poids: POIDS_IMITATION.I5, famille: 'visuelle' });
  });

  it('négatif : pas de hash de favicon', () => {
    const entree = creerEntree({ url: creerUrl({ hote: 'phishing-impots.fr', domaineEnregistrable: 'phishing-impots.fr' }) });
    expect(evaluerI5(entree, empreinte)).toBeNull();
  });

  it('cas limite : hash identique mais domaine authentique de la marque → pas de déclenchement', () => {
    const entree = creerEntree({ ressources: { logosHash: [], couleursDominantes: [], faviconHash: 'hash-legitime-abc' } });
    expect(evaluerI5(entree, empreinte)).toBeNull();
  });

  it('pas d\'URL (source mail) → pas de déclenchement', () => {
    expect(evaluerI5(creerEntree({ url: undefined, source: 'mail' }), empreinte)).toBeNull();
  });
});

describe(`I6 — au moins ${NB_COULEURS_MIN_I6} couleurs dominantes de la marque`, () => {
  const empreinte = creerEmpreinte();

  it('positif : deux couleurs communes', () => {
    const entree = creerEntree({ ressources: { logosHash: [], couleursDominantes: ['#000091', '#e1000f', '#ffffff'] } });
    expect(evaluerI6(entree, empreinte)).toMatchObject({ code: 'I6', poids: POIDS_IMITATION.I6, famille: 'visuelle' });
  });

  it('négatif : aucune couleur commune', () => {
    const entree = creerEntree({ ressources: { logosHash: [], couleursDominantes: ['#123456'] } });
    expect(evaluerI6(entree, empreinte)).toBeNull();
  });

  it('cas limite : une seule couleur commune (juste sous le seuil)', () => {
    const entree = creerEntree({ ressources: { logosHash: [], couleursDominantes: ['#000091'] } });
    expect(evaluerI6(entree, empreinte)).toBeNull();
  });
});

describe('I7 — punycode mêlé à du latin', () => {
  it('positif', () => {
    const entree = creerEntree({ url: creerUrl({ hote: 'xn--mpts-bub.gouv.fr', domaineEnregistrable: 'xn--mpts-bub.gouv.fr' }) });
    expect(evaluerI7(entree)).toMatchObject({ code: 'I7', poids: POIDS_IMITATION.I7, famille: 'lexicale-url' });
  });

  it('négatif : hôte entièrement latin', () => {
    expect(evaluerI7(creerEntree())).toBeNull();
  });

  it('cas limite : pas d\'URL (source mail)', () => {
    expect(evaluerI7(creerEntree({ url: undefined, source: 'mail' }))).toBeNull();
  });
});

describe('I8 — "gouv" hors du suffixe public réel', () => {
  it('positif : impots-gouv.fr', () => {
    const entree = creerEntree({ url: creerUrl({ hote: 'impots-gouv.fr', domaineEnregistrable: 'impots-gouv.fr', suffixePublic: 'fr' }) });
    expect(evaluerI8(entree)).toMatchObject({ code: 'I8', poids: POIDS_IMITATION.I8, famille: 'lexicale-url' });
  });

  it('négatif : impots.gouv.fr, gouv fait partie du suffixe', () => {
    expect(evaluerI8(creerEntree())).toBeNull();
  });

  it('cas limite : impots.gouv.fr.securise.com, gouv en sous-domaine hors du suffixe "com"', () => {
    const entree = creerEntree({
      url: creerUrl({ hote: 'impots.gouv.fr.securise.com', domaineEnregistrable: 'securise.com', suffixePublic: 'com' }),
    });
    expect(evaluerI8(entree)?.code).toBe('I8');
  });

  it('pas d\'URL (source mail) → pas de déclenchement', () => {
    expect(evaluerI8(creerEntree({ url: undefined, source: 'mail' }))).toBeNull();
  });
});

describe('compterFamillesIndependantes', () => {
  it('compte les familles distinctes, pas les signaux', () => {
    expect(
      compterFamillesIndependantes([
        { code: 'I1', poids: 30, famille: 'textuelle', detail: '' },
        { code: 'I2', poids: 15, famille: 'textuelle', detail: '' },
        { code: 'I4', poids: 25, famille: 'lexicale-url', detail: '' },
      ]),
    ).toBe(2);
  });

  it('cas limite : aucun signal → 0 famille', () => {
    expect(compterFamillesIndependantes([])).toBe(0);
  });
});

describe('evaluerAxeImitation — sélection de la marque la plus proche', () => {
  it('retient la marque au score le plus élevé parmi plusieurs', () => {
    const autre = creerEmpreinte({ id: 'ameli', termesForts: ['mon compte ameli'], termesFaibles: [], racinesTypo: ['ameli'], domaines: ['ameli.fr'], domainePrincipal: 'ameli.fr' });
    const entree = creerEntree({ texteVisible: 'Bienvenue dans votre Espace Particulier' });
    const r = evaluerAxeImitation(entree, [autre, creerEmpreinte()]);
    expect(r.marqueDetectee).toBe('impots-gouv');
    expect(r.score).toBe(POIDS_IMITATION.I1);
  });

  it('12.3.3.12 : à score égal, départage déterministe par identifiant alphabétique, quel que soit l\'ordre reçu', () => {
    const zzz = creerEmpreinte({ id: 'zzz-marque', termesForts: ['espace particulier'], termesFaibles: [] });
    const ameli = creerEmpreinte({ id: 'ameli', termesForts: ['espace particulier'], termesFaibles: [] });
    const entree = creerEntree({ texteVisible: 'Bienvenue dans votre Espace Particulier' });
    // zzz-marque en tête du tableau reçu : sans tri explicite, un simple
    // "score > meilleur.score" garderait zzz-marque, premier rencontré.
    const r1 = evaluerAxeImitation(entree, [zzz, ameli]);
    const r2 = evaluerAxeImitation(entree, [ameli, zzz]);
    expect(r1.marqueDetectee).toBe('ameli');
    expect(r2.marqueDetectee).toBe('ameli');
    expect(r1.score).toBe(r2.score);
  });

  it('cas limite : aucune marque ne correspond → score 0, pas de marque détectée', () => {
    const r = evaluerAxeImitation(creerEntree({ texteVisible: 'rien à voir' }), [creerEmpreinte()]);
    expect(r.score).toBe(0);
    expect(r.marqueDetectee).toBeUndefined();
    expect(r.famillesIndependantes).toBe(0);
  });
});

describe('Règle du plafond visuel (5.3) : I5 + I6 ne peut jamais, seul, atteindre un seuil d\'alerte', () => {
  it('I5 + I6 <= 28 et strictement sous SEUIL_MIN', () => {
    const somme = POIDS_IMITATION.I5 + POIDS_IMITATION.I6;
    expect(somme).toBeLessThanOrEqual(PLAFOND_VISUEL_I5_I6);
    expect(somme).toBeLessThan(SEUIL_MIN);
  });
});

// ---------------------------------------------------------------------------
// Axe E — signaux d'exposition.
// ---------------------------------------------------------------------------

describe('E1 — champ mot de passe visible', () => {
  it('positif', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([creerChamp({ type: 'password' })])] });
    expect(evaluerE1(entree)).toMatchObject({ code: 'E1', poids: POIDS_EXPOSITION.E1 });
  });

  it('négatif : aucun champ mot de passe', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([creerChamp({ type: 'text' })])] });
    expect(evaluerE1(entree)).toBeNull();
  });

  it('cas limite : champ mot de passe présent mais non visible', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([creerChamp({ type: 'password', visible: false })])] });
    expect(evaluerE1(entree)).toBeNull();
  });
});

describe('E2 — champ correspondant à un terme de saisie de la marque détectée', () => {
  const marque = creerEmpreinte();

  it('positif', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([creerChamp({ libelle: 'Numéro fiscal' })])] });
    expect(evaluerE2(entree, marque)).toMatchObject({ code: 'E2', poids: POIDS_EXPOSITION.E2 });
  });

  it('négatif : aucun champ ne correspond', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([creerChamp({ libelle: 'adresse email' })])] });
    expect(evaluerE2(entree, marque)).toBeNull();
  });

  it('cas limite : pas de marque détectée', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([creerChamp({ libelle: 'Numéro fiscal' })])] });
    expect(evaluerE2(entree, undefined)).toBeNull();
  });
});

describe('E3 — champ correspondant à un secret surveillé', () => {
  const config = creerConfig({ secretsSurveilles: [{ id: 's1', libelle: 'mon compte impots' }] });

  it('positif', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([creerChamp({ libelle: 'Mon compte impots' })])] });
    expect(evaluerE3(entree, config)).toMatchObject({ code: 'E3', poids: POIDS_EXPOSITION.E3 });
  });

  it('négatif : aucun secret ne correspond', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([creerChamp({ libelle: 'sans rapport' })])] });
    expect(evaluerE3(entree, config)).toBeNull();
  });

  it('cas limite : pas de configuration', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([creerChamp({ libelle: 'Mon compte impots' })])] });
    expect(evaluerE3(entree, undefined)).toBeNull();
  });
});

describe(`E4 — ≥ ${LONGUEUR_MIN_SAISIE_E4} caractères saisis dans un champ E1/E2/E3`, () => {
  it(`positif : exactement ${LONGUEUR_MIN_SAISIE_E4} caractères dans un champ mot de passe`, () => {
    const entree = creerEntree({
      formulaires: [creerFormulaire([creerChamp({ type: 'password', longueurSaisie: LONGUEUR_MIN_SAISIE_E4 })])],
    });
    expect(evaluerE4(entree)).toMatchObject({ code: 'E4', poids: POIDS_EXPOSITION.E4 });
  });

  it('négatif : un caractère de moins que le minimum', () => {
    const entree = creerEntree({
      formulaires: [creerFormulaire([creerChamp({ type: 'password', longueurSaisie: LONGUEUR_MIN_SAISIE_E4 - 1 })])],
    });
    expect(evaluerE4(entree)).toBeNull();
  });

  it('cas limite : saisie longue, mais dans un champ non sensible', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([creerChamp({ type: 'text', longueurSaisie: 40 })])] });
    expect(evaluerE4(entree)).toBeNull();
  });

  it('sensibilité portée par E2 (marque détectée) plutôt que par E1', () => {
    const entree = creerEntree({
      formulaires: [creerFormulaire([creerChamp({ type: 'text', libelle: 'Numéro fiscal', longueurSaisie: LONGUEUR_MIN_SAISIE_E4 })])],
    });
    expect(evaluerE4(entree, creerEmpreinte())?.code).toBe('E4');
  });

  it('sensibilité portée par E3 (secret surveillé) plutôt que par E1', () => {
    const config = creerConfig({ secretsSurveilles: [{ id: 's1', libelle: 'mon compte impots' }] });
    const entree = creerEntree({
      formulaires: [creerFormulaire([creerChamp({ type: 'text', libelle: 'Mon compte impots', longueurSaisie: LONGUEUR_MIN_SAISIE_E4 })])],
    });
    expect(evaluerE4(entree, undefined, config)?.code).toBe('E4');
  });

  it('cas limite : un champ non sensible précédant le champ mot de passe, sans marque ni config → ignoré, pas d\'erreur', () => {
    const entree = creerEntree({
      formulaires: [
        creerFormulaire([
          creerChamp({ type: 'text', libelle: 'recherche', longueurSaisie: 40 }),
          creerChamp({ type: 'password', longueurSaisie: LONGUEUR_MIN_SAISIE_E4 }),
        ]),
      ],
    });
    expect(evaluerE4(entree)?.code).toBe('E4');
  });
});

describe('E5 — secret reconnu à la frappe (court-circuit)', () => {
  it('positif', () => {
    const entree = creerEntree({ secretReconnu: { idSecret: 's1' } });
    expect(evaluerE5(entree)).toMatchObject({ code: 'E5', poids: POIDS_EXPOSITION.E5 });
  });

  it('négatif : aucun secret reconnu', () => {
    expect(evaluerE5(creerEntree())).toBeNull();
  });

  it('cas limite : idSecret vide, mais objet présent → déclenche quand même', () => {
    expect(evaluerE5(creerEntree({ secretReconnu: { idSecret: '' } }))?.code).toBe('E5');
  });
});

describe('E6 — action du formulaire vers un domaine différent', () => {
  it('positif', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([], { actionDomaineEnregistrable: 'ailleurs.fr' })] });
    expect(evaluerE6(entree)).toMatchObject({ code: 'E6', poids: POIDS_EXPOSITION.E6 });
  });

  it('négatif : action vers le même domaine', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([], { actionDomaineEnregistrable: 'impots.gouv.fr' })] });
    expect(evaluerE6(entree)).toBeNull();
  });

  it('cas limite : action inconnue (non renseignée)', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([])] });
    expect(evaluerE6(entree)).toBeNull();
  });
});

describe('E7 — formulaire dans une iframe cross-origin hors socle', () => {
  const socle = [creerEmpreinte()];

  it('positif', () => {
    const entree = creerEntree({
      formulaires: [creerFormulaire([], { dansIframeCrossOrigin: true, domaineFrame: 'attaquant.com' })],
    });
    expect(evaluerE7(entree, socle)).toMatchObject({ code: 'E7', poids: POIDS_EXPOSITION.E7 });
  });

  it('négatif : pas dans une iframe cross-origin', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([], { dansIframeCrossOrigin: false })] });
    expect(evaluerE7(entree, socle)).toBeNull();
  });

  it('cas limite : iframe cross-origin mais domaine du socle → pas de déclenchement', () => {
    const entree = creerEntree({
      formulaires: [creerFormulaire([], { dansIframeCrossOrigin: true, domaineFrame: 'impots.gouv.fr' })],
    });
    expect(evaluerE7(entree, socle)).toBeNull();
  });
});

describe('E8 — formulaire de paiement (5.4.1)', () => {
  it('positif : autocomplete cc-number', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([creerChamp({ autocomplete: 'cc-number' })])] });
    expect(evaluerE8(entree)).toMatchObject({ code: 'E8', poids: POIDS_EXPOSITION.E8, famille: 'paiement' });
  });

  it('négatif : aucun champ de paiement', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([creerChamp({ libelle: 'nom' })])] });
    expect(evaluerE8(entree)).toBeNull();
  });

  it('cas limite : cryptogramme seul, sans date d\'expiration → pas de déclenchement', () => {
    const entree = creerEntree({ formulaires: [creerFormulaire([creerChamp({ libelle: 'cryptogramme' })])] });
    expect(evaluerE8(entree)).toBeNull();
  });

  it('couple cryptogramme + date d\'expiration complet → déclenchement', () => {
    const entree = creerEntree({
      formulaires: [creerFormulaire([creerChamp({ libelle: 'cryptogramme' }), creerChamp({ libelle: "date d'expiration" })])],
    });
    expect(evaluerE8(entree)?.code).toBe('E8');
  });

  it('E8 ne déclenche rien seul : portail captif payant sans marqueur du socle → N0 (12.1.1, gabarit 09)', () => {
    const entree = creerEntree({
      url: creerUrl({ hote: 'wifi-hotel-paladru.example', domaineEnregistrable: 'wifi-hotel-paladru.example', suffixePublic: 'example' }),
      titre: 'Accès Wi-Fi payant',
      texteVisible: 'Payez 2€ pour accéder au Wi-Fi',
      formulaires: [creerFormulaire([creerChamp({ autocomplete: 'cc-number' })])],
    });
    const v = analyser(entree, creerListes({ domainesDejaVus: ['wifi-hotel-paladru.example'] }), creerConfig());
    expect(v.niveau).toBe('N0');
  });
});

// ---------------------------------------------------------------------------
// Modificateurs de seuil (M1-M6).
// ---------------------------------------------------------------------------

describe('M1 — domaine jamais vu', () => {
  it('positif', () => {
    const entree = creerEntree({ url: creerUrl({ domaineEnregistrable: 'nouveau.fr' }) });
    expect(evaluerM1(entree, creerListes({ domainesDejaVus: [] }))).toMatchObject({ code: 'M1', poids: MODIFICATEURS_SEUIL.M1 });
  });

  it('négatif : domaine déjà vu', () => {
    const entree = creerEntree({ url: creerUrl({ domaineEnregistrable: 'connu.fr' }) });
    expect(evaluerM1(entree, creerListes({ domainesDejaVus: ['connu.fr'] }))).toBeNull();
  });

  it('cas limite : pas d\'URL', () => {
    expect(evaluerM1(creerEntree({ url: undefined, source: 'mail' }), creerListes())).toBeNull();
  });
});

describe('M2 — domaine créé il y a moins de 90 jours (inactif sans donnée RDAP)', () => {
  const horodatage = Date.parse('2026-09-12T00:00:00Z');
  const jour = 24 * 60 * 60 * 1000;

  it('positif : 10 jours', () => {
    const entree = creerEntree({ horodatage, url: creerUrl({ dateCreationDomaine: horodatage - 10 * jour }) });
    expect(evaluerM2(entree)).toMatchObject({ code: 'M2', poids: MODIFICATEURS_SEUIL.M2 });
  });

  it('négatif : 120 jours', () => {
    const entree = creerEntree({ horodatage, url: creerUrl({ dateCreationDomaine: horodatage - 120 * jour }) });
    expect(evaluerM2(entree)).toBeNull();
  });

  it('cas limite : pas de donnée RDAP (cas normal en local, MVP) → jamais actif', () => {
    expect(evaluerM2(creerEntree({ url: creerUrl({ dateCreationDomaine: undefined }) }))).toBeNull();
  });
});

describe('M3 — hôte est une adresse IP littérale', () => {
  it('positif', () => {
    expect(evaluerM3(creerEntree({ url: creerUrl({ estAdresseIp: true }) }))).toMatchObject({ code: 'M3', poids: MODIFICATEURS_SEUIL.M3 });
  });

  it('négatif', () => {
    expect(evaluerM3(creerEntree({ url: creerUrl({ estAdresseIp: false }) }))).toBeNull();
  });

  it('cas limite : pas d\'URL', () => {
    expect(evaluerM3(creerEntree({ url: undefined, source: 'mail' }))).toBeNull();
  });
});

describe('M4 — au moins 4 niveaux de sous-domaines', () => {
  it('positif : exactement 4', () => {
    const entree = creerEntree({ url: creerUrl({ sousDomaines: ['a', 'b', 'c', 'd'] }) });
    expect(evaluerM4(entree)).toMatchObject({ code: 'M4', poids: MODIFICATEURS_SEUIL.M4 });
  });

  it('négatif : aucun sous-domaine', () => {
    expect(evaluerM4(creerEntree({ url: creerUrl({ sousDomaines: [] }) }))).toBeNull();
  });

  it('cas limite : 3 niveaux, juste sous le seuil', () => {
    const entree = creerEntree({ url: creerUrl({ sousDomaines: ['a', 'b', 'c'] }) });
    expect(evaluerM4(entree)).toBeNull();
  });

  it('pas d\'URL', () => {
    expect(evaluerM4(creerEntree({ url: undefined, source: 'mail' }))).toBeNull();
  });
});

describe('M5 — TLD à fort taux d\'abus', () => {
  it('positif', () => {
    const entree = creerEntree({ url: creerUrl({ suffixePublic: 'zip' }) });
    expect(evaluerM5(entree, creerListes())).toMatchObject({ code: 'M5', poids: MODIFICATEURS_SEUIL.M5 });
  });

  it('négatif : TLD hors liste', () => {
    const entree = creerEntree({ url: creerUrl({ suffixePublic: 'gouv.fr' }) });
    expect(evaluerM5(entree, creerListes())).toBeNull();
  });

  it('cas limite : pas d\'URL', () => {
    expect(evaluerM5(creerEntree({ url: undefined, source: 'mail' }), creerListes())).toBeNull();
  });
});

describe('M6 — hôte validé par la couche communautaire (14.33 F : hôte exact)', () => {
  it('positif', () => {
    const entree = creerEntree({ url: creerUrl({ hote: 'www.mairie-montferrat.fr', domaineEnregistrable: 'mairie-montferrat.fr' }) });
    expect(evaluerM6(entree, creerListes({ communautaireValidee: ['www.mairie-montferrat.fr'] }))).toMatchObject({
      code: 'M6',
      poids: MODIFICATEURS_SEUIL.M6,
    });
  });

  it('négatif : valider un hôte ne valide ni le domaine enregistrable ni un autre sous-domaine', () => {
    const entree = creerEntree({ url: creerUrl({ hote: 'autre.mairie-montferrat.fr', domaineEnregistrable: 'mairie-montferrat.fr' }) });
    expect(evaluerM6(entree, creerListes({ communautaireValidee: ['www.mairie-montferrat.fr'] }))).toBeNull();
    const apex = creerEntree({ url: creerUrl({ hote: 'mairie-montferrat.fr', domaineEnregistrable: 'mairie-montferrat.fr' }) });
    expect(evaluerM6(apex, creerListes({ communautaireValidee: ['www.mairie-montferrat.fr'] }))).toBeNull();
  });

  it('négatif : domaine non validé', () => {
    const entree = creerEntree({ url: creerUrl({ domaineEnregistrable: 'inconnu.fr' }) });
    expect(evaluerM6(entree, creerListes())).toBeNull();
  });

  it('cas limite : pas d\'URL', () => {
    expect(evaluerM6(creerEntree({ url: undefined, source: 'mail' }), creerListes())).toBeNull();
  });
});

describe('calculerSeuil', () => {
  it('base à 70 sans modificateur, sensibilité équilibrée', () => {
    expect(calculerSeuil(0, 'equilibre')).toBe(SEUIL_BASE);
  });

  it('prudent abaisse, strict relève', () => {
    expect(calculerSeuil(0, 'prudent')).toBe(SEUIL_BASE + AJUSTEMENT_SENSIBILITE.prudent);
    expect(calculerSeuil(0, 'strict')).toBe(SEUIL_BASE + AJUSTEMENT_SENSIBILITE.strict);
  });

  it('cas limite : borné à SEUIL_MIN et SEUIL_MAX', () => {
    expect(calculerSeuil(-1000, 'prudent')).toBe(SEUIL_MIN);
    expect(calculerSeuil(1000, 'strict')).toBe(SEUIL_MAX);
  });
});

// ---------------------------------------------------------------------------
// analyser() — arbre de décision complet, 5.6. Un test par branche.
// ---------------------------------------------------------------------------

describe('analyser — court-circuits Z1 à Z5 (v1.3 : révocation avant socle)', () => {
  it('Z1 : domaine dans la liste de révocation → N3 immédiat, même sans autre signal', () => {
    const entree = creerEntree({ url: creerUrl({ domaineEnregistrable: 'revoque.fr', hote: 'revoque.fr' }) });
    const v = analyser(entree, creerListes({ revocation: ['revoque.fr'] }), creerConfig());
    expect(v).toMatchObject({ niveau: 'N3', motif: 'domaine signalé' });
  });

  it('Z1 (14.37 point 4) : un hôte confirmé frauduleux → N3 immédiat, même sans champ de saisie, marqué « signaleParListe »', () => {
    const entree = creerEntree({ url: creerUrl({ domaineEnregistrable: 'heberge.fr', hote: 'faux.heberge.fr' }), formulaires: [] });
    const v = analyser(entree, creerListes({ hotesFrauduleux: ['faux.heberge.fr'] }), creerConfig());
    expect(v).toMatchObject({ niveau: 'N3', motif: 'domaine signalé', signaleParListe: true });
  });

  it('Z1 (14.37 point 4) : par hôte exact : ni le domaine enregistrable, ni un autre hôte du même domaine ne sont touchés', () => {
    const listes = creerListes({ hotesFrauduleux: ['faux.heberge.fr'] });
    for (const hote of ['heberge.fr', 'sain.heberge.fr']) {
      const v = analyser(creerEntree({ url: creerUrl({ domaineEnregistrable: 'heberge.fr', hote }), formulaires: [] }), listes, creerConfig());
      expect(v.niveau).toBe('N0');
      expect(v).not.toHaveProperty('signaleParListe');
    }
  });

  it("Z1 (14.37 point 4) : prime sur Z2 et Z3 — un hôte listé sur un domaine du socle ou exclu par l'utilisateur reste N3", () => {
    const duSocle = creerEntree({ texteVisible: 'Votre Espace Particulier' }); // impots.gouv.fr
    expect(analyser(duSocle, creerListes({ hotesFrauduleux: [duSocle.url!.hote] }), creerConfig()).niveau).toBe('N3');
    const exclu = creerEntree({ url: creerUrl({ domaineEnregistrable: 'exclu.fr', hote: 'www.exclu.fr' }) });
    expect(analyser(exclu, creerListes({ exclusionsPersonnelles: ['exclu.fr'], hotesFrauduleux: ['www.exclu.fr'] }), creerConfig()).niveau).toBe('N3');
  });

  it('Z1 prime sur Z2 : un domaine du socle ET révoqué doit produire N3, pas N0 (défaut relevé à la revue du lot L1)', () => {
    const entree = creerEntree({ texteVisible: 'Votre Espace Particulier' }); // impots.gouv.fr, authentique
    const v = analyser(entree, creerListes({ revocation: ['impots.gouv.fr'] }), creerConfig());
    expect(v).toMatchObject({ niveau: 'N3', motif: 'domaine signalé' });
  });

  it('Z2 : domaine authentique de la marque, marqueurs correspondants → N0, arrêt', () => {
    const entree = creerEntree({ texteVisible: 'Votre Espace Particulier' });
    const v = analyser(entree, creerListes(), creerConfig());
    expect(v.niveau).toBe('N0');
    expect(v.marqueDetectee).toBe('impots-gouv');
    expect(v.scoreExposition).toBeUndefined(); // arrêt : l'axe E n'est pas calculé
  });

  it('Z2 ne s\'applique pas si le domaine est authentique mais qu\'aucun marqueur ne correspond : l\'analyse se poursuit', () => {
    const entree = creerEntree({
      texteVisible: 'page vide, sans rapport avec la marque',
      formulaires: [creerFormulaire([creerChamp({ type: 'password' })])],
    });
    const v = analyser(entree, creerListes(), creerConfig());
    // domaine.gouv.fr authentique, mais I == 0 : sous tous les seuils, pas un arrêt Z2.
    expect(v.motif).not.toBe('domaine authentique de la marque détectée');
    expect(v.scoreImitation).toBe(0);
  });

  it('pas d\'URL (source mail) : Z1 à Z4 ignorés, l\'analyse se poursuit sur le seul contenu', () => {
    const entree = creerEntree({
      url: undefined,
      source: 'mail',
      texteVisible: 'rien à voir',
      formulaires: [creerFormulaire([creerChamp({ type: 'password' })])],
    });
    const v = analyser(entree, creerListes(), creerConfig());
    expect(v.niveau).toBe('N0');
    expect(v.motif).toBe("sous les seuils d'alerte");
  });

  it('Z3 : domaine dans les exclusions personnelles → N0', () => {
    const entree = creerEntree({
      url: creerUrl({ domaineEnregistrable: 'exclu.fr', hote: 'exclu.fr' }),
      texteVisible: 'Votre Espace Particulier',
      formulaires: [creerFormulaire([creerChamp({ type: 'password' })])],
    });
    const v = analyser(entree, creerListes({ exclusionsPersonnelles: ['exclu.fr'] }), creerConfig());
    expect(v.niveau).toBe('N0');
  });

  it('Z4 : schéma interne au navigateur → N0', () => {
    const entree = creerEntree({ url: creerUrl({ schema: 'chrome', hote: 'extensions', domaineEnregistrable: 'extensions' }) });
    expect(analyser(entree, creerListes(), creerConfig()).niveau).toBe('N0');
  });

  it('Z4 : domaine local (localhost) → N0', () => {
    const entree = creerEntree({ url: creerUrl({ hote: 'localhost', domaineEnregistrable: 'localhost' }) });
    expect(analyser(entree, creerListes(), creerConfig()).niveau).toBe('N0');
  });

  it('Z5 : aucun champ de saisie ni formulaire → N0, sans analyse d\'imitation', () => {
    const entree = creerEntree({
      url: creerUrl({ hote: 'impots-gouv.fr', domaineEnregistrable: 'impots-gouv.fr' }),
      texteVisible: 'Espace Particulier',
      formulaires: [],
    });
    const v = analyser(entree, creerListes({ domainesDejaVus: ['impots-gouv.fr'] }), creerConfig());
    expect(v).toMatchObject({ niveau: 'N0', motif: 'aucun champ de saisie ni formulaire' });
  });
});

describe('analyser — règle E == 0', () => {
  it('page imitant une marque mais ne demandant rien → N0 (E == 0)', () => {
    const entree = creerEntree({
      url: creerUrl({ hote: 'impots-gouv.fr', domaineEnregistrable: 'impots-gouv.fr' }),
      texteVisible: 'Votre Espace Particulier, DGFiP',
      formulaires: [creerFormulaire([creerChamp({ type: 'text', nom: 'recherche' })])],
    });
    const v = analyser(entree, creerListes({ domainesDejaVus: ['impots-gouv.fr'] }), creerConfig());
    expect(v).toMatchObject({ niveau: 'N0', motif: 'aucune exposition détectée', scoreExposition: 0 });
    expect(v.scoreImitation).toBeGreaterThan(0);
  });
});

describe('analyser — court-circuit E5', () => {
  it('secret reconnu à la frappe → N3, quel que soit le score d\'imitation', () => {
    const entree = creerEntree({
      url: creerUrl({ hote: 'sans-rapport.fr', domaineEnregistrable: 'sans-rapport.fr' }),
      texteVisible: 'rien à voir',
      formulaires: [creerFormulaire([creerChamp({ type: 'password' })])],
      secretReconnu: { idSecret: 's1' },
    });
    const v = analyser(entree, creerListes({ domainesDejaVus: ['sans-rapport.fr'] }), creerConfig());
    expect(v).toMatchObject({ niveau: 'N3', motif: 'secret reconnu à la frappe' });
  });
});

describe('analyser — calcul de niveau au seuil', () => {
  const domainePhishing = 'impots-gouv.fr'; // distance 1 de impots.gouv.fr ; I8 également

  function entreePhishing(champs: ChampFormulaire[]): EntreeAnalyse {
    return creerEntree({
      url: creerUrl({ hote: domainePhishing, domaineEnregistrable: domainePhishing, suffixePublic: 'fr' }),
      titre: 'Espace Particulier',
      texteVisible: "Espace Particulier — DGFiP, avis d'imposition, taxe d'habitation",
      formulaires: [creerFormulaire(champs)],
    });
  }

  it('N3 : imitation ≥ seuil sur deux familles, exposition ≥ 55', () => {
    const entree = entreePhishing([creerChamp({ type: 'password', longueurSaisie: 8 })]);
    const v = analyser(entree, creerListes({ domainesDejaVus: [domainePhishing] }), creerConfig());
    expect(v.niveau).toBe('N3');
    expect(v.scoreImitation).toBeGreaterThanOrEqual(v.seuil!);
    expect(v.scoreExposition).toBeGreaterThanOrEqual(55);
  });

  it('N2 : imitation ≥ seuil, exposition entre 35 et 55', () => {
    const entree = entreePhishing([creerChamp({ type: 'password' })]); // E1 seul = 35, pas de E4
    const v = analyser(entree, creerListes({ domainesDejaVus: [domainePhishing] }), creerConfig());
    expect(v.niveau).toBe('N2');
    // 14.12, point 2 : le type garantit marqueDetectee à N1/N2 (VerdictAvecMarque) —
    // cette assertion vérifie que le moteur tient réellement l'invariant, pas seulement le type.
    if (v.niveau === 'N2') expect(v.marqueDetectee).toBe('impots-gouv');
  });

  it('N1 : imitation entre 45 et le seuil, exposition ≥ 35', () => {
    const entree = creerEntree({
      url: creerUrl({ hote: 'sans-rapport-du-tout.fr', domaineEnregistrable: 'sans-rapport-du-tout.fr' }),
      titre: 'Espace Particulier',
      texteVisible: "Espace Particulier, DGFiP, avis d'imposition, taxe d'habitation", // I1 + I2 = 45
      formulaires: [creerFormulaire([creerChamp({ type: 'password' })])], // E1 = 35
    });
    const v = analyser(entree, creerListes({ domainesDejaVus: ['sans-rapport-du-tout.fr'] }), creerConfig());
    expect(v.scoreImitation).toBe(POIDS_IMITATION.I1 + POIDS_IMITATION.I2);
    expect(v.niveau).toBe('N1');
    if (v.niveau === 'N1') expect(v.marqueDetectee).toBe('impots-gouv');
  });

  it('N0 : sous tous les seuils', () => {
    const entree = creerEntree({
      url: creerUrl({ hote: 'sans-rapport-du-tout.fr', domaineEnregistrable: 'sans-rapport-du-tout.fr' }),
      texteVisible: 'Espace Particulier', // I1 seul = 30, < 45
      formulaires: [creerFormulaire([creerChamp({ type: 'password' })])],
    });
    const v = analyser(entree, creerListes({ domainesDejaVus: ['sans-rapport-du-tout.fr'] }), creerConfig());
    expect(v.niveau).toBe('N0');
    expect(v.motif).toBe("sous les seuils d'alerte");
  });

  it('14.47 : un hôte RÉPERTORIÉ ne reçoit pas M6 : le verdict est identique à celui d\'un hôte inconnu (N3, imitation forte ou faible)', () => {
    const cas = [
      entreePhishing([creerChamp({ type: 'password', longueurSaisie: 8 })]),
      entreePhishing([creerChamp({ type: 'password' })]),
      creerEntree({ texteVisible: 'Votre Espace Particulier', url: creerUrl({ hote: 'sans-rapport-du-tout.fr', domaineEnregistrable: 'sans-rapport-du-tout.fr' }), formulaires: [creerFormulaire([creerChamp({ type: 'password' })])] }),
    ];
    for (const entree of cas) {
      const hote = entree.url!.hote;
      const inconnu = analyser(entree, creerListes({ domainesDejaVus: [entree.url!.domaineEnregistrable] }), creerConfig());
      const repertorie = analyser(entree, creerListes({ domainesDejaVus: [entree.url!.domaineEnregistrable], hotesRepertories: [hote] }), creerConfig());
      expect(repertorie).toEqual(inconnu);
      expect(repertorie.motif).not.toContain('M6');
    }
    // à l'inverse, le MÊME hôte validé reçoit M6 (jamais N3)
    const fort = cas[0]!;
    expect(analyser(fort, creerListes({ domainesDejaVus: [fort.url!.domaineEnregistrable], communautaireValidee: [fort.url!.hote] }), creerConfig()).niveau).toBe('N2');
    expect(analyser(fort, creerListes({ domainesDejaVus: [fort.url!.domaineEnregistrable], hotesRepertories: [fort.url!.hote] }), creerConfig()).niveau).toBe('N3');
  });

  it('M6 : domaine validé par la couche communautaire → jamais N3, même si le calcul de seuil le permettrait', () => {
    const entree = entreePhishing([creerChamp({ type: 'password', longueurSaisie: 8 })]);
    const listes = creerListes({ domainesDejaVus: [domainePhishing], communautaireValidee: [domainePhishing] });
    const v = analyser(entree, listes, creerConfig());
    expect(v.niveau).toBe('N2');
    expect(v.motif).toContain('M6');
  });
});

// ---------------------------------------------------------------------------
// 14.5 / 14.13 point 6 : le plafond N2 de la version d'essai ne vise que le N3
// atteint par le score. Z1 et E5 sont des N3 de court-circuit, sans marque :
// les rendre N2 produirait un N2 sans marque que le type Verdict refuse.
// ---------------------------------------------------------------------------
describe('analyser — plafond de la version d\'essai (n3ParScoreActif = false)', () => {
  const domainePhishing = 'impots-gouv.fr';
  const plafond = () => creerConfig({ n3ParScoreActif: false });

  function entreeN3ParScore(extra: Partial<EntreeAnalyse> = {}): EntreeAnalyse {
    return creerEntree({
      url: creerUrl({ hote: domainePhishing, domaineEnregistrable: domainePhishing, suffixePublic: 'fr' }),
      titre: 'Espace Particulier',
      texteVisible: "Espace Particulier — DGFiP, avis d'imposition, taxe d'habitation",
      formulaires: [creerFormulaire([creerChamp({ type: 'password', longueurSaisie: 8 })])],
      ...extra,
    });
  }

  it('positif : un N3 par score devient N2, avec sa marque (le type l\'exige)', () => {
    const listes = creerListes({ domainesDejaVus: [domainePhishing] });
    expect(analyser(entreeN3ParScore(), listes, creerConfig()).niveau).toBe('N3'); // témoin : sans plafond
    const v = analyser(entreeN3ParScore(), listes, plafond());
    expect(v.niveau).toBe('N2');
    if (v.niveau === 'N2') expect(v.marqueDetectee).toBe('impots-gouv');
    expect(v.motif).toContain('14.5');
  });

  it('négatif : Z1 (domaine révoqué) reste N3, sans marque — le plafond ne le touche pas', () => {
    const entree = creerEntree({ url: creerUrl({ domaineEnregistrable: 'revoque.fr', hote: 'revoque.fr' }) });
    const v = analyser(entree, creerListes({ revocation: ['revoque.fr'] }), plafond());
    expect(v).toMatchObject({ niveau: 'N3', motif: 'domaine signalé' });
    expect(v.marqueDetectee).toBeUndefined();
  });

  it('négatif : E5 (secret reconnu à la frappe) reste N3, sans marque — l\'alerte la plus grave n\'est jamais plafonnée', () => {
    const entree = creerEntree({
      url: creerUrl({ hote: 'sans-rapport.fr', domaineEnregistrable: 'sans-rapport.fr' }),
      texteVisible: 'rien à voir',
      formulaires: [creerFormulaire([creerChamp({ type: 'password' })])],
      secretReconnu: { idSecret: 's1' },
    });
    const v = analyser(entree, creerListes({ domainesDejaVus: ['sans-rapport.fr'] }), plafond());
    expect(v).toMatchObject({ niveau: 'N3', motif: 'secret reconnu à la frappe' });
    expect(v.marqueDetectee).toBeUndefined();
  });

  it('cas limite : sans le drapeau (moteur seul) le comportement est inchangé, N3 actif', () => {
    const listes = creerListes({ domainesDejaVus: [domainePhishing] });
    expect(analyser(entreeN3ParScore(), listes, creerConfig()).niveau).toBe('N3');
    expect(analyser(entreeN3ParScore(), listes, creerConfig({ n3ParScoreActif: true })).niveau).toBe('N3');
  });

  it('cas limite : le plafond ne fabrique jamais un N2 sans marque, sur les trois voies de N3', () => {
    const listes = creerListes({ domainesDejaVus: [domainePhishing], revocation: ['revoque.fr'] });
    const verdicts = [
      analyser(entreeN3ParScore(), listes, plafond()),
      analyser(creerEntree({ url: creerUrl({ domaineEnregistrable: 'revoque.fr', hote: 'revoque.fr' }) }), listes, plafond()),
    ];
    for (const v of verdicts) {
      if (v.niveau === 'N2') expect(v.marqueDetectee).toBeTruthy();
    }
  });
});
