// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.3 : diagnostic des mires que le script de constitution ne voyait
// pas (ameli, ANTS, France Travail), avec la détection de l'EXTENSION et non
// celle du script — l'adaptateur DOM (src/adaptateurs/dom.ts), injecté tel
// quel, avec la même attente que le harnais (1,5 s après domcontentloaded),
// puis à 10 s pour distinguer « lu trop tôt » de « jamais visible ».
//
// Deux issues, à ne pas confondre :
//   a) l'adaptateur voit le formulaire, le script ne le voyait pas : défaut du
//      script, à corriger côté script ;
//   b) l'adaptateur ne le voit pas non plus : angle mort du PRODUIT — ne rien
//      corriger, décrire la structure de la page.
//
// Un recensement indépendant du DOM réel (protocole CDP, qui traverse aussi les
// racines d'ombre fermées et les iframes) donne la structure : formulaires,
// champs dans/hors <form>, shadow DOM, iframes. Aucune valeur de champ n'est
// lue, aucune saisie, aucune soumission : on regarde le DOM, rien d'autre.
//
// À exécuter depuis extension/ : npm run diagnostiquer-connexion
// Écrit extension/tests/corpus/diagnostic-connexion.json (non versionné).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lancerContexteNavigateur } from './navigateur-sans-extension.mjs';
import { trouverLiensConnexion } from './trouver-connexion.mjs';
import { construireBundleAdaptateur } from './bundle-adaptateur.mjs';
import { FENETRE_FP_MS } from './fenetre-analyse.mjs';
import { armerFiletDeSecurite } from './filet-de-securite.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const DOSSIER_SOCLE = join(ICI, '..', '..', '..', 'listes', 'socle');
const SORTIE = join(ICI, 'diagnostic-connexion.json');
const TIMEOUT_NAVIGATION_MS = 15_000;
const ATTENTE_LONGUE_MS = 10_000;
const MAX_CANDIDATS = 4;

// Marques à diagnostiquer, plus deux témoins dont la mire est trouvée : si
// l'adaptateur ne voit pas leur formulaire, c'est l'outil qui est en cause.
const MARQUES = ['ameli', 'ants', 'france-travail'];
const TEMOINS = ['impots-gouv', 'service-public'];

const arguments_ = process.argv.slice(2);
const FENETRE = arguments_.includes('--fenetre');

/** Recensement CDP : ce que le DOM contient réellement, racines fermées et iframes comprises. */
async function recenserCdp(context, page) {
  const cdp = await context.newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const r = {
    formulaires: 0,
    champs: 0,
    champsDansForm: 0,
    champsHorsForm: 0,
    motsDePasse: 0,
    motsDePasseDansForm: 0,
    motsDePasseHorsForm: 0,
    champsDansOmbreOuverte: 0,
    champsDansOmbreFermee: 0,
    champsDansIframe: 0,
    iframes: [],
    champsDetail: [],
  };
  const attributs = (n) => {
    const a = n.attributes ?? [];
    const o = {};
    for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1];
    return o;
  };
  function parcourir(n, ctx) {
    const nom = (n.nodeName ?? '').toLowerCase();
    let suite = ctx;
    if (nom === 'form') {
      r.formulaires++;
      suite = { ...ctx, dansForm: true };
    }
    if (nom === 'iframe' || nom === 'frame') {
      const a = attributs(n);
      r.iframes.push({ src: a.src ?? '', sandbox: a.sandbox !== undefined, titre: a.title ?? '' });
    }
    if (nom === 'input' || nom === 'textarea' || nom === 'select') {
      const a = attributs(n);
      const type = nom === 'input' ? (a.type ?? 'text').toLowerCase() : nom;
      if (type !== 'hidden') {
        r.champs++;
        if (ctx.dansForm) r.champsDansForm++;
        else r.champsHorsForm++;
        if (ctx.ombre === 'open') r.champsDansOmbreOuverte++;
        if (ctx.ombre === 'closed') r.champsDansOmbreFermee++;
        if (ctx.dansIframe) r.champsDansIframe++;
        if (type === 'password') {
          r.motsDePasse++;
          if (ctx.dansForm) r.motsDePasseDansForm++;
          else r.motsDePasseHorsForm++;
        }
        r.champsDetail.push({
          type,
          autocomplete: a.autocomplete ?? null,
          nom: a.name ?? null,
          id: a.id ?? null,
          dansForm: !!ctx.dansForm,
          ombre: ctx.ombre ?? null,
          dansIframe: !!ctx.dansIframe,
        });
      }
    }
    for (const c of n.children ?? []) parcourir(c, suite);
    for (const sr of n.shadowRoots ?? []) {
      if (sr.shadowRootType === 'user-agent') continue;
      parcourir(sr, { ...suite, ombre: sr.shadowRootType });
    }
    if (n.contentDocument) parcourir(n.contentDocument, { ...suite, dansIframe: true });
  }
  parcourir(root, {});
  await cdp.detach();
  return r;
}

/** Ce que l'adaptateur de l'extension voit, frame par frame. Jamais de valeur de champ. */
async function lireAdaptateur(page, bundle) {
  const frames = [];
  for (const frame of page.frames()) {
    try {
      await frame.evaluate(bundle);
      const resume = await frame.evaluate(() => {
        const e = globalThis.__tourmentinEntree();
        return {
          nbFormulaires: e.formulaires.length,
          formulaires: e.formulaires.map((f) => ({
            nbChamps: f.champs.length,
            types: f.champs.map((c) => c.type),
            autocompletes: f.champs.map((c) => c.autocomplete ?? null),
            visibles: f.champs.filter((c) => c.visible).length,
          })),
          nbLiens: e.liens.length,
          texteVisibleLongueur: e.texteVisible.length,
        };
      });
      frames.push({ url: frame.url(), principale: frame === page.mainFrame(), ...resume });
    } catch (erreur) {
      frames.push({ url: frame.url(), principale: frame === page.mainFrame(), erreur: String(erreur?.message ?? erreur).split('\n')[0] });
    }
  }
  // Z5 (analyser.ts) : la page a « au moins un champ » si un formulaire porte au moins un champ.
  const voitUnChamp = frames.some((f) => (f.formulaires ?? []).some((x) => x.nbChamps > 0));
  return { voitUnChamp, frames };
}

async function examinerUrl(context, bundle, url) {
  const page = await context.newPage();
    page.on('dialog', (dialog) => { dialog.dismiss().catch(() => {}); });
  const resultat = { url };
  try {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
    } catch (erreur) {
      return { ...resultat, issue: 'non-joignable', motif: String(erreur?.message ?? erreur).split('\n')[0] };
    }
    await page.waitForTimeout(FENETRE_FP_MS);
    resultat.urlApresAttenteHarnais = page.url();
    resultat.titre = await page.title().catch(() => '');
    resultat.adaptateurA1500ms = await lireAdaptateur(page, bundle);
    await page.waitForTimeout(ATTENTE_LONGUE_MS - FENETRE_FP_MS);
    resultat.urlFinale = page.url();
    resultat.adaptateurA10s = await lireAdaptateur(page, bundle);
    resultat.recensementCdp = await recenserCdp(context, page);
    return resultat;
  } catch (erreur) {
    return { ...resultat, issue: 'erreur', motif: String(erreur?.message ?? erreur).split('\n')[0] };
  } finally {
    await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
  }
}

async function main() {
  armerFiletDeSecurite();
  console.log("Construction du bundle de l'adaptateur DOM de l'extension...");
  const bundle = await construireBundleAdaptateur();
  const empreintes = readdirSync(DOSSIER_SOCLE)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(DOSSIER_SOCLE, f), 'utf8')));
  const context = await lancerContexteNavigateur({ fenetre: FENETRE });
  const sortie = [];

  for (const id of [...MARQUES, ...TEMOINS]) {
    const empreinte = empreintes.find((e) => e.id === id);
    const domaine = empreinte.domaines_verifies?.[0] ?? empreinte.domaines[0];
    const accueil = `https://${domaine}/`;
    console.log(`\n== ${id}${TEMOINS.includes(id) ? ' (témoin)' : ''} : ${accueil}`);

    const pageAccueil = await context.newPage();
    pageAccueil.on('dialog', (dialog) => { dialog.dismiss().catch(() => {}); });
    let candidats = [];
    try {
      await pageAccueil.goto(accueil, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAVIGATION_MS });
      await pageAccueil.waitForTimeout(FENETRE_FP_MS);
      const liens = await trouverLiensConnexion(pageAccueil);
      const vus = new Set();
      for (const l of liens) {
        let abs;
        try {
          abs = new URL(l.href, pageAccueil.url()).href;
        } catch {
          continue;
        }
        if (vus.has(abs)) continue;
        vus.add(abs);
        candidats.push({ url: abs, libelle: (l.texte || l.title || l.ariaLabel || '').trim().replace(/\s+/g, ' ').slice(0, 80) });
      }
    } catch (erreur) {
      console.log(`  accueil non joignable : ${String(erreur?.message ?? erreur).split('\n')[0]}`);
    } finally {
      await Promise.race([pageAccueil.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
    }
    console.log(`  ${candidats.length} lien(s) candidat(s) ; examen des ${Math.min(candidats.length, MAX_CANDIDATS)} premiers.`);

    const examens = [];
    for (const c of candidats.slice(0, MAX_CANDIDATS)) {
      const e = await examinerUrl(context, bundle, c.url);
      examens.push({ ...c, ...e });
      const a15 = e.adaptateurA1500ms;
      const a10 = e.adaptateurA10s;
      const cdp = e.recensementCdp;
      console.log(
        `  - "${c.libelle}" ${c.url}\n` +
          `      adaptateur @1,5 s : ${a15 ? (a15.voitUnChamp ? 'VOIT un champ' : 'ne voit aucun champ') : e.issue}` +
          ` | @10 s : ${a10 ? (a10.voitUnChamp ? 'VOIT un champ' : 'ne voit aucun champ') : '—'}\n` +
          (cdp
            ? `      DOM réel : ${cdp.formulaires} <form>, ${cdp.champs} champ(s) (${cdp.champsDansForm} dans un form, ${cdp.champsHorsForm} hors form), ` +
              `${cdp.motsDePasse} password, ombre ouverte ${cdp.champsDansOmbreOuverte}, ombre fermée ${cdp.champsDansOmbreFermee}, dans iframe ${cdp.champsDansIframe}, ${cdp.iframes.length} iframe(s)`
            : ''),
      );
    }
    sortie.push({ id, temoin: TEMOINS.includes(id), accueil, candidats, examens });
  }

  writeFileSync(SORTIE, JSON.stringify(sortie, null, 2), 'utf8');
  console.log(`\nDétail écrit : ${SORTIE}`);
  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);
}

const ESTAPPELEDIRECTEMENT = fileURLToPath(import.meta.url) === process.argv[1];
if (ESTAPPELEDIRECTEMENT) {
  main()
    .catch((erreur) => {
      console.error(erreur);
      process.exitCode = 1;
    })
    .finally(() => process.exit());
}
