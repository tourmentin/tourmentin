// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.57 : mémoire d'imitation entre les pages d'un même hôte (connexion en deux étapes). Moteur pur : la mémoire est une entrée.
import { describe, expect, it } from 'vitest';
import { analyser } from '../../src/moteur/analyser.js';
import { DUREE_MEMOIRE_IMITATION_MS, SEUIL_I_POUR_N1 } from '../../src/moteur/constantes.js';
import { aChampIdentifiantConnexion, estChampIdentifiantConnexion, imitationARetenir } from '../../src/moteur/memoire-imitation.js';
import type { ChampFormulaire, Config, EmpreinteMarque, EntreeAnalyse, FormulaireNormalise, ImitationRetenue, Listes, UrlAnalysee } from '../../src/moteur/types.js';

// Fixtures, mêmes données fictives que tests/unitaires/moteur.test.ts.
function creerEmpreinte(partiel: Partial<EmpreinteMarque> = {}): EmpreinteMarque {
  return {
    id: 'impots-gouv',
    libelle: 'Impôts / DGFiP (fictif)',
    domaines: ['impots.gouv.fr', 'cfspart.impots.gouv.fr'],
    domainePrincipal: 'impots.gouv.fr',
    termesForts: ['espace particulier', 'numéro fiscal'],
    termesFaibles: ['dgfip', "avis d'imposition", "taxe d'habitation", 'prélèvement à la source', 'télédéclaration'],
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
  return { socle: [creerEmpreinte()], revocation: [], exclusionsPersonnelles: [], communautaireValidee: [], domainesDejaVus: ['impots.gouv.fr'], tldAbusifs: ['tk', 'zip'], ...partiel };
}
function creerConfig(partiel: Partial<Config> = {}): Config {
  return { sensibilite: 'equilibre', motsClesPersonnels: [], secretsSurveilles: [], ...partiel };
}

const HOTE = 'secure-acces.fr';
const listes = (p: Partial<Listes> = {}) => creerListes({ domainesDejaVus: [HOTE, 'autre-site.fr'], ...p });
const urlFaux = (hote = HOTE) => creerUrl({ hote, domaineEnregistrable: hote, suffixePublic: 'fr' });

/** Écran 1 : la page imite la marque et demande l'identifiant (aucun mot de passe). */
function ecran1(champs: ChampFormulaire[] = [creerChamp({ type: 'text', libelle: 'Identifiant' })]): EntreeAnalyse {
  return creerEntree({
    url: urlFaux(),
    titre: 'Espace Particulier',
    texteVisible: "Espace Particulier — DGFiP, avis d'imposition, taxe d'habitation",
    formulaires: [creerFormulaire(champs)],
  });
}
/** Écran 2 : page dépouillée (aucun terme de la marque), un mot de passe. */
function ecran2(champs: ChampFormulaire[] = [creerChamp({ type: 'password' })], hote = HOTE): EntreeAnalyse {
  return creerEntree({ url: urlFaux(hote), titre: 'Connexion', texteVisible: 'Saisissez votre mot de passe', formulaires: [creerFormulaire(champs)] });
}

describe('estChampIdentifiantConnexion / aChampIdentifiantConnexion', () => {
  it.each([
    [{ autocomplete: 'username' }, true],
    [{ autocomplete: 'section-x email' }, true],
    [{ libelle: 'Identifiant' }, true],
    [{ libelle: 'Adresse e-mail' }, true],
    [{ libelle: 'Numéro fiscal' }, true],
    [{ placeholder: 'Numéro de sécurité sociale' }, true],
    [{ nom: 'login' }, true],
    [{ libelle: 'Rechercher' }, false],
    [{ type: 'search', libelle: 'Identifiant' }, false],
    [{ type: 'password', libelle: 'Mot de passe' }, false],
    [{ type: 'hidden', nom: 'email' }, false],
    [{ visible: false, libelle: 'Identifiant' }, false],
    [{ libelle: 'Votre message' }, false],
  ] as [Partial<ChampFormulaire>, boolean][])('%j → %s', (champ, attendu) => {
    expect(estChampIdentifiantConnexion(creerChamp(champ))).toBe(attendu);
  });
  it('page sans formulaire : faux', () => expect(aChampIdentifiantConnexion(creerEntree())).toBe(false));
});

describe('imitationARetenir', () => {
  const cfg = creerConfig();
  it("retient l'imitation d'un écran d'identifiant (marque, score, familles)", () => {
    const e = ecran1();
    const r = imitationARetenir(e, analyser(e, listes(), cfg), listes());
    expect(r).not.toBeNull();
    expect(r!.marque).toBe('impots-gouv');
    expect(r!.scoreImitation).toBeGreaterThanOrEqual(SEUIL_I_POUR_N1);
    expect(r!.familles.length).toBeGreaterThan(0);
  });
  it("ne retient rien si la page ne demande pas d'identifiant", () => {
    const e = ecran1([creerChamp({ type: 'text', libelle: 'Rechercher' })]);
    expect(imitationARetenir(e, analyser(e, listes(), cfg), listes())).toBeNull();
  });
  it('ne retient rien en dessous du plancher de N1', () => {
    const e = creerEntree({ url: urlFaux('autre-site.fr'), texteVisible: 'rien', formulaires: [creerFormulaire([creerChamp({ libelle: 'Identifiant' })])] });
    expect(imitationARetenir(e, analyser(e, listes(), cfg), listes())).toBeNull();
  });
  it('ne retient rien sur le domaine authentique de la marque (Z2)', () => {
    const e = creerEntree({ texteVisible: "Espace Particulier — DGFiP, avis d'imposition", formulaires: [creerFormulaire([creerChamp({ libelle: 'Identifiant' })])] });
    const v = analyser(e, listes(), cfg);
    expect(v.motif).toBe('domaine authentique de la marque détectée');
    expect(imitationARetenir(e, v, listes())).toBeNull();
  });
  it('ne retient rien si le domaine est validé par la couche communautaire (M6)', () => {
    const e = ecran1();
    expect(imitationARetenir(e, analyser(e, listes({ communautaireValidee: [HOTE] }), cfg), listes({ communautaireValidee: [HOTE] }))).toBeNull();
  });
  it('ne retient rien sur un hôte signalé par liste, ni hors périmètre', () => {
    const e = ecran1();
    expect(imitationARetenir(e, analyser(e, listes({ revocation: [HOTE] }), cfg), listes({ revocation: [HOTE] }))).toBeNull();
    const local = ecran1();
    local.url = creerUrl({ hote: 'x.localhost', domaineEnregistrable: 'x.localhost' });
    expect(imitationARetenir(local, analyser(local, listes(), cfg), listes())).toBeNull();
  });
});

describe('analyser avec imitation retenue (connexion en deux étapes)', () => {
  const cfg = creerConfig();
  const retenueForte: ImitationRetenue = { marque: 'impots-gouv', scoreImitation: 85, familles: ['domaine', 'contenu'] };

  it("parcours, faux site au nom ressemblant : sans mémoire l'écran dépouillé reste N1, avec la mémoire de l'écran 1 il passe N2", () => {
    const h = 'impots-gouv.fr';
    const l = creerListes({ domainesDejaVus: [h] });
    const e1 = creerEntree({ url: urlFaux(h), titre: 'Espace Particulier', texteVisible: "Espace Particulier — DGFiP, avis d'imposition, taxe d'habitation", formulaires: [creerFormulaire([creerChamp({ libelle: 'Identifiant' })])] });
    const retenue = imitationARetenir(e1, analyser(e1, l, cfg), l)!;
    expect(retenue).not.toBeNull();
    const e2 = ecran2(undefined, h);
    expect(analyser(e2, l, cfg).niveau).toBe('N1');
    const v2 = analyser(e2, l, cfg, { imitationRetenue: retenue });
    expect(v2.niveau).toBe('N2');
    expect(v2.scoreImitation).toBe(retenue.scoreImitation);
    expect(v2.marqueDetectee).toBe('impots-gouv');
    expect(v2.imitationRetenueUtilisee).toEqual(retenue);
    expect(v2.motif).toContain('14.57');
  });
  it("parcours, faux site au nom neutre : écran 2 dépouillé = N0 sans mémoire, alerte avec la mémoire (imitation de l'écran 1 = contenu seul)", () => {
    const retenue = imitationARetenir(ecran1(), analyser(ecran1(), listes(), cfg), listes())!;
    expect(retenue).not.toBeNull();
    expect(analyser(ecran2(), listes(), cfg).niveau).toBe('N0');
    const v2 = analyser(ecran2(), listes(), cfg, { imitationRetenue: retenue });
    expect(v2.niveau).toBe(retenue.scoreImitation >= v2.seuil! ? 'N2' : 'N1');
    expect(['N1', 'N2']).toContain(v2.niveau);
  });
  it('les seuils ne changent pas : une imitation retenue entre 45 et le seuil donne N1, pas N2', () => {
    const v = analyser(ecran2(), listes(), cfg, { imitationRetenue: { marque: 'impots-gouv', scoreImitation: 50, familles: ['domaine'] } });
    expect(v.niveau).toBe('N1');
  });
  it('sans mot de passe ni paiement sur la page suivante, la mémoire est ignorée (E = 0 reste N0)', () => {
    const sansMdp = ecran2([creerChamp({ type: 'text', libelle: 'Votre message' })]);
    const v = analyser(sansMdp, listes(), cfg, { imitationRetenue: retenueForte });
    expect(v.niveau).toBe('N0');
    expect(v.imitationRetenueUtilisee).toBeUndefined();
  });
  it('un paiement (E8) sur la page suivante utilise aussi la mémoire', () => {
    const paiement = ecran2([creerChamp({ type: 'text', libelle: 'Numéro de carte' })]);
    expect(analyser(paiement, listes(), cfg, { imitationRetenue: retenueForte }).niveau).toBe('N2');
  });
  it('max(I page, I retenu) : une mémoire plus faible que la page ne change rien', () => {
    const page = ecran1([creerChamp({ type: 'password' })]);
    const sans = analyser(page, listes(), cfg);
    const avec = analyser(page, listes(), cfg, { imitationRetenue: { marque: 'impots-gouv', scoreImitation: 20, familles: ['domaine'] } });
    expect(avec).toEqual(sans);
  });
  it('un domaine validé (M6) garde son seuil relevé : la mémoire ne le contourne pas', () => {
    const v = analyser(ecran2(), listes({ communautaireValidee: [HOTE] }), cfg, { imitationRetenue: { marque: 'impots-gouv', scoreImitation: 80, familles: ['domaine'] } });
    expect(v.niveau).not.toBe('N2'); // seuil 70 + 20 (M6) = 90 > 80
  });
  it("sans contexte, le comportement est celui d'avant", () => {
    expect(analyser(ecran2(), listes(), cfg)).toEqual(analyser(ecran2(), listes(), cfg, {}));
  });
  it('la durée de la mémoire est de 15 minutes', () => expect(DUREE_MEMOIRE_IMITATION_MS).toBe(900_000));
});
