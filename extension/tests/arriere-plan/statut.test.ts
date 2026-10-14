// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { EntreeSignalement } from '../../src/arriere-plan/signalements.js';
import { determinerStatut, statutSansVerdict, type CibleStatut } from '../../src/arriere-plan/statut.js';
import type { EmpreinteMarque, Listes, SignalDeclenche, Verdict } from '../../src/moteur/types.js';

const impots: EmpreinteMarque = {
  id: 'impots-gouv',
  libelle: 'Impôts / DGFiP',
  domaines: ['impots.gouv.fr'],
  domainePrincipal: 'impots.gouv.fr',
  termesForts: [],
  termesFaibles: [],
  termesSaisie: [],
  faviconHash: [],
  couleurs: [],
  racinesTypo: [],
  criticite: 3,
};

function listes(partiel: Partial<Listes> = {}): Listes {
  return { socle: [impots], revocation: [], exclusionsPersonnelles: [], communautaireValidee: [], domainesDejaVus: [], tldAbusifs: [], ...partiel };
}

function cible(hote: string, domaineEnregistrable = hote, schema = 'https'): CibleStatut {
  return { hote, schema, domaineEnregistrable };
}

const E1: SignalDeclenche = { code: 'E1', poids: 40, famille: 'identifiant', detail: 'champ mot de passe visible' };
const E5: SignalDeclenche = { code: 'E5', poids: 100, famille: 'identifiant', detail: 'secret reconnu' };
const E8: SignalDeclenche = { code: 'E8', poids: 60, famille: 'paiement', detail: 'champ numéro de carte' };
const E2: SignalDeclenche = { code: 'E2', poids: 20, famille: 'identifiant', detail: 'champ identifiant' };

function declaration(hote: string, type?: 'officiel' | 'frauduleuse'): EntreeSignalement {
  return { horodatage: '2026-09-30T10:00:00.000Z', type, schema: 'https', hote, chemin: '/', requetePresente: false, niveau: 'N0', motif: 'x' };
}

const N0: Verdict = { niveau: 'N0', motif: 'aucun champ de saisie ni formulaire' };

describe('determinerStatut — chaque statut de 14.20 F', () => {
  it('1. Z4 : page locale', () => {
    const s = determinerStatut(N0, cible('localhost', 'localhost', 'http'), listes(), []);
    expect(s).toMatchObject({ code: 'hors-perimetre', texte: 'Tourmentin ne s\'applique pas à cette page', couleur: 'gris' });
  });

  it('1. Z4 : schéma non http(s)', () => {
    expect(determinerStatut(N0, cible('version', 'version', 'chrome'), listes(), []).code).toBe('hors-perimetre');
  });

  it('2. Z3 : exclusion personnelle', () => {
    const s = determinerStatut(N0, cible('www.exemple.fr', 'exemple.fr'), listes({ exclusionsPersonnelles: ['exemple.fr'] }), []);
    expect(s).toMatchObject({ code: 'exclusion-personnelle', texte: 'Surveillance désactivée par vous sur ce site', couleur: 'gris' });
  });

  it('3. domaine confirmé frauduleux dans la liste', () => {
    const s = determinerStatut({ niveau: 'N3', motif: 'domaine signalé' }, cible('faux.fr'), listes({ revocation: ['faux.fr'] }), []);
    expect(s).toMatchObject({ code: 'frauduleux-liste', texte: 'Site frauduleux signalé : quittez cette page', couleur: 'rouge' });
  });

  it('3. hôte confirmé frauduleux (14.37 point 4) : statut 3, avant Z4, Z3 et le socle, par hôte exact', () => {
    const l = listes({ hotesFrauduleux: ['faux.exemple.fr'] });
    expect(determinerStatut({ niveau: 'N3', motif: 'domaine signalé', signaleParListe: true }, cible('faux.exemple.fr', 'exemple.fr'), l, [])).toMatchObject({ code: 'frauduleux-liste', texte: 'Site frauduleux signalé : quittez cette page', couleur: 'rouge' });
    // même rang que la révocation : avant l'exclusion personnelle
    const exclu = listes({ hotesFrauduleux: ['faux.exemple.fr'], exclusionsPersonnelles: ['exemple.fr'] });
    expect(determinerStatut(N0, cible('faux.exemple.fr', 'exemple.fr'), exclu, []).code).toBe('frauduleux-liste');
    // un autre hôte du même domaine n'est pas touché
    expect(determinerStatut(N0, cible('autre.exemple.fr', 'exemple.fr'), l, []).code).not.toBe('frauduleux-liste');
  });

  it('4. domaine du socle : « Site officiel vérifié : {marque} »', () => {
    const s = determinerStatut(N0, cible('www.impots.gouv.fr', 'impots.gouv.fr'), listes(), []);
    expect(s).toMatchObject({ code: 'officiel-verifie', texte: 'Site officiel vérifié : Impôts / DGFiP', couleur: 'vert' });
  });

  it('4. domaine validé par la couche communautaire : sans marque, le libellé ne l\'invente pas', () => {
    const s = determinerStatut(N0, cible('mairie-exemple.fr'), listes({ communautaireValidee: ['mairie-exemple.fr'] }), []);
    expect(s).toMatchObject({ code: 'officiel-verifie', texte: 'Site officiel vérifié', couleur: 'vert' });
  });

  it('5. N2 : « Imitation probable de {marque} : ne saisissez rien »', () => {
    const v: Verdict = { niveau: 'N2', motif: 'm', marqueDetectee: 'impots-gouv', signauxExposition: [E1] };
    const s = determinerStatut(v, cible('faux-impots.fr'), listes(), []);
    expect(s).toMatchObject({ code: 'n2-imitation', texte: 'Imitation probable de Impôts / DGFiP : ne saisissez rien', couleur: 'rouge' });
  });

  it('6. N1 : « Ce site ressemble à {marque}, mais ce n\'est pas son adresse officielle »', () => {
    const v: Verdict = { niveau: 'N1', motif: 'm', marqueDetectee: 'impots-gouv', signauxExposition: [E1] };
    const s = determinerStatut(v, cible('faux-impots.fr'), listes(), []);
    expect(s).toMatchObject({ code: 'n1-ressemble', texte: 'Ce site ressemble à Impôts / DGFiP, mais ce n\'est pas son adresse officielle', couleur: 'orange' });
  });

  it('7. déclaré par cet utilisateur, en attente', () => {
    const s = determinerStatut(N0, cible('inconnu.fr'), listes(), [declaration('inconnu.fr', 'officiel')]);
    expect(s).toMatchObject({ code: 'declare-en-attente', texte: 'Signalement enregistré sur cet ordinateur, pas encore transmis', couleur: 'bleu' });
  });

  it('7. une entrée antérieure à 14.20 (sans champ type) compte comme déclaration', () => {
    const s = determinerStatut(N0, cible('inconnu.fr'), listes(), [declaration('inconnu.fr')]);
    expect(s.code).toBe('declare-en-attente');
    expect(s.dejaDeclare).toEqual(['frauduleuse']);
  });

  it('8. N0 avec champ mot de passe', () => {
    const v: Verdict = { niveau: 'N0', motif: 'sous les seuils d\'alerte', signauxExposition: [E1] };
    expect(determinerStatut(v, cible('inconnu.fr'), listes(), [])).toMatchObject({ code: 'inconnu-prudence', texte: 'Site inconnu : prudence avant de saisir vos informations', couleur: 'jaune' });
  });

  it('8. N0 avec champ de paiement', () => {
    const v: Verdict = { niveau: 'N0', motif: 'sous les seuils d\'alerte', signauxExposition: [E8] };
    expect(determinerStatut(v, cible('boutique.fr'), listes(), []).code).toBe('inconnu-prudence');
  });

  it('9. N0 sans saisie sensible', () => {
    expect(determinerStatut(N0, cible('inconnu.fr'), listes(), [])).toMatchObject({ code: 'non-repertorie', texte: 'Site non répertorié par Tourmentin', couleur: 'gris' });
  });

  it('9. N0 avec un simple champ identifiant (ni mot de passe ni paiement) reste gris', () => {
    const v: Verdict = { niveau: 'N0', motif: 'sous les seuils d\'alerte', signauxExposition: [E2] };
    expect(determinerStatut(v, cible('inconnu.fr'), listes(), []).code).toBe('non-repertorie');
  });

  it('aucun texte ne porte plus le niveau N0 à N3 ni « Motif »', () => {
    const verdicts: Verdict[] = [N0, { niveau: 'N1', motif: 'aucune exposition détectée', marqueDetectee: 'impots-gouv' }, { niveau: 'N2', motif: 'm', marqueDetectee: 'impots-gouv' }];
    for (const v of verdicts) {
      const { texte } = determinerStatut(v, cible('x.fr'), listes(), []);
      expect(texte).not.toMatch(/\bN[0-3]\b|Motif|aucune exposition détectée/);
    }
  });
});

describe('determinerStatut — N3 (proposition de 14.20 F) et N3 sans marque', () => {
  it('N3 par score avec marque', () => {
    const v: Verdict = { niveau: 'N3', motif: 'm', marqueDetectee: 'impots-gouv', signauxExposition: [E1] };
    expect(determinerStatut(v, cible('faux-impots.fr'), listes(), [])).toMatchObject({ code: 'n3-imitation', texte: 'Imitation quasi certaine de Impôts / DGFiP : quittez cette page', couleur: 'rouge' });
  });

  it('N3 sans marque (E5) : le texte ne nomme aucune marque', () => {
    const v: Verdict = { niveau: 'N3', motif: 'secret reconnu à la frappe', signauxExposition: [E5] };
    const s = determinerStatut(v, cible('inconnu.fr'), listes(), []);
    expect(s.code).toBe('secret-reconnu');
    expect(s.texte).toContain('secret');
    expect(s.texte).not.toContain('undefined');
    expect(s.couleur).toBe('rouge');
  });

  it('N3 sans marque et sans E5 : jamais de « undefined », libellé du statut 3', () => {
    const s = determinerStatut({ niveau: 'N3', motif: 'x' }, cible('inconnu.fr'), listes(), []);
    expect(s.texte).toBe('Site frauduleux signalé : quittez cette page');
  });

  it('un « vérifié » ne s\'affiche jamais au-dessus d\'un N3, même sur un domaine du socle', () => {
    const v: Verdict = { niveau: 'N3', motif: 'secret reconnu à la frappe', signauxExposition: [E5] };
    expect(determinerStatut(v, cible('www.impots.gouv.fr', 'impots.gouv.fr'), listes(), []).code).toBe('secret-reconnu');
  });
});

describe('determinerStatut — ordre de priorité', () => {
  it('Z4 avant Z3 (le domaine frauduleux, lui, passe avant les deux : 14.22 C1)', () => {
    const s = determinerStatut(N0, cible('localhost', 'localhost', 'http'), listes({ exclusionsPersonnelles: ['localhost'] }), []);
    expect(s.code).toBe('hors-perimetre');
  });

  it('le domaine frauduleux passe avant Z3 et avant Z4 (14.22 C1)', () => {
    const v: Verdict = { niveau: 'N3', motif: 'domaine signalé' };
    expect(determinerStatut(v, cible('faux.fr'), listes({ exclusionsPersonnelles: ['faux.fr'], revocation: ['faux.fr'] }), []).code).toBe('frauduleux-liste');
    expect(determinerStatut(N0, cible('localhost', 'localhost', 'http'), listes({ revocation: ['localhost'] }), []).code).toBe('frauduleux-liste');
  });

  it('le domaine frauduleux avant « officiel vérifié »', () => {
    const s = determinerStatut(N0, cible('www.impots.gouv.fr', 'impots.gouv.fr'), listes({ revocation: ['impots.gouv.fr'] }), []);
    expect(s.code).toBe('frauduleux-liste');
  });

  it('une déclaration ne fait jamais taire l\'alerte : N2 l\'emporte sur « vous avez signalé »', () => {
    const v: Verdict = { niveau: 'N2', motif: 'm', marqueDetectee: 'impots-gouv' };
    expect(determinerStatut(v, cible('faux-impots.fr'), listes(), [declaration('faux-impots.fr', 'officiel')]).code).toBe('n2-imitation');
  });

  it('idem pour N1', () => {
    const v: Verdict = { niveau: 'N1', motif: 'm', marqueDetectee: 'impots-gouv' };
    expect(determinerStatut(v, cible('faux-impots.fr'), listes(), [declaration('faux-impots.fr', 'officiel')]).code).toBe('n1-ressemble');
  });

  it('une déclaration sur un autre hôte ne change rien', () => {
    expect(determinerStatut(N0, cible('inconnu.fr'), listes(), [declaration('autre.fr', 'officiel')]).code).toBe('non-repertorie');
  });
});

describe('boutons — 14.20 G', () => {
  it('« Signaler comme site officiel » : présent sur un site inconnu', () => {
    expect(determinerStatut(N0, cible('inconnu.fr'), listes(), []).peutSignalerOfficiel).toBe(true);
  });

  it('masqué sur un site déjà officiel vérifié', () => {
    expect(determinerStatut(N0, cible('www.impots.gouv.fr', 'impots.gouv.fr'), listes(), []).peutSignalerOfficiel).toBe(false);
  });

  it('absent des pages de paiement, quel que soit le statut', () => {
    const inconnu: Verdict = { niveau: 'N0', motif: 'm', signauxExposition: [E8] };
    const n2: Verdict = { niveau: 'N2', motif: 'm', marqueDetectee: 'impots-gouv', signauxExposition: [E8] };
    expect(determinerStatut(inconnu, cible('boutique.fr'), listes(), []).peutSignalerOfficiel).toBe(false);
    expect(determinerStatut(n2, cible('faux-impots.fr'), listes(), []).peutSignalerOfficiel).toBe(false);
  });

  it('absent hors périmètre, en exclusion personnelle et sur un domaine déjà signalé frauduleux', () => {
    expect(determinerStatut(N0, cible('localhost', 'localhost', 'http'), listes(), []).peutSignalerOfficiel).toBe(false);
    expect(determinerStatut(N0, cible('a.fr'), listes({ exclusionsPersonnelles: ['a.fr'] }), []).peutSignalerOfficiel).toBe(false);
    expect(determinerStatut(N0, cible('f.fr'), listes({ revocation: ['f.fr'] }), []).peutSignalerOfficiel).toBe(false);
  });

  it('présent sur N1 et N2 : la déclaration ne fait pas taire l\'alerte, elle n\'est pas refusée', () => {
    const v: Verdict = { niveau: 'N2', motif: 'm', marqueDetectee: 'impots-gouv' };
    expect(determinerStatut(v, cible('faux-impots.fr'), listes(), []).peutSignalerOfficiel).toBe(true);
  });

  it('ne repropose pas une déclaration déjà faite, mais propose l\'autre', () => {
    const s = determinerStatut(N0, cible('inconnu.fr'), listes(), [declaration('inconnu.fr', 'officiel')]);
    expect(s.peutSignalerOfficiel).toBe(false);
    expect(s.peutDeclarerFrauduleuse).toBe(true);
  });

  it('« Cette page est frauduleuse » : partout sauf hors périmètre', () => {
    expect(determinerStatut(N0, cible('inconnu.fr'), listes(), []).peutDeclarerFrauduleuse).toBe(true);
    expect(determinerStatut(N0, cible('www.impots.gouv.fr', 'impots.gouv.fr'), listes(), []).peutDeclarerFrauduleuse).toBe(true);
    expect(determinerStatut(N0, cible('localhost', 'localhost', 'http'), listes(), []).peutDeclarerFrauduleuse).toBe(false);
  });
});

describe('14.22 C2 : la couche communautaire porte la marque', () => {
  it('domaine validé avec sa marque : « Site officiel vérifié : {marque} »', () => {
    const l = listes({ communautaireValidee: ['mairie-exemple.fr'], communautaireMarques: { 'mairie-exemple.fr': 'impots-gouv' } });
    expect(determinerStatut(N0, cible('mairie-exemple.fr'), l, []).texte).toBe('Site officiel vérifié : Impôts / DGFiP');
  });

  it('domaine validé sans marque déclarée : pas de marque inventée', () => {
    const l = listes({ communautaireValidee: ['mairie-exemple.fr'] });
    expect(determinerStatut(N0, cible('mairie-exemple.fr'), l, []).texte).toBe('Site officiel vérifié');
  });

  it('une marque déclarée absente du socle est affichée telle quelle, jamais « undefined »', () => {
    const l = listes({ communautaireValidee: ['x.fr'], communautaireMarques: { 'x.fr': 'ma-marque' } });
    expect(determinerStatut(N0, cible('x.fr'), l, []).texte).toBe('Site officiel vérifié : ma-marque');
  });
});

describe('14.22 C6 : détails de N1 derrière le lien « Détails »', () => {
  const signalI: SignalDeclenche = { code: 'I1', poids: 40, famille: 'textuelle', detail: 'terme fort « espace particulier »' };

  it('N1 : marque, motif et signaux, sans niveau', () => {
    const v: Verdict = { niveau: 'N1', motif: 'indices d\'imitation et exposition modérée', marqueDetectee: 'impots-gouv', signauxImitation: [signalI], signauxExposition: [E1] };
    const s = determinerStatut(v, cible('faux-impots.fr'), listes(), []);
    expect(s.details).toEqual({
      marque: 'Impôts / DGFiP',
      motif: 'indices d\'imitation et exposition modérée',
      signaux: ['I1 : terme fort « espace particulier »', 'E1 : champ mot de passe visible'],
    });
    expect(JSON.stringify(s.details)).not.toMatch(/\bN[0-3]\b/);
  });

  it('les autres statuts ne portent pas de détails', () => {
    expect(determinerStatut(N0, cible('inconnu.fr'), listes(), []).details).toBeUndefined();
    const n2: Verdict = { niveau: 'N2', motif: 'm', marqueDetectee: 'impots-gouv' };
    expect(determinerStatut(n2, cible('faux-impots.fr'), listes(), []).details).toBeUndefined();
  });
});

describe('indicateurs pour le bandeau de connexion', () => {
  it('champ mot de passe et pas de paiement', () => {
    const s = determinerStatut({ niveau: 'N0', motif: 'm', signauxExposition: [E1] }, cible('inconnu.fr'), listes(), []);
    expect(s).toMatchObject({ champMotDePasse: true, pagePaiement: false });
  });

  it('paiement seul : pas de champ mot de passe', () => {
    const s = determinerStatut({ niveau: 'N0', motif: 'm', signauxExposition: [E8] }, cible('boutique.fr'), listes(), []);
    expect(s).toMatchObject({ champMotDePasse: false, pagePaiement: true });
  });
});

describe('statutSansVerdict', () => {
  it('boutique d\'extensions : hors champ, aucun script de contenu n\'y tourne (14.22 A)', () => {
    expect(statutSansVerdict('https://chromewebstore.google.com/detail/x')?.code).toBe('hors-perimetre');
    expect(statutSansVerdict('https://chrome.google.com/webstore/detail/x')?.code).toBe('hors-perimetre');
    expect(statutSansVerdict('https://chrome.google.com/autre')).toBeNull();
  });

  it('adresse illisible (chrome://, boutique) : statut 1', () => {
    expect(statutSansVerdict(undefined)?.code).toBe('hors-perimetre');
    expect(statutSansVerdict('chrome://extensions/')?.code).toBe('hors-perimetre');
  });

  it('page locale : statut 1', () => {
    expect(statutSansVerdict('http://localhost:3000/')?.code).toBe('hors-perimetre');
  });

  it('page http(s) sans verdict : pas de statut, l\'analyse n\'est pas arrivée', () => {
    expect(statutSansVerdict('https://exemple.fr/')).toBeNull();
  });
});

describe('statut 7 — 14.26 étape 3 : « vérification en cours » seulement quand l\'envoi a eu lieu', () => {
  it('déclaration envoyée : « Vous avez signalé ce site : vérification en cours »', () => {
    const envoyee = { ...declaration('inconnu.fr', 'officiel'), envoi: 'ok' as const };
    expect(determinerStatut(N0, cible('inconnu.fr'), listes(), [envoyee]).texte).toBe('Vous avez signalé ce site : vérification en cours');
  });

  it('envoi échoué ou jamais fait : « pas encore transmis »', () => {
    const echec = { ...declaration('inconnu.fr', 'officiel'), envoi: 'echec' as const };
    expect(determinerStatut(N0, cible('inconnu.fr'), listes(), [echec]).texte).toBe('Signalement enregistré sur cet ordinateur, pas encore transmis');
    expect(determinerStatut(N0, cible('inconnu.fr'), listes(), [declaration('inconnu.fr', 'officiel')]).texte).toBe('Signalement enregistré sur cet ordinateur, pas encore transmis');
  });

  it('« Ne jamais envoyer » (décision de Ph, 07/10) : « Il ne sera pas transmis » ; les deux autres modes gardent « pas encore transmis »', () => {
    const d = [declaration('inconnu.fr', 'officiel')];
    expect(determinerStatut(N0, cible('inconnu.fr'), listes(), d, 'jamais')).toMatchObject({
      code: 'declare-en-attente',
      texte: 'Signalement enregistré sur cet ordinateur. Il ne sera pas transmis (réglage « Ne jamais envoyer »).',
      couleur: 'bleu',
    });
    for (const mode of ['demander', 'automatique'] as const) {
      expect(determinerStatut(N0, cible('inconnu.fr'), listes(), d, mode).texte).toBe('Signalement enregistré sur cet ordinateur, pas encore transmis');
    }
    expect(determinerStatut(N0, cible('inconnu.fr'), listes(), d).texte).toBe('Signalement enregistré sur cet ordinateur, pas encore transmis');
  });

  it('« Ne jamais envoyer » ne dément pas une déclaration déjà envoyée : « vérification en cours » reste affiché', () => {
    const envoyee = { ...declaration('inconnu.fr', 'officiel'), envoi: 'ok' as const };
    expect(determinerStatut(N0, cible('inconnu.fr'), listes(), [envoyee], 'jamais').texte).toBe('Vous avez signalé ce site : vérification en cours');
  });

  it('l\'envoi d\'une autre page n\'y change rien', () => {
    const autre = { ...declaration('autre.fr', 'officiel'), envoi: 'ok' as const };
    expect(determinerStatut(N0, cible('inconnu.fr'), listes(), [autre, declaration('inconnu.fr', 'officiel')]).texte).toBe('Signalement enregistré sur cet ordinateur, pas encore transmis');
  });
});

describe("14.39 point 1 : un hôte validé hors socle ne vaut que M6 ; N1 et N2 l'emportent, le vert seulement si N0", () => {
  const V = (niveau: 'N1' | 'N2'): Verdict => ({ niveau, motif: 'm', marqueDetectee: 'impots-gouv', signauxExposition: [E1] });
  const l = listes({ communautaireValidee: ['www.mairie-exemple.fr'], communautaireMarques: { 'www.mairie-exemple.fr': 'impots-gouv' } });
  it("N2 sur un hôte validé (même rattaché à une marque du socle) : l'alerte N2 s'affiche, pas « Site officiel vérifié »", () => {
    expect(determinerStatut(V('N2'), cible('www.mairie-exemple.fr', 'mairie-exemple.fr'), l, []).code).toBe('n2-imitation');
  });
  it("N1 sur un hôte validé : l'alerte N1 s'affiche aussi (décision de Ph du 07/10), pas « Site officiel vérifié »", () => {
    expect(determinerStatut(V('N1'), cible('www.mairie-exemple.fr', 'mairie-exemple.fr'), l, []).code).toBe('n1-ressemble');
  });
  it('N0 sur un hôte validé : « Site officiel vérifié » avec la marque rattachée', () => {
    expect(determinerStatut(N0, cible('www.mairie-exemple.fr', 'mairie-exemple.fr'), l, [])).toMatchObject({ code: 'officiel-verifie', texte: 'Site officiel vérifié : Impôts / DGFiP' });
  });
  it("un domaine du socle reste « Site officiel vérifié » (l'exemption totale passe par le socle)", () => {
    expect(determinerStatut(N0, cible('www.impots.gouv.fr', 'impots.gouv.fr'), listes(), []).code).toBe('officiel-verifie');
  });
});

describe('14.44 : « répertorié » (corpus public contrôlé), vert pâle, mêmes règles que les validés', () => {
  // 14.47 : un répertorié n'est PAS dans communautaireValidee (pas de M6) ; seulement dans hotesRepertories
  const l = listes({ communautaireValidee: ['www.valide-exemple.fr'], hotesRepertories: ['www.mairie-exemple.fr'] });
  const N1v: Verdict = { niveau: 'N1', motif: 'm', marqueDetectee: 'impots-gouv', signauxExposition: [E1] };
  const N2v: Verdict = { niveau: 'N2', motif: 'm', marqueDetectee: 'impots-gouv', signauxExposition: [E1] };

  it('N0 sur un hôte répertorié : « Site répertorié par Tourmentin (source publique) », vert pâle, distinct du vert', () => {
    expect(determinerStatut(N0, cible('www.mairie-exemple.fr', 'mairie-exemple.fr'), l, [])).toMatchObject({
      code: 'repertorie', texte: 'Site répertorié par Tourmentin (source publique)', couleur: 'vert-pale',
    });
    expect(determinerStatut(N0, cible('www.valide-exemple.fr', 'valide-exemple.fr'), l, [])).toMatchObject({ code: 'officiel-verifie', couleur: 'vert' });
  });
  it('tout N1 ou N2 l\'emporte sur le vert pâle, comme sur le vert', () => {
    expect(determinerStatut(N1v, cible('www.mairie-exemple.fr', 'mairie-exemple.fr'), l, []).code).toBe('n1-ressemble');
    expect(determinerStatut(N2v, cible('www.mairie-exemple.fr', 'mairie-exemple.fr'), l, []).code).toBe('n2-imitation');
  });
  it('hôte exact : ni le domaine enregistrable ni un autre sous-domaine ne sont répertoriés', () => {
    expect(determinerStatut(N0, cible('mairie-exemple.fr'), l, []).code).not.toBe('repertorie');
    expect(determinerStatut(N0, cible('autre.mairie-exemple.fr', 'mairie-exemple.fr'), l, []).code).not.toBe('repertorie');
  });
  it('un frauduleux listé ou un domaine du socle passent avant ; le bouton « Signaler comme site officiel » reste proposé', () => {
    const f = listes({ hotesRepertories: ['x.fr'], hotesFrauduleux: ['x.fr'] });
    expect(determinerStatut(N0, cible('x.fr'), f, []).code).toBe('frauduleux-liste');
    expect(determinerStatut(N0, cible('www.impots.gouv.fr', 'impots.gouv.fr'), listes({ hotesRepertories: ['www.impots.gouv.fr'] }), []).code).toBe('officiel-verifie');
    expect(determinerStatut(N0, cible('www.mairie-exemple.fr', 'mairie-exemple.fr'), l, []).peutSignalerOfficiel).toBe(true);
  });
});

describe('14.33 F : la couche communautaire est lue par hôte exact', () => {
  it('un hôte validé ne valide ni son domaine enregistrable ni un autre sous-domaine', () => {
    const l = listes({ communautaireValidee: ['www.mairie-exemple.fr'] });
    expect(determinerStatut(N0, cible('www.mairie-exemple.fr', 'mairie-exemple.fr'), l, []).code).toBe('officiel-verifie');
    expect(determinerStatut(N0, cible('mairie-exemple.fr'), l, []).code).not.toBe('officiel-verifie');
    expect(determinerStatut(N0, cible('autre.mairie-exemple.fr', 'mairie-exemple.fr'), l, []).code).not.toBe('officiel-verifie');
  });
});
