// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.5, point 1 — diagnostic, pas une correction. Ni Z5 ("aucun champ
// de saisie ET aucun formulaire") ni E1 ("input[type=password] visible") ne
// mentionnent la balise <form> au chapitre 5 ; 12.3.3.4 affirmait à tort que
// "c'est aussi ce que voit Z5". Ce test rejoue le pipeline réel
// (construireEntreeAnalyse -> analyser), SANS toucher au moteur ni à
// l'adaptateur, sur une page qui porte les marqueurs d'imitation d'impots-gouv
// et un champ mot de passe visible hors de toute balise <form>.
//
// Attendu par la spec : Z5 ne s'applique pas (un champ existe), E1 se déclenche,
// une alerte est possible. Si ce test échoue, il faut dire PRÉCISÉMENT où :
// l'adaptateur ne collecte pas le champ (EntreeAnalyse.formulaires vide),
// Z5 s'applique quand même (le verdict rend N0 "aucun champ..." malgré le
// champ), ou E1 ne le compte pas (E = 0 malgré un champ password visible).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { construireEntreeAnalyse } from '../src/adaptateurs/dom.js';
import { evaluerE1, evaluerE2 } from '../src/moteur/signaux-exposition.js';
import { evaluerAxeImitation } from '../src/moteur/signaux-imitation.js';
import { analyser } from '../src/moteur/analyser.js';
import { configParDefaut, construireListes } from '../src/listes/chargement.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const DOSSIER_PAGES = join(ICI, 'pages', 'diagnostic');

function chargerEntree(fichier: string, url: string) {
  const html = readFileSync(join(DOSSIER_PAGES, fichier), 'utf8');
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  return construireEntreeAnalyse(dom.window.document);
}

describe('12.3.3.5 point 1 : champ mot de passe visible hors de toute balise <form>', () => {
  it('diagnostic — localise précisément où la spec et le code divergent', () => {
    const entree = chargerEntree('champ-hors-formulaire-impots-gouv.html', 'https://impots-gouv-hors-form.fr/connexion');
    const listes = construireListes();
    const config = configParDefaut();

    // Étape 1 : l'adaptateur a-t-il seulement VU le champ ?
    const champsCollectes = entree.formulaires.flatMap((f) => f.champs);
    const champPasswordCollecte = champsCollectes.some((c) => c.type === 'password' && c.visible);
    console.log(
      `[diagnostic] EntreeAnalyse.formulaires : ${entree.formulaires.length} formulaire(s), ` +
        `${champsCollectes.length} champ(s) au total. Champ password visible collecté : ${champPasswordCollecte}.`,
    );

    // Étape 2 : E1, évalué directement, indépendamment de Z5.
    const e1 = evaluerE1(entree);
    console.log(`[diagnostic] evaluerE1() : ${e1 ? `déclenché (${JSON.stringify(e1)})` : 'null (non déclenché)'}.`);

    // Étape 3 : le verdict complet du pipeline réel.
    const verdict = analyser(entree, listes, config);
    console.log(`[diagnostic] analyser() : niveau ${verdict.niveau}, motif "${verdict.motif}".`);

    if (!champPasswordCollecte) {
      console.log("[diagnostic] CONCLUSION : l'adaptateur ne collecte pas le champ (construireEntreeAnalyse ne visite que <form>).");
    } else if (verdict.motif === 'aucun champ de saisie ni formulaire') {
      console.log('[diagnostic] CONCLUSION : le champ est collecté mais Z5 (pageAAuMoinsUnChamp) ne le voit pas.');
    } else if (!e1) {
      console.log('[diagnostic] CONCLUSION : le champ est collecté, Z5 ne bloque pas, mais E1 ne le compte pas.');
    } else {
      console.log('[diagnostic] CONCLUSION : conforme à la spec — Z5 ne s\'applique pas, E1 se déclenche.');
    }

    // Assertions de la spec (12.3.3.5) : attendues, pas nécessairement vraies
    // aujourd'hui — c'est le diagnostic demandé, pas une correction silencieuse.
    expect(champPasswordCollecte, "l'adaptateur doit collecter un champ password hors <form>").toBe(true);
    expect(verdict.motif, 'Z5 ne doit pas s\'appliquer : un champ de saisie existe').not.toBe('aucun champ de saisie ni formulaire');
    expect(e1, 'E1 doit se déclencher sur un champ password visible, dans ou hors <form>').not.toBeNull();
    expect(verdict.niveau, 'une alerte doit rester possible (N0 non systématique)').not.toBe('N0');
  });
});

describe("12.3.3.6 : la vraie mire d'ameli — identifiant seul, sans mot de passe, hors <form>", () => {
  it('diagnostic — E2 voit-il un champ hors formulaire ?', () => {
    const entree = chargerEntree('champ-hors-formulaire-ameli-identifiant-seul.html', 'https://ameli-hors-form.fr/connexion');
    const listes = construireListes();
    const config = configParDefaut();

    const champsCollectes = entree.formulaires.flatMap((f) => f.champs);
    console.log(`[diagnostic ameli] EntreeAnalyse.formulaires : ${entree.formulaires.length} formulaire(s), ${champsCollectes.length} champ(s).`);

    // Pas de password sur cette page (la vraie mire n'en a pas à ce premier
    // écran) : E1 ne peut structurellement rien voir ici, ce n'est pas le
    // point testé.
    const e1 = evaluerE1(entree);
    console.log(`[diagnostic ameli] evaluerE1() : ${e1 ? 'déclenché' : 'null (attendu : aucun champ password sur cette page)'}.`);

    const axe = evaluerAxeImitation(entree, listes.socle, config);
    const marqueDetectee = listes.socle.find((m) => m.id === axe.marqueDetectee);
    console.log(`[diagnostic ameli] evaluerAxeImitation() : score ${axe.score}, marque détectée ${axe.marqueDetectee ?? '—'}.`);

    const e2 = evaluerE2(entree, marqueDetectee);
    console.log(`[diagnostic ameli] evaluerE2() : ${e2 ? `déclenché (${JSON.stringify(e2)})` : 'null (non déclenché)'}.`);

    const verdict = analyser(entree, listes, config);
    console.log(`[diagnostic ameli] analyser() : niveau ${verdict.niveau}, motif "${verdict.motif}".`);

    // Attendu par la spec (5.3, 5.4) : les marqueurs d'ameli doivent être
    // détectés indépendamment de la structure du formulaire (axe I, texte de
    // page) ; le champ « numéro de sécurité sociale » doit être collecté et
    // reconnu par E2, même hors <form> — sur la vraie page, c'est le seul
    // signal d'exposition disponible à ce premier écran.
    expect(axe.marqueDetectee, "l'axe d'imitation doit détecter ameli au texte de la page, indépendamment du DOM du formulaire").toBe('ameli');
    expect(champsCollectes.length, "l'adaptateur doit collecter le champ identifiant hors <form>").toBeGreaterThan(0);
    expect(e2, 'E2 doit reconnaître "numéro de sécurité sociale" comme terme de saisie de la marque détectée').not.toBeNull();
  });
});
