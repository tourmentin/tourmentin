// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.57 : entrée de la mesure « mémoire d'imitation » et « bandeau étendu aux pages d'identifiant ». Adaptateur et moteur de production, rien de réinventé.
import { construireEntreeAnalyse } from '../../src/adaptateurs/dom.js';
import { analyser } from '../../src/moteur/analyser.js';
import { aChampIdentifiantConnexion, estChampIdentifiantConnexion, imitationARetenir } from '../../src/moteur/memoire-imitation.js';
import { construireListes, configParDefaut } from '../../src/listes/chargement.js';
import type { ChampFormulaire, EntreeAnalyse } from '../../src/moteur/types.js';

const listes = construireListes();
const config = configParDefaut();

const visible = (el: HTMLElement): boolean => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const SOUMISSION = 'button:not([type=button]):not([type=reset]), input[type=submit], input[type=image]';

/** Un champ d'identifiant de connexion visible dont le formulaire (ou, hors formulaire, le conteneur proche) porte un bouton d'envoi visible. */
function identifiantAvecBouton(): boolean {
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('input'))) {
    if (!visible(el)) continue;
    const etiquette = el.labels?.[0]?.textContent ?? el.getAttribute('aria-label') ?? '';
    const champ: ChampFormulaire = { type: el.type || 'text', nom: el.name || el.id, libelle: etiquette, placeholder: el.placeholder, autocomplete: el.autocomplete, visible: true };
    if (!estChampIdentifiantConnexion(champ)) continue;
    const portee: ParentNode | null = el.form ?? el.parentElement?.parentElement?.parentElement ?? null;
    const boutons = portee ? Array.from(portee.querySelectorAll<HTMLElement>(SOUMISSION)) : [];
    if (boutons.some(visible)) return true;
  }
  return false;
}

(globalThis as unknown as Record<string, unknown>)['__tourmentinDeuxEtapes'] = () => {
  const entree = construireEntreeAnalyse(document);
  const verdict = analyser(entree, listes, config);
  const signauxE = verdict.signauxExposition ?? [];
  const aMdp = signauxE.some((s) => s.code === 'E1');
  const paiement = signauxE.some((s) => s.famille === 'paiement');
  const aIdentifiant = aChampIdentifiantConnexion(entree);
  const retenue = imitationARetenir(entree, verdict, listes);
  let simulation: { sans: string; avec: string } | null = null;
  if (retenue) {
    // Écran 2 hypothétique du même hôte : page dépouillée avec un seul champ mot de passe.
    const ecran2: EntreeAnalyse = {
      ...entree,
      titre: '',
      texteVisible: '',
      liens: [],
      formulaires: [{ champs: [{ type: 'password', visible: true }], dansIframeCrossOrigin: false }],
      ressources: { logosHash: [], couleursDominantes: [] },
    };
    simulation = { sans: analyser(ecran2, listes, config).niveau, avec: analyser(ecran2, listes, config, { imitationRetenue: retenue }).niveau };
  }
  return {
    niveau: verdict.niveau,
    motif: verdict.motif,
    scoreImitation: verdict.scoreImitation ?? 0,
    scoreExposition: verdict.scoreExposition ?? null,
    marque: verdict.marqueDetectee ?? null,
    aMdp,
    paiement,
    aIdentifiant,
    aBouton: aIdentifiant ? identifiantAvecBouton() : false,
    retenue: retenue ? { marque: retenue.marque, scoreImitation: retenue.scoreImitation } : null,
    simulation,
  };
};
