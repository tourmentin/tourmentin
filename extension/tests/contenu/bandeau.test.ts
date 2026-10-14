// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { adresseOfficielle, afficherBandeauN2, construireContenuBandeau, mutationsInternes, retirerBandeau } from '../../src/contenu/bandeau.js';
import type { EmpreinteMarque } from '../../src/moteur/types.js';

function marqueDe(partiel: Partial<EmpreinteMarque> = {}): EmpreinteMarque {
  return {
    id: 'impots-gouv',
    libelle: 'Impôts / DGFiP',
    domaines: ['impots.gouv.fr', 'cfspart.impots.gouv.fr'],
    domainePrincipal: 'impots.gouv.fr',
    termesForts: [],
    termesFaibles: [],
    termesSaisie: [],
    faviconHash: [],
    couleurs: [],
    racinesTypo: [],
    criticite: 3,
    ...partiel,
  };
}

function installerDocumentGlobal(): Document {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
  return dom.window.document;
}

describe('adresseOfficielle — 14.12 : domainePrincipal, mention des autres domaines seulement si distincts', () => {
  it('positif : une seule marque à domaine unique, pas de mention', () => {
    const marque = marqueDe({ domaines: ['ameli.fr', 'assure.ameli.fr'], domainePrincipal: 'ameli.fr' });
    expect(adresseOfficielle(marque)).toEqual({ principal: 'ameli.fr', aDautresDomaines: false });
  });

  it('positif : plusieurs domaines enregistrables distincts (laposte.fr / laposte.net / colissimo.fr)', () => {
    const marque = marqueDe({ domaines: ['laposte.fr', 'laposte.net', 'colissimo.fr'], domainePrincipal: 'laposte.fr' });
    expect(adresseOfficielle(marque)).toEqual({ principal: 'laposte.fr', aDautresDomaines: true });
  });

  it('cas limite : plusieurs sous-domaines du même domaine enregistrable ne comptent pas comme "autres"', () => {
    const marque = marqueDe({ domaines: ['ants.gouv.fr', 'immatriculation.ants.gouv.fr', 'permisdeconduire.ants.gouv.fr'], domainePrincipal: 'ants.gouv.fr' });
    expect(adresseOfficielle(marque)).toEqual({ principal: 'ants.gouv.fr', aDautresDomaines: false });
  });
});

describe('construireContenuBandeau — gabarit de 9.2 (14.11)', () => {
  it('positif : nomme la marque, montre les deux adresses, boutons attendus', () => {
    const document = installerDocumentGlobal();
    const hote = document.createElement('div');
    const racine = hote.attachShadow({ mode: 'open' });
    construireContenuBandeau(racine, marqueDe(), 'faux-impots-gouv.fr', () => {});

    const texte = racine.textContent ?? '';
    expect(texte).toContain('Impôts / DGFiP');
    expect(texte).toContain('faux-impots-gouv.fr');
    expect(texte).toContain('impots.gouv.fr');
    const libelles = [...racine.querySelectorAll('button')].map((b) => b.textContent);
    // le lien d'aide (14.13 point 3), l'action sûre, la fermeture — et rien d'autre
    expect(libelles).toEqual(['Comment vérifier une adresse', 'Aller sur le site officiel', 'Fermer ce message']);
  });

  it('positif : mentionne "et d\'autres adresses" pour une marque à domaines multiples', () => {
    const document = installerDocumentGlobal();
    const hote = document.createElement('div');
    const racine = hote.attachShadow({ mode: 'open' });
    const marque = marqueDe({ domaines: ['laposte.fr', 'laposte.net'], domainePrincipal: 'laposte.fr', libelle: 'La Poste' });
    construireContenuBandeau(racine, marque, 'faux-laposte.fr', () => {});
    expect(racine.textContent).toContain("et d'autres adresses");
  });

  it('négatif : "Fermer ce message" n\'écrit rien, il ne fait qu\'appeler le retrait (fermeture sans condition, 14.13)', () => {
    const document = installerDocumentGlobal();
    const hote = document.createElement('div');
    const racine = hote.attachShadow({ mode: 'open' });
    const retirer = vi.fn();
    construireContenuBandeau(racine, marqueDe(), 'faux-impots-gouv.fr', retirer);
    const boutonFermer = [...racine.querySelectorAll('button')].find((b) => b.textContent === 'Fermer ce message')!;
    boutonFermer.dispatchEvent(new document.defaultView!.MouseEvent('click', { bubbles: true }));
    expect(retirer).toHaveBeenCalledTimes(1);
  });

  it("cas limite : aucun bouton « ce site est légitime » tant que 14.10 n'est pas codé (14.13 point 5)", () => {
    const document = installerDocumentGlobal();
    const hote = document.createElement('div');
    const racine = hote.attachShadow({ mode: 'open' });
    construireContenuBandeau(racine, marqueDe(), 'faux-impots-gouv.fr', () => {});
    const libelles = [...racine.querySelectorAll('button')].map((b) => b.textContent);
    expect(libelles.some((l) => /légitime/i.test(l ?? ''))).toBe(false);
  });
});

describe('afficherBandeauN2 / retirerBandeau — jamais deux bandeaux empilés (14.6 point b)', () => {
  it('positif : afficherBandeauN2 pose un hôte unique dans document.documentElement', () => {
    const document = installerDocumentGlobal();
    afficherBandeauN2(marqueDe(), 'faux-impots-gouv.fr');
    expect(document.querySelectorAll('#tourmentin-bandeau-n2')).toHaveLength(1);
  });

  it('positif : un second appel remplace le premier, sans empiler', () => {
    const document = installerDocumentGlobal();
    afficherBandeauN2(marqueDe(), 'faux-impots-gouv.fr');
    afficherBandeauN2(marqueDe({ id: 'caf', libelle: 'CAF' }), 'faux-caf.fr');
    expect(document.querySelectorAll('#tourmentin-bandeau-n2')).toHaveLength(1);
  });

  it('négatif : retirerBandeau sans bandeau affiché ne lève pas d\'erreur', () => {
    installerDocumentGlobal();
    expect(() => retirerBandeau()).not.toThrow();
  });
});

describe('lien d\'aide « Comment vérifier une adresse » (14.13 point 3, 14.15 point 2)', () => {
  it('positif : présent, et son clic appelle l\'ouverture de l\'aide sans fermer le bandeau', () => {
    const document = installerDocumentGlobal();
    const hote = document.createElement('div');
    const racine = hote.attachShadow({ mode: 'open' });
    const retirer = vi.fn();
    const ouvrirAide = vi.fn();
    construireContenuBandeau(racine, marqueDe(), 'faux-impots-gouv.fr', retirer, ouvrirAide);
    const lien = [...racine.querySelectorAll('button')].find((b) => b.textContent === 'Comment vérifier une adresse')!;
    expect(lien).toBeDefined();
    lien.dispatchEvent(new document.defaultView!.MouseEvent('click', { bubbles: true }));
    expect(ouvrirAide).toHaveBeenCalledTimes(1);
    expect(retirer).not.toHaveBeenCalled();
  });

  it('cas limite : le bandeau compte trois boutons, dont aucun n\'est « légitime »', () => {
    const document = installerDocumentGlobal();
    const hote = document.createElement('div');
    const racine = hote.attachShadow({ mode: 'open' });
    construireContenuBandeau(racine, marqueDe(), 'faux-impots-gouv.fr', () => {});
    const libelles = [...racine.querySelectorAll('button')].map((b) => b.textContent);
    expect(libelles).toEqual(['Comment vérifier une adresse', 'Aller sur le site officiel', 'Fermer ce message']);
  });
});

describe('mutationsInternes / idempotence — le bandeau ne se réaffiche pas en boucle (14.15)', () => {
  function observer(document: Document): MutationObserver {
    const o = new document.defaultView!.MutationObserver(() => {});
    o.observe(document.documentElement, { childList: true, subtree: true });
    return o;
  }

  it('positif : l\'insertion puis le retrait de notre propre hôte sont des mutations internes', () => {
    const document = installerDocumentGlobal();
    const o = observer(document);
    afficherBandeauN2(marqueDe(), 'faux-impots-gouv.fr');
    retirerBandeau();
    expect(mutationsInternes(o.takeRecords())).toBe(true);
  });

  it('négatif : une mutation de la page elle-même n\'est pas interne, même mêlée aux nôtres', () => {
    const document = installerDocumentGlobal();
    const o = observer(document);
    afficherBandeauN2(marqueDe(), 'faux-impots-gouv.fr');
    document.body.append(document.createElement('div'));
    expect(mutationsInternes(o.takeRecords())).toBe(false);
  });

  it('cas limite : aucune mutation → pas interne (rien à ignorer)', () => {
    expect(mutationsInternes([])).toBe(false);
  });

  it('positif : afficher deux fois le même bandeau ne touche pas au DOM la seconde fois', () => {
    const document = installerDocumentGlobal();
    afficherBandeauN2(marqueDe(), 'faux-impots-gouv.fr');
    const o = observer(document);
    afficherBandeauN2(marqueDe(), 'faux-impots-gouv.fr');
    expect(o.takeRecords()).toHaveLength(0);
  });

  it("positif : retirerBandeau retire l'hôte, et un affichage ultérieur le recrée (la mémoire de la fermeture est tenue par le script de contenu)", () => {
    const document = installerDocumentGlobal();
    afficherBandeauN2(marqueDe(), 'faux-impots-gouv.fr');
    retirerBandeau();
    expect(document.getElementById('tourmentin-bandeau-n2')).toBeNull();
    afficherBandeauN2(marqueDe(), 'faux-impots-gouv.fr');
    expect(document.querySelectorAll('#tourmentin-bandeau-n2')).toHaveLength(1);
  });
});

describe('filtre de l\'observateur — 14.17 : jamais aveugle à la page pendant l\'affichage', () => {
  it('positif : bandeau affiché, la page ajoute un champ mot de passe → mutation NON interne (la réanalyse a lieu)', () => {
    const document = installerDocumentGlobal();
    afficherBandeauN2(marqueDe(), 'faux-impots-gouv.fr');
    const o = new document.defaultView!.MutationObserver(() => {});
    o.observe(document.documentElement, { childList: true, subtree: true });
    const champ = document.createElement('input');
    champ.type = 'password';
    document.body.append(champ);
    expect(mutationsInternes(o.takeRecords())).toBe(false);
  });

  it('positif : la page substitue son formulaire pendant l\'affichage → non interne', () => {
    const document = installerDocumentGlobal();
    document.body.innerHTML = '<form id="ancien"></form>';
    afficherBandeauN2(marqueDe(), 'faux-impots-gouv.fr');
    const o = new document.defaultView!.MutationObserver(() => {});
    o.observe(document.documentElement, { childList: true, subtree: true });
    document.getElementById('ancien')!.replaceWith(document.createElement('form'));
    expect(mutationsInternes(o.takeRecords())).toBe(false);
  });

  it('négatif : seule l\'insertion de notre hôte est ignorée, rien d\'autre', () => {
    const document = installerDocumentGlobal();
    const o = new document.defaultView!.MutationObserver(() => {});
    o.observe(document.documentElement, { childList: true, subtree: true });
    afficherBandeauN2(marqueDe(), 'faux-impots-gouv.fr');
    expect(mutationsInternes(o.takeRecords())).toBe(true);
  });
});
