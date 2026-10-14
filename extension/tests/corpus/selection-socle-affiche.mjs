// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.3 : repérage du segment `socle-affiche` — pages officielles qui
// affichent légitimement une marque du socle sur un domaine qui n'en fait pas
// partie, avec un formulaire. Le cas dominant est le bouton « S'identifier avec
// FranceConnect ». Aucun crawl dédié : on exploite l'axe d'imitation du moteur,
// déjà évalué sur les pages visitées pour le sous-corpus des connexions, et on
// retient celles où un marqueur fort d'une empreinte apparaît hors de ses
// domaines. Fonction pure, testée sans navigateur.

export const CIBLE_SOCLE_AFFICHE = 100;
export const MIN_FRANCECONNECT = 50;

/** Page candidate issue d'une entrée du jsonl, pour une source (accueil ou connexion) ; null sinon. */
function candidatDe(entree, source, imitation) {
  if (!imitation || !imitation.aFormulaire) return null;
  const marques = (imitation.marqueurs ?? []).filter((m) => m.horsDomaines && m.termesForts.length > 0);
  if (marques.length === 0) return null;
  return {
    hote: entree.hote,
    domaine: entree.domaine,
    segmentOrigine: entree.segmentOrigine,
    libelle: entree.libelle,
    source,
    url: imitation.url,
    etape: imitation.etape ?? null,
    marques: marques.map((m) => ({ marque: m.marque, termesForts: m.termesForts })),
    marqueDetectee: imitation.marqueDetectee ?? null,
    scoreImitation: imitation.scoreImitation,
    signaux: imitation.signaux,
    avecFranceConnect: marques.some((m) => m.marque === 'franceconnect'),
  };
}

// Préférence entre deux pages du même hôte : une vraie page de connexion (étape
// connue) d'abord, puis le score d'imitation.
const meilleure = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  if (Boolean(a.etape) !== Boolean(b.etape)) return a.etape ? a : b;
  return b.scoreImitation > a.scoreImitation ? b : a;
};

/** Une candidate au plus par hôte, la meilleure de l'accueil et de la page de connexion. */
export function trouverCandidats(entrees) {
  const candidats = [];
  for (const e of entrees) {
    const c = meilleure(candidatDe(e, 'accueil', e.imitationAccueil), candidatDe(e, 'connexion', e.imitationConnexion));
    if (c) candidats.push(c);
  }
  return candidats;
}

/**
 * Sélectionne au plus `cible` pages, dont au moins `minFranceConnect` avec
 * FranceConnect quand le corpus en contient assez. Ne complète jamais avec des
 * pages qui ne sont pas des candidates : si le corpus n'en contient pas assez,
 * le résultat est plus court et `manque` le dit.
 */
export function selectionnerSocleAffiche(candidats, { cible = CIBLE_SOCLE_AFFICHE, minFranceConnect = MIN_FRANCECONNECT } = {}) {
  const parScore = (a, b) => b.scoreImitation - a.scoreImitation || a.hote.localeCompare(b.hote);
  const fc = candidats.filter((c) => c.avecFranceConnect).sort(parScore);
  const autres = candidats.filter((c) => !c.avecFranceConnect).sort(parScore);
  const nbFc = Math.min(fc.length, Math.max(minFranceConnect, cible - autres.length));
  const retenues = [...fc.slice(0, nbFc), ...autres.slice(0, Math.max(0, cible - nbFc))];
  return {
    retenues,
    disponibles: candidats.length,
    disponiblesFranceConnect: fc.length,
    retenuesFranceConnect: nbFc,
    manque: Math.max(0, cible - retenues.length),
    minFranceConnectAtteint: nbFc >= minFranceConnect,
  };
}
