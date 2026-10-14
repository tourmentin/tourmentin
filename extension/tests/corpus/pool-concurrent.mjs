// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Pool de pages Playwright à concurrence bornée, une page neuve par tâche,
// fermée après usage (12.3.1.1) — c'est la garantie d'isolation qui a mis
// fin au couplage entre hôtes (une redirection différée de l'un percutant la
// navigation du suivant). Partagé par le harnais de faux positifs, la
// campagne de mesure de latence (12.3.1.3) et la construction du sous-corpus
// des connexions (12.3.3) : la même garantie partout, pas une
// réimplémentation par script.

export function formaterDuree(secondes) {
  if (!Number.isFinite(secondes)) return '?';
  const m = Math.floor(secondes / 60);
  const s = Math.round(secondes % 60);
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

export async function traiterEnParallele(
  context,
  taches,
  concurrence,
  traiterUne,
  { surProgression, progressionTousLes = 100, arreterQuand, ignorerTache } = {},
) {
  let curseur = 0;
  let termines = 0;
  const debutLot = performance.now();

  async function ouvrier() {
    while (curseur < taches.length) {
      if (arreterQuand?.()) return;
      const i = curseur++;
      // Tâche écartée avant toute ouverture de page (quota déjà atteint, 12.3.3.2).
      if (ignorerTache?.(taches[i])) {
        termines++;
        if (termines === taches.length) surProgression?.({ termines, restants: 0, ecouleS: (performance.now() - debutLot) / 1000, estimeeS: 0 });
        continue;
      }
      // Une page neuve par tâche, fermée après usage — la concurrence
      // plafonne le nombre de pages simultanées, jamais leur durée de vie.
      const page = await context.newPage();
      // Une boîte de dialogue native (alert/confirm/beforeunload) laissée à
      // la gestion par défaut de Playwright a fait planter tout le processus
      // (ProtocolError) le jour où elle s'est ouverte juste au moment de la
      // fermeture de la page — un gestionnaire explicite l'écarte
      // immédiatement, sans jamais laisser d'exception remonter.
      page.on('dialog', (dialog) => {
        dialog.dismiss().catch(() => {});
      });
      try {
        await traiterUne(page, taches[i]);
      } catch (erreur) {
        console.error(`  erreur inattendue sur la tâche ${i} :`, erreur?.message ?? erreur);
      } finally {
        // Fermeture bornée : une page figée ne doit pas suspendre l'ouvrier (ni la passe).
        await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
      }
      termines++;
      if (termines % progressionTousLes === 0 || termines === taches.length) {
        const ecouleS = (performance.now() - debutLot) / 1000;
        const restants = taches.length - termines;
        const estimeeS = termines > 0 ? (ecouleS / termines) * restants : NaN;
        surProgression?.({ termines, restants, ecouleS, estimeeS });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrence, taches.length) }, ouvrier));
}
