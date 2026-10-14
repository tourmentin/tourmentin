// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.3 : repérage du segment socle-affiche — pages qui affichent une
// marque du socle hors de ses domaines, avec un formulaire. Hors seuil de
// couverture de src/.
import { describe, expect, it } from 'vitest';
import { selectionnerSocleAffiche, trouverCandidats } from './selection-socle-affiche.mjs';

type Marqueur = { marque: string; horsDomaines: boolean; termesForts: string[] };
const page = (marqueurs: Marqueur[], { aFormulaire = true, etape = null as string | null, score = 30 } = {}) => ({
  url: 'https://exemple.fr/connexion',
  aFormulaire,
  etape,
  scoreImitation: score,
  marqueDetectee: marqueurs[0]?.marque ?? null,
  signaux: [],
  marqueurs,
});
const fc = (horsDomaines = true): Marqueur => ({ marque: 'franceconnect', horsDomaines, termesForts: ["s'identifier avec FranceConnect"] });
const poste = (): Marqueur => ({ marque: 'laposte', horsDomaines: true, termesForts: ['suivre mon colis'] });
const hote = (h: string, extra: object) => ({ hote: h, domaine: h, segmentOrigine: 'commune', libelle: h, ...extra });

describe('trouverCandidats', () => {
  it('positif : marqueur fort hors domaines, avec formulaire', () => {
    const c = trouverCandidats([hote('a.fr', { imitationConnexion: page([fc()]) })]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ hote: 'a.fr', source: 'connexion', avecFranceConnect: true });
  });

  it('négatif : le marqueur est sur le domaine de la marque lui-même', () => {
    expect(trouverCandidats([hote('a.fr', { imitationConnexion: page([fc(false)]) })])).toEqual([]);
  });

  it('négatif : marqueur fort mais aucun formulaire', () => {
    expect(trouverCandidats([hote('a.fr', { imitationAccueil: page([fc()], { aFormulaire: false }) })])).toEqual([]);
  });

  it('négatif : aucun marqueur', () => {
    expect(trouverCandidats([hote('a.fr', { imitationAccueil: page([]) })])).toEqual([]);
  });

  it('une seule page par hôte : la page de connexion (étape connue) l\'emporte sur l\'accueil', () => {
    const c = trouverCandidats([
      hote('a.fr', { imitationAccueil: page([fc()], { score: 80 }), imitationConnexion: page([fc()], { etape: 'mot-de-passe', score: 30 }) }),
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]!.source).toBe('connexion');
  });
});

describe('selectionnerSocleAffiche', () => {
  const candidats = (nbFc: number, nbAutres: number) => [
    ...Array.from({ length: nbFc }, (_, i) => ({ hote: `fc${i}.fr`, scoreImitation: 30, avecFranceConnect: true })),
    ...Array.from({ length: nbAutres }, (_, i) => ({ hote: `p${i}.fr`, scoreImitation: 20, avecFranceConnect: false })),
  ];

  it('cible atteinte avec au moins la moitié de FranceConnect', () => {
    const r = selectionnerSocleAffiche(candidats(80, 80) as never);
    expect(r.retenues).toHaveLength(100);
    expect(r.retenuesFranceConnect).toBe(50);
    expect(r.minFranceConnectAtteint).toBe(true);
    expect(r.manque).toBe(0);
  });

  it('peu de pages hors FranceConnect : FranceConnect complète jusqu\'à la cible', () => {
    const r = selectionnerSocleAffiche(candidats(90, 10) as never);
    expect(r.retenues).toHaveLength(100);
    expect(r.retenuesFranceConnect).toBe(90);
  });

  it('corpus insuffisant : pas de complément, le manque est dit', () => {
    const r = selectionnerSocleAffiche(candidats(12, 5) as never);
    expect(r.retenues).toHaveLength(17);
    expect(r.manque).toBe(83);
    expect(r.minFranceConnectAtteint).toBe(false);
    expect(r.disponiblesFranceConnect).toBe(12);
  });
});
