// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 12.3.3.19, point 5 : le candidat A se déclenche-t-il sur l'écran
// identifiant réel de MAIF (connect.maif.fr/connect/oic/login) ? Consultation
// seule : aucune saisie, aucune soumission. Réutilise le bundle du candidat
// tel que mesuré en 12.3.3.18 (même code, pas de reformulation) et ne remonte
// que des faits structurels, jamais de texte de page ni de valeur de champ.
//
// À exécuter depuis extension/ : node tests/corpus/diagnostiquer-candidat-a-maif.mjs
// (le bundle est produit par mesurer-cout-exposition-identifiant.mjs)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lancerContexteNavigateur } from './navigateur-sans-extension.mjs';
import { FENETRE_FP_MS } from './fenetre-analyse.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const URL_CIBLE = 'https://connect.maif.fr/connect/oic/login';
const bundle = readFileSync(join(ICI, '.cache', 'cout-exposition-identifiant', 'cout-exposition.js'), 'utf8');

const context = await lancerContexteNavigateur({ fenetre: false });
const page = await context.newPage();
try {
  const reponse = await page.goto(URL_CIBLE, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(FENETRE_FP_MS);
  await page.evaluate(bundle);
  const candidats = await page.evaluate(() => globalThis.__tourmentinCoutExposition());
  const faits = await page.evaluate(() => ({
    urlFinale: location.origin + location.pathname,
    titreLongueur: document.title.length,
    formulaires: [...document.forms].length,
    champs: [...document.querySelectorAll('input,select,textarea')].map((e) => ({
      balise: e.tagName.toLowerCase(),
      type: e.getAttribute('type'),
      autocomplete: e.getAttribute('autocomplete'),
      dansFormulaire: !!e.form,
      visible: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length),
    })),
    titreEvoqueConnexion: /connexion|se connecter|mon compte|espace client|identifiez|espace personnel|login|sign in|connecter|identification|authentification/i.test(document.title + ' ' + location.pathname),
  }));
  console.log(JSON.stringify({ statut: reponse?.status(), candidats, faits }, null, 2));
} finally {
  await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
}
process.exit(0);
