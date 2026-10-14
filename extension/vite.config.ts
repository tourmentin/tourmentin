// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Livrable 1 du lot L3. `vite build --mode chrome` / `--mode firefox`
// produisent chacun leur sortie (dist/chrome-essai, dist/firefox-essai ; -mesure pour le harnais) : crx() lit
// `manifest.config.ts`, qui bifurque déjà sur `env.mode`.
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest, { infoBuild } from './manifest.config.js';

/**
 * crx() régénère lui-même manifest.background pour Firefox — { scripts,
 * type: 'module' } — et écrase donc `persistent: false` porté par
 * manifest.config.ts (vérifié en lisant node_modules/@crxjs/vite-plugin :
 * son propre hook renderCrxManifest réécrit ce champ sans condition). Cette
 * étape post-traite le manifeste déjà rendu pour le restaurer ; `enforce:
 * 'post'` et la position après crx() dans le tableau des plugins garantissent
 * qu'elle s'exécute après lui.
 */
function corrigerPersistanceFirefox(browser: 'chrome' | 'firefox'): Plugin {
  return {
    name: 'tourmentin:firefox-persistent-false',
    enforce: 'post',
    renderCrxManifest(manifestRendu: { background?: Record<string, unknown> }) {
      if (browser === 'firefox' && manifestRendu.background && 'scripts' in manifestRendu.background) {
        manifestRendu.background.persistent = false;
      }
      return manifestRendu;
    },
  } as Plugin;
}

/**
 * 14.33 B et C : adresse des listes signées et clé publique, fixées à la construction. Refus net d'une
 * configuration dangereuse : une adresse non https, ou une clé mal formée, n'atteint jamais un build.
 * Le build d'essai de bout en bout (clé jetable, serveur local en http://127.0.0.1) sort dans
 * dist/chrome-publication-test, jamais dans le dossier remis (dist/chrome-essai).
 */
function configPublication(mesure: boolean): { define: Record<string, string>; essaiLocal: boolean } {
  // 14.37 point 1 : adresse et clé publique du dépôt (publication.config.json, rien de secret), remplacées par les
  // variables d'environnement. Le build de mesure ne télécharge rien : le harnais reste hermétique.
  const parDefaut = mesure ? { url: '', cle: '' } : (JSON.parse(readFileSync(new URL('./publication.config.json', import.meta.url), 'utf8')) as { url: string; cle: string });
  const url = process.env.TOURMENTIN_URL_PUBLICATION ?? parDefaut.url;
  const cle = process.env.TOURMENTIN_CLE_PUBLIQUE_LISTES ?? parDefaut.cle;
  const essaiLocal = process.env.TOURMENTIN_PUBLICATION_ESSAI_LOCAL === '1';
  if (url !== '') {
    if (!url.endsWith('/')) throw new Error('TOURMENTIN_URL_PUBLICATION doit se terminer par « / »');
    const local = /^http:\/\/127\.0\.0\.1:\d{2,5}\/$/.test(url);
    if (!url.startsWith('https://') && !(essaiLocal && local)) throw new Error("TOURMENTIN_URL_PUBLICATION doit être en https (http://127.0.0.1 seulement pour le build d'essai local)");
  }
  if (cle !== '' && !/^[0-9a-f]{64}$/.test(cle)) throw new Error('TOURMENTIN_CLE_PUBLIQUE_LISTES doit faire 64 caractères hexadécimaux');
  if (essaiLocal && (url === '' || cle === '')) throw new Error("le build d'essai local exige une adresse et une clé");
  const define: Record<string, string> = {};
  if (url !== '') define.__URL_PUBLICATION__ = JSON.stringify(url);
  if (cle !== '') define.__CLE_PUBLIQUE_LISTES__ = JSON.stringify(cle);
  if (essaiLocal) define.__PUBLICATION_ESSAI_LOCAL__ = 'true';
  return { define, essaiLocal };
}

export default defineConfig(({ mode }) => {
  // Browser (type de crx()) n'est pas exporté par @crxjs/vite-plugin au 12/09/2026.
  const browser: 'chrome' | 'firefox' = mode === 'firefox' ? 'firefox' : 'chrome';
  const mesure = process.env.TOURMENTIN_N3 === '1';
  const publication = configPublication(mesure);
  if (publication.essaiLocal && mesure) throw new Error("build d'essai local et build de mesure sont exclusifs");

  return {
    // 14.5 : drapeau du plafond N2 de la version d'essai (src/version-essai.ts).
    // Éteint par défaut ; `npm run build:mesure` le rallume pour le harnais.
    define: { __N3_PAR_SCORE_ACTIF__: JSON.stringify(mesure), __BUILD_ID__: JSON.stringify(infoBuild().versionName), ...publication.define },
    build: {
      // 14.15 point 1 : deux dossiers de sortie distincts. Une propriété de
      // sûreté (« un testeur ne reçoit jamais un N3 actif ») ne doit pas
      // dépendre d'une étape qu'on se rappelle : seul dist/*-essai est remis.
      outDir: `dist/${browser}-${publication.essaiLocal ? 'publication-test' : mesure ? 'mesure' : 'essai'}`,
      emptyOutDir: true,
    },
    plugins: [crx({ manifest, browser }), corrigerPersistanceFirefox(browser)],
  };
});
