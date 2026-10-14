// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Un rejet non intercepté dans un gestionnaire interne de Playwright (par
// exemple une boîte de dialogue native gérée au moment même où sa page se
// fermait) a déjà fait tomber une passe de plusieurs heures avec 489 hôtes
// restants. Chaque tâche est déjà isolée par pool-concurrent.mjs
// (try/catch par hôte) ; ce filet ne couvre que ce qui échappe à cette
// isolation — un événement Playwright émis en dehors de tout await que ce
// dépôt contrôle. Ne consigne et ne continue QUE unhandledRejection : une
// uncaughtException synchrone reste fatale, parce qu'elle peut signaler un
// bug réel du script plutôt qu'un aléa de page.
export function armerFiletDeSecurite() {
  process.on('unhandledRejection', (erreur) => {
    console.error('  rejet non intercepté (ignoré, la passe continue) :', erreur?.message ?? erreur);
  });
}
