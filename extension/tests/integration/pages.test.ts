// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Livrable 6 du lot L3 : vérifie les verdicts sur 20 pages de test et mesure
// la latence (critère C4 : rapportée ici, jamais contrôlée — 14.15 point 4). Le pipeline exercé est
// exactement celui de l'extension — construireEntreeAnalyse() puis analyser()
// — mais rejoué dans jsdom plutôt que dans un vrai navigateur : le harnais
// Playwright avec l'extension chargée pour de vrai est le lot L5, pas celui-ci.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { construireEntreeAnalyse } from '../../src/adaptateurs/dom.js';
import { analyser } from '../../src/moteur/analyser.js';
import type { NiveauAlerte } from '../../src/moteur/types.js';
import { configParDefaut, construireListes } from '../../src/listes/chargement.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const DOSSIER_PAGES = join(ICI, '..', 'pages');

interface CasDeTest {
  fichier: string;
  url: string;
  attendu: 'legitime' | 'imitation';
}

// Neuf imitations construites pour réunir un terme fort et au moins trois
// termes faibles réels de l'empreinte visée : doivent produire une alerte.
const IMITATIONS_FORTES: CasDeTest[] = [
  { fichier: 'imitations/01-impots-gouv.html', url: 'https://impots-gouv.fr/connexion', attendu: 'imitation' },
  { fichier: 'imitations/02-ameli.html', url: 'https://ameli-secure.fr/connexion', attendu: 'imitation' },
  { fichier: 'imitations/03-caf.html', url: 'https://caf-prestations.fr/connexion', attendu: 'imitation' },
  { fichier: 'imitations/04-franceconnect.html', url: 'https://franceconnect-secure.fr/connexion', attendu: 'imitation' },
  { fichier: 'imitations/05-laposte-colis.html', url: 'https://laposte-colis-frais.fr/paiement', attendu: 'imitation' },
  { fichier: 'imitations/06-urssaf.html', url: 'https://urssaf-declaration.fr/connexion', attendu: 'imitation' },
  { fichier: 'imitations/07-ants-carte-grise.html', url: 'https://ants-carte-grise.fr/connexion', attendu: 'imitation' },
  { fichier: 'imitations/08-france-travail.html', url: 'https://francetravail-actualisation.fr/connexion', attendu: 'imitation' },
  { fichier: 'imitations/09-service-public.html', url: 'https://service-public-demarches.fr/connexion', attendu: 'imitation' },
];

// Cas 10, délibérément faible (un seul terme fort, domaine sans lien lexical) :
// sert à vérifier que le moteur ne bloque pas systématiquement, pas à
// atteindre un niveau précis. Voir le commentaire du fichier.
const IMITATION_FAIBLE: CasDeTest = {
  fichier: 'imitations/10-impots-faible.html',
  url: 'https://mon-espace-perso.fr/connexion',
  attendu: 'imitation',
};

const IMITATIONS: CasDeTest[] = [...IMITATIONS_FORTES, IMITATION_FAIBLE];

const LEGITIMES: CasDeTest[] = [
  { fichier: 'legitimes/01-mairie-contact.html', url: 'https://mairie-sainte-colombe.fr/contact', attendu: 'legitime' },
  { fichier: 'legitimes/02-webmail-associatif.html', url: 'https://amisduvieuxmoulin.fr/webmail', attendu: 'legitime' },
  { fichier: 'legitimes/03-boutique-en-ligne.html', url: 'https://atelier-bois-cie.fr/mon-compte', attendu: 'legitime' },
  { fichier: 'legitimes/04-newsletter.html', url: 'https://festival-trois-rivieres.fr/newsletter', attendu: 'legitime' },
  { fichier: 'legitimes/05-forum.html', url: 'https://forum-velo-ancien.fr/connexion', attendu: 'legitime' },
  { fichier: 'legitimes/06-restaurant-reservation.html', url: 'https://lepetitchene-restaurant.fr/reservation', attendu: 'legitime' },
  { fichier: 'legitimes/07-portail-etudiant.html', url: 'https://isv-etudiant.fr/connexion', attendu: 'legitime' },
  { fichier: 'legitimes/08-club-sportif.html', url: 'https://judo-montferrat.fr/adhesion', attendu: 'legitime' },
  { fichier: 'legitimes/09-saas-generique.html', url: 'https://nuagetexte.fr/connexion', attendu: 'legitime' },
  { fichier: 'legitimes/10-mediatheque.html', url: 'https://mediatheque-montferrat.fr/mon-compte', attendu: 'legitime' },
];

const TOUS_LES_CAS = [...IMITATIONS, ...LEGITIMES];

interface Resultat {
  fichier: string;
  attendu: string;
  niveau: NiveauAlerte;
  marque: string;
  motif: string;
  dureeMs: number;
}

function analyserPage(cas: CasDeTest, listes: ReturnType<typeof construireListes>, config: ReturnType<typeof configParDefaut>): Resultat {
  const html = readFileSync(join(DOSSIER_PAGES, cas.fichier), 'utf8');
  const document = new JSDOM(html, { url: cas.url }).window.document;

  const debut = performance.now();
  const entree = construireEntreeAnalyse(document);
  const verdict = analyser(entree, listes, config);
  const dureeMs = performance.now() - debut;

  return {
    fichier: cas.fichier,
    attendu: cas.attendu,
    niveau: verdict.niveau,
    marque: verdict.marqueDetectee ?? '—',
    motif: verdict.motif,
    dureeMs,
  };
}

describe('20 pages de test (lot L3, livrable 6) — verdicts et latence', () => {
  const listes = construireListes();
  const config = configParDefaut();
  const resultats = TOUS_LES_CAS.map((cas) => analyserPage(cas, listes, config));

  it('affiche le tableau des verdicts', () => {
    console.table(
      resultats.map((r) => ({
        page: r.fichier,
        attendu: r.attendu,
        niveau: r.niveau,
        marque: r.marque,
        'durée (ms)': r.dureeMs.toFixed(2),
      })),
    );
    expect(resultats).toHaveLength(20);
  });

  // 14.15 point 4 : ce test RAPPORTE la latence, il n'échoue plus dessus. Une
  // suite de non-régression qui échoue sur un seuil de latence selon la charge
  // de la machine applique 12.3.1 à l'envers (« une machine chargée invalide
  // toute mesure de latence ») et apprend à ignorer le rouge. C4 relève du
  // protocole de mesure dédié (harnais --mesure-latence, machine au repos),
  // pas de cette suite. On vérifie seulement que la mesure est exploitable.
  it('latence rapportée (C4 : mesuré par le harnais, pas ici)', () => {
    const durees = [...resultats.map((r) => r.dureeMs)].sort((a, b) => a - b);
    const indexP95 = Math.ceil(0.95 * durees.length) - 1;
    const p95 = durees[indexP95]!;
    console.log(`Latence p95 sur ${durees.length} pages : ${p95.toFixed(2)} ms (max : ${durees.at(-1)!.toFixed(2)} ms) — rapportée, non contrôlée`);
    expect(durees).toHaveLength(20);
    expect(durees.every((d) => Number.isFinite(d) && d >= 0)).toBe(true);
  });

  it.each(LEGITIMES)('légitime — $fichier → N0', (cas) => {
    const resultat = resultats.find((r) => r.fichier === cas.fichier)!;
    expect(resultat.niveau, `${cas.fichier} : ${resultat.niveau} — ${resultat.motif}`).toBe('N0');
  });

  it.each(IMITATIONS_FORTES)('imitation — $fichier → une alerte (pas N0)', (cas) => {
    const resultat = resultats.find((r) => r.fichier === cas.fichier)!;
    expect(resultat.niveau, `${cas.fichier} : ${resultat.niveau} — ${resultat.motif}`).not.toBe('N0');
  });

  it('imitation faible (cas 10) : sous le seuil avec les poids [H] actuels, pas un blocage systématique', () => {
    const resultat = resultats.find((r) => r.fichier === IMITATION_FAIBLE.fichier)!;
    expect(resultat.niveau).toBe('N0');
    expect(resultat.motif).toBe("sous les seuils d'alerte");
  });
});
