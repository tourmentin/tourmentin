// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Livrable 2 du lot L3. Base commune aux deux navigateurs, puis divergence
// minimale là où Manifest V3 l'exige réellement (4.2, 4.3).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineManifest } from '@crxjs/vite-plugin';

/** 14.19 E (appliqué le 07/10/2026) : numéro du palier d'essai, incrémenté À LA MAIN quand le périmètre remis change. */
const PALIER = 1;

const RACINE_DEPOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function git(...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: RACINE_DEPOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/**
 * 14.19 E : `version` = 0.P.N (P = palier, N = nombre de commits qui touchent extension/, calculé à la construction :
 * monotone, reproductible, aucun fichier à incrémenter). `version_name` = « essai P · spec X.YY · <hash court> », suivi de
 * « · mesure » pour le build de mesure et de « · modifié » si l'arbre de travail n'est pas commité : un build non commité ne
 * peut pas se faire passer pour un commit.
 */
export function infoBuild(): { version: string; versionName: string } {
  const n = Number(git('rev-list', '--count', 'HEAD', '--', 'extension')) || 0;
  const hash = git('rev-parse', '--short', 'HEAD') || 'sans-git';
  const modifie = git('status', '--porcelain', '--', 'extension', 'docs') !== '';
  const mesure = process.env.TOURMENTIN_N3 === '1';
  let spec = '?';
  try {
    spec = /^> Version (\d+\.\d+)/m.exec(readFileSync(new URL('../docs/SPEC.md', import.meta.url), 'utf8'))?.[1] ?? '?';
  } catch {
    // spec absente (extraction hors dépôt) : « ? »
  }
  return { version: `0.${PALIER}.${n}`, versionName: `essai ${PALIER} · spec ${spec} · ${hash}${mesure ? ' · mesure' : ''}${modifie ? ' · modifié' : ''}` };
}

export default defineManifest((env) => {
  const firefox = env.mode === 'firefox';

  const { version, versionName } = infoBuild();

  // `any` assumé : match_origin_as_fallback (content_scripts) est un ajout
  // récent à Manifest V3, absent du typage de @crxjs/vite-plugin au
  // 12/09/2026. defineManifest accepte cette forme au runtime (c'est un objet
  // JSON ordinaire) ; seul le typage strict de ce fichier est affaibli.
  // chrome.dom.openOrClosedShadowRoot (6.5) n'exige AUCUNE permission : la
  // permission « dom » que ce manifeste déclarait n'existe pas (retirée le 07/10/2026).
  const manifest: any = {
    manifest_version: 3,
    name: 'Tourmentin',
    description:
      "Repère les imitations de sites officiels français. Vos mots de passe et vos saisies ne quittent jamais votre appareil.",
    version,
    version_name: versionName,
    // 14.26 étape 3 : la signature Ed25519 par WebCrypto (clé d'installation non exportable) exige Chrome 137.
    ...(firefox ? {} : { minimum_chrome_version: '137' }),
    permissions: ['storage', 'scripting', 'webNavigation', 'alarms'],
    host_permissions: ['<all_urls>'],
    // 14.6 : popup (b, d), page d'options (c). Pas d'icône dédiée par niveau
    // (14.2.2, manque non résolu) : le badge de l'action en tient lieu
    // (service-worker.ts, appliquerBadge).
    action: { default_popup: 'src/popup/popup.html', default_title: 'Tourmentin' },
    options_ui: { page: 'src/options/options.html', open_in_tab: true },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['src/contenu/index.ts'],
        all_frames: true,
        run_at: 'document_start',
        match_origin_as_fallback: true,
      },
    ],
    // Le point d'entrée de l'arrière-plan s'appelle `service-worker.ts`, pas
    // `index.ts` : un bug de @crxjs/vite-plugin 2.7.1 (Vite 8) confond les
    // chunks de sortie quand deux entrées portent le même nom de fichier dans
    // des dossiers différents — `service-worker-loader.js` importait alors le
    // code du content script, qui plante immédiatement en arrière-plan
    // (`document` n'existe pas dans un service worker), sans qu'aucune
    // erreur ne remonte. Trouvé au lot L5 en constatant que l'arrière-plan ne
    // recevait jamais aucun message. Un nom d'entrée distinct contourne le bug.
    background: firefox
      ? { scripts: ['src/arriere-plan/service-worker.ts'], persistent: false }
      : { service_worker: 'src/arriere-plan/service-worker.ts', type: 'module' },
  };

  if (firefox) {
    // 14.48 : Manifest V3 pour Firefox (scripts d'arrière-plan, pas de service worker : géré par crxjs + vite.config.ts).
    //  - version minimale 142 (140 pour la déclaration des données ; 142 pour Firefox pour Android) : Ed25519 de WebCrypto (signatures 14.26 et 14.33) et déclaration des données collectées ;
    //  - « none » (4.2, 14.30 point 5) était FAUX dès que l'envoi existe : l'extension PEUT envoyer, après confirmation de l'utilisateur,
    //    l'adresse sans partie variable et le texte visible avec les adresses d'images (obligatoires, consentement à l'installation), la clé publique
    //    de l'installation et ses déclarations (« technicalAndInteraction » n'existe qu'en facultatif dans le schéma de Mozilla) ;
    //  - mises à jour automatiques par un fichier statique servi sur tourmentin.fr (signature Mozilla en canal non listé).
    manifest.browser_specific_settings = {
      gecko: {
        id: 'tourmentin@tourmentin.fr',
        strict_min_version: '142.0',
        update_url: 'https://tourmentin.fr/installer/updates.json',
        data_collection_permissions: { required: ['browsingActivity', 'websiteContent'], optional: ['technicalAndInteraction'] },
      },
    };
  }

  return manifest;
});
