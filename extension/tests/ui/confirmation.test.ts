// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { construireConfirmation, messageResultat, TEXTE_JAMAIS_TRANSMIS, TEXTE_NON_TRANSMIS } from '../../src/ui/confirmation.js';

function installerDocument(): Document {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
  return dom.window.document;
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

describe('construireConfirmation — 14.19 A2/B : dit la vérité sur ce qui part', () => {
  it('« Ne jamais envoyer » : « Rien n\'est envoyé », un seul bouton, jamais d\'envoi demandé', async () => {
    const document = installerDocument();
    const confirmer = vi.fn().mockResolvedValue({ envoi: 'non' });
    const elements = construireConfirmation({ texte: 'Adresse : https://x.fr/' }, confirmer, () => {});
    document.body.append(...elements);
    expect(document.body.textContent).toContain('Rien n\'est envoyé. Cette entrée sera écrite sur cet ordinateur seulement');
    expect(document.body.querySelectorAll('button')).toHaveLength(1);
    document.getElementById('bouton-confirmer')!.click();
    await attendre();
    expect(confirmer).toHaveBeenCalledWith(false);
  });

  it('« Me demander » : le corps exact, et deux choix distincts', async () => {
    const document = installerDocument();
    const confirmer = vi.fn().mockResolvedValue({ envoi: 'ok' });
    const termine = vi.fn();
    const corps = '{\n  "hote": "faux.example.fr"\n}';
    document.body.append(...construireConfirmation({ texte: 'Adresse : https://faux.example.fr/', envoi: { mode: 'demander', corps } }, confirmer, termine));
    expect(document.body.textContent).toContain('Voulez-vous aussi l\'envoyer à tourmentin.fr');
    expect(document.body.querySelector('pre')!.textContent).toBe(corps);
    expect(document.body.textContent).not.toContain('Rien n\'est envoyé');
    expect([...document.body.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Enregistrer et envoyer', 'Enregistrer seulement']);
    document.getElementById('bouton-confirmer')!.click();
    await attendre();
    expect(confirmer).toHaveBeenLastCalledWith(false);
    expect(termine).toHaveBeenCalledWith({ envoi: 'ok' });
  });

  it('« Me demander » : « Enregistrer et envoyer » demande l\'envoi', async () => {
    const document = installerDocument();
    const confirmer = vi.fn().mockResolvedValue({ envoi: 'ok' });
    document.body.append(...construireConfirmation({ texte: 't', envoi: { mode: 'demander', corps: '{}' } }, confirmer, () => {}));
    document.getElementById('bouton-confirmer-envoyer')!.click();
    await attendre();
    expect(confirmer).toHaveBeenCalledWith(true);
  });

  it('« Envoyer automatiquement » : le texte le dit, un seul bouton qui envoie', async () => {
    const document = installerDocument();
    const confirmer = vi.fn().mockResolvedValue({ envoi: 'ok' });
    document.body.append(...construireConfirmation({ texte: 't', envoi: { mode: 'automatique', corps: '{}' } }, confirmer, () => {}));
    expect(document.body.textContent).toContain('sera aussi envoyée à tourmentin.fr dès que vous confirmez');
    expect(document.body.querySelectorAll('button')).toHaveLength(1);
    document.getElementById('bouton-confirmer')!.click();
    await attendre();
    expect(confirmer).toHaveBeenCalledWith(true);
  });

  it('un échec du message ne casse pas l\'interface : résultat « non » rendu', async () => {
    const document = installerDocument();
    const termine = vi.fn();
    document.body.append(...construireConfirmation({ texte: 't' }, vi.fn().mockRejectedValue(new Error('x')), termine));
    document.getElementById('bouton-confirmer')!.click();
    await attendre();
    expect(termine).toHaveBeenCalledWith({ envoi: 'non', jamais: true }); // aperçu sans envoi proposé = « Ne jamais envoyer »
  });

  it('le bouton est désactivé après le clic : pas de double envoi', async () => {
    const document = installerDocument();
    const confirmer = vi.fn().mockResolvedValue({ envoi: 'non' });
    document.body.append(...construireConfirmation({ texte: 't' }, confirmer, () => {}));
    const bouton = document.getElementById('bouton-confirmer') as HTMLButtonElement;
    bouton.click();
    bouton.click();
    await attendre();
    expect(confirmer).toHaveBeenCalledTimes(1);
  });
});

describe('messageResultat', () => {
  it('envoyé : « vérification en cours » ; non envoyé : le libellé de 14.22 C3 ; échec : la raison, en français', () => {
    expect(messageResultat({ envoi: 'ok' })).toContain('envoyée à tourmentin.fr : vérification en cours');
    expect(messageResultat({ envoi: 'non' })).toBe(TEXTE_NON_TRANSMIS);
    expect(messageResultat({ envoi: 'non', jamais: true })).toBe(TEXTE_JAMAIS_TRANSMIS);
    expect(TEXTE_JAMAIS_TRANSMIS).toBe('Signalement enregistré sur cet ordinateur. Il ne sera pas transmis (réglage « Ne jamais envoyer »).');
    expect(messageResultat({ envoi: 'echec', erreur: 'reseau' })).toContain('serveur injoignable');
    expect(messageResultat({ envoi: 'echec', erreur: 'trop_de_requetes' })).toContain('réessayez plus tard');
    expect(messageResultat({ envoi: 'echec' })).toContain('raison inconnue');
  });
});
