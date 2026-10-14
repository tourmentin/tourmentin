// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { ErreurSW, TEXTE_SW_MUET, TEXTE_SW_PAS_RECHARGE, demander, texteErreur, verifierService } from '../../src/ui/service-worker.js';

const rapide = { pauseMs: 0 };

describe('demander (14.43) : une réponse vide ne devient jamais un objet lu à l\'aveugle', () => {
  it('rend la réponse quand son type est celui attendu', async () => {
    const transport = vi.fn().mockResolvedValue({ type: 'LIAISON_ETAT', lie: true, role: null });
    const r = await demander({ type: 'LIRE_LIAISON' }, 'LIAISON_ETAT', { transport, ...rapide });
    expect(r.lie).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('réponse vide (undefined) : un second essai, puis ErreurSW « muet »', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    await expect(demander({ type: 'LIRE_LIAISON' }, 'LIAISON_ETAT', { transport, ...rapide })).rejects.toMatchObject({ raison: 'muet' });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('un service worker qui démarre : le premier message manqué, le second reçu', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('Receiving end does not exist')).mockResolvedValueOnce({ type: 'LIAISON', ok: true });
    const r = await demander({ type: 'LIER_COMPTE', code: 'x' }, 'LIAISON', { transport, ...rapide });
    expect(r.ok).toBe(true);
  });

  it('rejet permanent : ErreurSW « muet »', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('boum'));
    await expect(demander({ type: 'LIRE_ROLE' }, 'ROLE', { transport, ...rapide })).rejects.toBeInstanceOf(ErreurSW);
  });

  it('« INCONNU » : pas de nouvel essai, ErreurSW « inconnu »', async () => {
    const transport = vi.fn().mockResolvedValue({ type: 'INCONNU' });
    await expect(demander({ type: 'LIRE_LIAISON' }, 'LIAISON_ETAT', { transport, ...rapide })).rejects.toMatchObject({ raison: 'inconnu' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('« ERREUR_SW » : nouvel essai, puis ErreurSW « erreur »', async () => {
    const transport = vi.fn().mockResolvedValue({ type: 'ERREUR_SW', raison: 'exception' });
    await expect(demander({ type: 'LIRE_ROLE' }, 'ROLE', { transport, ...rapide })).rejects.toMatchObject({ raison: 'erreur' });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('une réponse d\'un autre type, ou un objet sans type, ou une valeur nue, est traitée comme muette', async () => {
    for (const reponse of [{ type: 'JOURNAL', entrees: [] }, { lie: true }, 'texte', null]) {
      const transport = vi.fn().mockResolvedValue(reponse);
      await expect(demander({ type: 'LIRE_LIAISON' }, 'LIAISON_ETAT', { transport, ...rapide })).rejects.toMatchObject({ raison: 'muet' });
    }
  });

  it('un seul essai demandé : un seul envoi', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    await expect(demander({ type: 'LIRE_ROLE' }, 'ROLE', { transport, essais: 1 })).rejects.toBeInstanceOf(ErreurSW);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('un service worker qui ne répond jamais : « muet » après le délai, la page nest pas figée', async () => {
    const transport = vi.fn().mockReturnValue(new Promise(() => {}));
    await expect(demander({ type: 'LIRE_ROLE' }, 'ROLE', { transport, essais: 1, delaiMs: 20 })).rejects.toMatchObject({ raison: 'muet' });
  });

  it('transport par défaut : chrome.runtime.sendMessage', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ type: 'VERSION', build: 'x' });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    expect((await demander({ type: 'LIRE_VERSION' }, 'VERSION')).build).toBe('x');
    vi.unstubAllGlobals();
  });
});

describe('texteErreur et verifierService', () => {
  it('textes clairs, jamais de détail technique', () => {
    expect(texteErreur(new ErreurSW('inconnu'))).toBe(TEXTE_SW_PAS_RECHARGE);
    expect(texteErreur(new ErreurSW('muet'))).toBe(TEXTE_SW_MUET);
    expect(texteErreur(new Error('x'))).toBe(TEXTE_SW_MUET);
    expect(TEXTE_SW_MUET).toMatch(/chrome:\/\/extensions/);
  });

  it('même construction : ok', async () => {
    const transport = vi.fn().mockResolvedValue({ type: 'VERSION', build: 'essai 1 · spec 1.100 · abc' });
    expect(await verifierService({ transport, buildAttendu: 'essai 1 · spec 1.100 · abc' })).toEqual({ ok: true });
  });

  it('construction différente : « mis à jour mais pas rechargé »', async () => {
    const transport = vi.fn().mockResolvedValue({ type: 'VERSION', build: 'ancienne' });
    expect(await verifierService({ transport, buildAttendu: 'nouvelle' })).toEqual({ ok: false, texte: TEXTE_SW_PAS_RECHARGE });
  });

  it('service worker qui ne connaît pas le message (ancien) : « pas rechargé »', async () => {
    const transport = vi.fn().mockResolvedValue({ type: 'INCONNU' });
    expect(await verifierService({ transport })).toEqual({ ok: false, texte: TEXTE_SW_PAS_RECHARGE });
  });

  it('service worker muet : message clair, et build attendu par défaut', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    expect(await verifierService({ transport })).toEqual({ ok: false, texte: TEXTE_SW_MUET });
  });

  it('build par défaut du test : « hors-build » des deux côtés', async () => {
    const transport = vi.fn().mockResolvedValue({ type: 'VERSION', build: 'hors-build' });
    expect(await verifierService({ transport })).toEqual({ ok: true });
  });
});
