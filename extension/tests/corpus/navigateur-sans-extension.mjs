// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Contexte Chromium sans extension chargée, pour les scripts du sous-corpus
// des connexions (12.3.3) : ils ne capturent pas de verdict, ils cherchent
// une page. Même filtrage de ressources que le harnais (12.3.1) — inchangé,
// comme demandé — et même isolation page-par-hôte (12.3.1.1) via
// pool-concurrent.mjs, réutilisée par l'appelant.
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doitBloquerRessource } from './filtrage-ressources.mjs';
import { HOTES_REGIES_PUBLICITAIRES } from './regies-publicitaires.mjs';

export async function lancerContexteNavigateur({ fenetre = false } = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'tourmentin-connexions-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !fenetre,
    args: [
      '--mute-audio',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-features=Translate,MediaRouter,OptimizationHints,AcceptCHFrame',
    ],
  });

  await context.route('**/*', (route) => {
    const requete = route.request();
    let hote = '';
    try {
      hote = new URL(requete.url()).hostname;
    } catch {
      // URL non standard (data:, blob:...) : jamais une régie, on laisse passer.
    }
    if (doitBloquerRessource(hote, requete.resourceType(), HOTES_REGIES_PUBLICITAIRES)) {
      void route.abort();
    } else {
      void route.continue();
    }
  });

  return context;
}
