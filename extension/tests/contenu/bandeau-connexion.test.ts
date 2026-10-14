// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { afficherBandeauN2, mutationsInternes } from '../../src/contenu/bandeau.js';
import {
  TEXTE_ENREGISTRE,
  afficherBandeauConnexion,
  construireContenuBandeauConnexion,
  retirerBandeauConnexion,
  type ActionsBandeauConnexion,
} from '../../src/contenu/bandeau-connexion.js';
import type { EmpreinteMarque } from '../../src/moteur/types.js';

function installerDocumentGlobal(): Document {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
  return dom.window.document;
}

function actions(partiel: Partial<ActionsBandeauConnexion> = {}): ActionsBandeauConnexion {
  return {
    fermer: vi.fn(),
    ouvrirAide: vi.fn(),
    demanderApercu: vi.fn().mockResolvedValue({ texte: 'Vous déclarez : ce site est un site officiel.\nAdresse : https://exemple.fr/connexion' }),
    confirmer: vi.fn().mockResolvedValue({ envoi: 'non' }),
    ...partiel,
  };
}

function racineOuverte(document: Document): ShadowRoot {
  return document.createElement('div').attachShadow({ mode: 'open' });
}

const clic = (document: Document, el: Element) => el.dispatchEvent(new document.defaultView!.MouseEvent('click', { bubbles: true }));
const boutons = (racine: ShadowRoot) => [...racine.querySelectorAll('button')];
const bouton = (racine: ShadowRoot, texte: string) => boutons(racine).find((b) => b.textContent === texte)!;
const attendre = () => new Promise((r) => setTimeout(r, 0));

describe('bandeau de connexion — contenu (14.22 B)', () => {
  it('positif : le texte de Ph, l\'hôte réel, deux boutons et le contrôle de fermeture', () => {
    const document = installerDocumentGlobal();
    const racine = racineOuverte(document);
    construireContenuBandeauConnexion(racine, 'connexion-exemple.fr', actions());
    expect(racine.textContent).toContain('Vérifiez l\'adresse avant de saisir vos identifiants. Adresse de cette page : connexion-exemple.fr');
    expect(boutons(racine).map((b) => b.textContent)).toEqual(['C\'est le bon site', 'Comment vérifier une adresse', '×']);
    expect(racine.querySelector('.fermer')!.getAttribute('aria-label')).toBe('Fermer ce message');
  });

  it('négatif : aucun bouton « légitime » ni « officiel » qui déclare en un clic', () => {
    const document = installerDocumentGlobal();
    const racine = racineOuverte(document);
    construireContenuBandeauConnexion(racine, 'x.fr', actions());
    expect(boutons(racine).some((b) => /officiel/i.test(b.textContent ?? ''))).toBe(false);
  });

  it('« × » ferme sans rien déclarer : ni aperçu demandé, ni confirmation', () => {
    const document = installerDocumentGlobal();
    const racine = racineOuverte(document);
    const a = actions();
    construireContenuBandeauConnexion(racine, 'x.fr', a);
    clic(document, racine.querySelector('.fermer')!);
    expect(a.fermer).toHaveBeenCalledTimes(1);
    expect(a.demanderApercu).not.toHaveBeenCalled();
    expect(a.confirmer).not.toHaveBeenCalled();
  });

  it('« Comment vérifier une adresse » ouvre l\'aide sans fermer ni déclarer', () => {
    const document = installerDocumentGlobal();
    const racine = racineOuverte(document);
    const a = actions();
    construireContenuBandeauConnexion(racine, 'x.fr', a);
    clic(document, bouton(racine, 'Comment vérifier une adresse'));
    expect(a.ouvrirAide).toHaveBeenCalledTimes(1);
    expect(a.fermer).not.toHaveBeenCalled();
    expect(a.confirmer).not.toHaveBeenCalled();
  });
});

describe('« C\'est le bon site » — même aperçu, même confirmation que la popup (14.7 point 3)', () => {
  it('un clic montre l\'aperçu et n\'écrit rien', async () => {
    const document = installerDocumentGlobal();
    const racine = racineOuverte(document);
    const a = actions();
    construireContenuBandeauConnexion(racine, 'exemple.fr', a);
    clic(document, bouton(racine, 'C\'est le bon site'));
    await attendre();
    const texte = racine.querySelector('.apercu')!.textContent!;
    expect(texte).toContain('Rien n\'est envoyé. Cette entrée sera écrite sur cet ordinateur seulement');
    expect(texte).toContain('ce site est un site officiel');
    expect(a.demanderApercu).toHaveBeenCalledTimes(1);
    expect(a.confirmer).not.toHaveBeenCalled();
  });

  it('la confirmation seule écrit, puis le texte dit que rien n\'est transmis', async () => {
    const document = installerDocumentGlobal();
    const racine = racineOuverte(document);
    const a = actions();
    construireContenuBandeauConnexion(racine, 'exemple.fr', a);
    clic(document, bouton(racine, 'C\'est le bon site'));
    await attendre();
    clic(document, bouton(racine, 'Confirmer la déclaration'));
    await attendre();
    expect(a.confirmer).toHaveBeenCalledTimes(1);
    // aperçu sans envoi proposé = « Ne jamais envoyer » : « Il ne sera pas transmis » (décision de Ph, 07/10/2026)
    expect(racine.querySelector('.apercu')!.textContent).toBe('Signalement enregistré sur cet ordinateur. Il ne sera pas transmis (réglage « Ne jamais envoyer »).');
    expect(TEXTE_ENREGISTRE).toContain('pas encore transmis'); // les deux autres modes
    expect(boutons(racine).some((b) => b.textContent === 'C\'est le bon site' && !b.hidden)).toBe(false);
  });

  it('sans rien à déclarer, le dit et n\'offre aucune confirmation', async () => {
    const document = installerDocumentGlobal();
    const racine = racineOuverte(document);
    construireContenuBandeauConnexion(racine, 'exemple.fr', actions({ demanderApercu: vi.fn().mockResolvedValue(null) }));
    clic(document, bouton(racine, 'C\'est le bon site'));
    await attendre();
    expect(racine.querySelector('.apercu')!.textContent).toBe('Rien à déclarer sur cette page.');
    expect(boutons(racine).some((b) => b.textContent === 'Confirmer la déclaration')).toBe(false);
  });

  it('un échec du message ne casse pas le bandeau', async () => {
    const document = installerDocumentGlobal();
    const racine = racineOuverte(document);
    construireContenuBandeauConnexion(racine, 'exemple.fr', actions({ demanderApercu: vi.fn().mockRejectedValue(new Error('port fermé')) }));
    clic(document, bouton(racine, 'C\'est le bon site'));
    await attendre();
    expect(racine.querySelector('.apercu')!.textContent).toBe('Rien à déclarer sur cette page.');
  });
});

describe('afficherBandeauConnexion — un seul hôte, idempotent, filtré par l\'observateur', () => {
  it('pose un hôte unique dans le document, et le retire', () => {
    const document = installerDocumentGlobal();
    afficherBandeauConnexion('exemple.fr', actions());
    afficherBandeauConnexion('exemple.fr', actions());
    expect(document.querySelectorAll('#tourmentin-bandeau-connexion')).toHaveLength(1);
    retirerBandeauConnexion();
    expect(document.getElementById('tourmentin-bandeau-connexion')).toBeNull();
  });

  it('un second affichage identique ne touche pas au DOM (pas de boucle d\'analyse)', () => {
    const document = installerDocumentGlobal();
    afficherBandeauConnexion('exemple.fr', actions());
    const o = new document.defaultView!.MutationObserver(() => {});
    o.observe(document.documentElement, { childList: true, subtree: true });
    afficherBandeauConnexion('exemple.fr', actions());
    expect(o.takeRecords()).toHaveLength(0);
  });

  it('« × » retire le bandeau et prévient le script de contenu', () => {
    const document = installerDocumentGlobal();
    const a = actions();
    afficherBandeauConnexion('exemple.fr', a);
    // Racine fermée : on passe par la construction ouverte pour cliquer, le retrait est celui d'afficher.
    const racine = racineOuverte(document);
    construireContenuBandeauConnexion(racine, 'exemple.fr', { ...a, fermer: () => { retirerBandeauConnexion(); a.fermer(); } });
    clic(document, racine.querySelector('.fermer')!);
    expect(document.getElementById('tourmentin-bandeau-connexion')).toBeNull();
    expect(a.fermer).toHaveBeenCalled();
  });

  it('son insertion et son retrait sont des mutations internes, une mutation de la page ne l\'est pas', () => {
    const document = installerDocumentGlobal();
    const o = new document.defaultView!.MutationObserver(() => {});
    o.observe(document.documentElement, { childList: true, subtree: true });
    afficherBandeauConnexion('exemple.fr', actions());
    retirerBandeauConnexion();
    expect(mutationsInternes(o.takeRecords())).toBe(true);
    afficherBandeauConnexion('exemple.fr', actions());
    document.body.append(document.createElement('div'));
    expect(mutationsInternes(o.takeRecords())).toBe(false);
  });

  it('les deux hôtes de Tourmentin coexistent sans se remplacer l\'un l\'autre', () => {
    const document = installerDocumentGlobal();
    const marque = { id: 'impots-gouv', libelle: 'Impôts', domaines: ['impots.gouv.fr'], domainePrincipal: 'impots.gouv.fr' } as EmpreinteMarque;
    afficherBandeauConnexion('exemple.fr', actions());
    afficherBandeauN2(marque, 'faux.fr');
    expect(document.querySelectorAll('#tourmentin-bandeau-connexion')).toHaveLength(1);
    expect(document.querySelectorAll('#tourmentin-bandeau-n2')).toHaveLength(1);
  });
});
