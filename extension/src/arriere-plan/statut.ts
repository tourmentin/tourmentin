// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.20 F, 14.22 C : le statut affiché dans la popup, en langue de
// l'utilisateur. Le niveau N0 à N3 n'y figure pas (il reste dans le journal).
// Fonction pure, hors du moteur : elle ne calcule aucun score et ne change
// aucun seuil, elle choisit un libellé à partir du verdict déjà produit, des
// listes et des déclarations locales de cet utilisateur.
//
// Ordre d'évaluation (14.22 C1) : domaine confirmé frauduleux d'abord, puis
// Z4, Z3, puis le reste de la table de 14.20 F. Le N3 n'a pas de ligne dans la
// table de Ph ; il est placé (libellés acceptés le 30/09) entre le domaine
// frauduleux et « officiel vérifié », pour qu'aucun « vérifié » ne s'affiche
// au-dessus d'une alerte N3.
import { estHorsPerimetre } from '../moteur/analyser.js';
import { appartientAuxDomaines } from '../moteur/domaine.js';
import type { Listes, SignalDeclenche, Verdict } from '../moteur/types.js';
import type { ModeEnvoi } from './reseau.js';
import { typeDeclaration, type EntreeSignalement, type TypeDeclaration } from './signalements.js';
import { TEXTE_JAMAIS_TRANSMIS } from '../ui/confirmation.js';

export type CodeStatut =
  | 'hors-perimetre'
  | 'exclusion-personnelle'
  | 'frauduleux-liste'
  | 'secret-reconnu'
  | 'n3-imitation'
  | 'officiel-verifie'
  | 'repertorie'
  | 'n2-imitation'
  | 'n1-ressemble'
  | 'declare-en-attente'
  | 'inconnu-prudence'
  | 'non-repertorie';

export type CouleurStatut = 'gris' | 'rouge' | 'vert' | 'vert-pale' | 'orange' | 'bleu' | 'jaune';

/** 14.22 C6 : ce que le lien « Détails » de la popup déroule pour N1 — la marque, le motif, les signaux ; jamais le niveau. */
export interface DetailsStatut {
  marque: string;
  motif: string;
  signaux: string[];
}

export interface StatutAffiche {
  code: CodeStatut;
  texte: string;
  couleur: CouleurStatut;
  /** 14.20 G : masqué sur un site officiel vérifié, absent des pages de paiement, et sans objet hors périmètre, exclu ou déjà signalé frauduleux. */
  peutSignalerOfficiel: boolean;
  /** Sans objet seulement hors périmètre (page interne ou locale). */
  peutDeclarerFrauduleuse: boolean;
  /** Déclarations locales de cet utilisateur pour cet hôte, pour ne pas proposer deux fois la même. */
  dejaDeclare: TypeDeclaration[];
  /** La page porte un champ mot de passe visible (E1) : condition du bandeau de connexion (14.22 B). */
  champMotDePasse: boolean;
  /** La page porte un moyen de paiement (E8). */
  pagePaiement: boolean;
  details?: DetailsStatut;
}

export interface CibleStatut {
  hote: string;
  schema: string;
  domaineEnregistrable: string;
}

function libelleMarque(listes: Listes, id: string | undefined): string {
  if (!id) return 'ce service';
  return listes.socle.find((m) => m.id === id)?.libelle ?? id;
}

function estPageDePaiement(verdict: Verdict): boolean {
  return (verdict.signauxExposition ?? []).some((s) => s.famille === 'paiement');
}

function aChampMotDePasse(verdict: Verdict): boolean {
  return (verdict.signauxExposition ?? []).some((s) => s.code === 'E1');
}

function aSaisieSensible(verdict: Verdict): boolean {
  return aChampMotDePasse(verdict) || estPageDePaiement(verdict);
}

function ligneSignal(s: SignalDeclenche): string {
  return `${s.code} : ${s.detail}`;
}

export function determinerStatut(
  verdict: Verdict,
  cible: CibleStatut,
  listes: Listes,
  declarations: EntreeSignalement[],
  modeEnvoi: ModeEnvoi = 'demander',
): StatutAffiche {
  const dejaDeclare = [...new Set(declarations.filter((d) => d.hote === cible.hote).map(typeDeclaration))];
  const paiement = estPageDePaiement(verdict);
  const motDePasse = aChampMotDePasse(verdict);
  const construire = (code: CodeStatut, texte: string, couleur: CouleurStatut, peutSignalerOfficiel: boolean, details?: DetailsStatut): StatutAffiche => ({
    code,
    texte,
    couleur,
    peutSignalerOfficiel: peutSignalerOfficiel && !paiement && !dejaDeclare.includes('officiel'),
    peutDeclarerFrauduleuse: code !== 'hors-perimetre' && !dejaDeclare.includes('frauduleuse'),
    dejaDeclare,
    champMotDePasse: motDePasse,
    pagePaiement: paiement,
    ...(details ? { details } : {}),
  });

  // 3. domaine confirmé frauduleux dans la liste, évalué en premier (14.22 C1 ;
  // aujourd'hui : la liste de révocation, seule liste de ce genre).
  if (listes.revocation.includes(cible.domaineEnregistrable) || (listes.hotesFrauduleux ?? []).includes(cible.hote)) {
    return construire('frauduleux-liste', 'Site frauduleux signalé : quittez cette page', 'rouge', false);
  }
  // 1. Z4
  if (estHorsPerimetre(cible)) return construire('hors-perimetre', 'Tourmentin ne s\'applique pas à cette page', 'gris', false);
  // 2. Z3
  if (listes.exclusionsPersonnelles.includes(cible.domaineEnregistrable)) {
    return construire('exclusion-personnelle', 'Surveillance désactivée par vous sur ce site', 'gris', false);
  }
  // N3 (libellés acceptés le 30/09/2026)
  if (verdict.niveau === 'N3') {
    if ((verdict.signauxExposition ?? []).some((s) => s.code === 'E5')) {
      return construire(
        'secret-reconnu',
        'Vous êtes en train de saisir un secret que vous avez enregistré sur un site qui n\'est pas celui prévu : arrêtez',
        'rouge',
        true,
      );
    }
    if (verdict.marqueDetectee) {
      return construire('n3-imitation', `Imitation quasi certaine de ${libelleMarque(listes, verdict.marqueDetectee)} : quittez cette page`, 'rouge', true);
    }
    return construire('frauduleux-liste', 'Site frauduleux signalé : quittez cette page', 'rouge', false);
  }
  // 4. domaine présent dans la base : le socle, ou validé par un utilisateur de
  // confiance ou un super-utilisateur, avec sa marque déclarée (14.22 C2).
  const marqueDuDomaine = listes.socle.find((m) => appartientAuxDomaines(cible.domaineEnregistrable, m.domaines));
  if (marqueDuDomaine) return construire('officiel-verifie', `Site officiel vérifié : ${marqueDuDomaine.libelle}`, 'vert', false);
  // 14.33 F : par hôte exact. 14.39 point 1 : un hôte validé hors socle ne gagne le vert que si le verdict est N0 ;
  // N1 et N2 l'emportent (le vert complet ne passe que par une mise à jour du socle).
  if (verdict.niveau === 'N0' && listes.communautaireValidee.includes(cible.hote)) {
    const idMarque = listes.communautaireMarques?.[cible.hote];
    const texte = idMarque ? `Site officiel vérifié : ${libelleMarque(listes, idMarque)}` : 'Site officiel vérifié';
    return construire('officiel-verifie', texte, 'vert', false);
  }
  // 4 bis. 14.44, 14.47 : « répertorié » (corpus public contrôlé) : vert pâle, distinct du vert. Affichage seulement : pas de M6, la détection
  // est celle d'un site inconnu ; hôte exact ; le vert pâle ne s'affiche que si le verdict est N0 (N1 et N2 l'emportent).
  if (verdict.niveau === 'N0' && (listes.hotesRepertories ?? []).includes(cible.hote)) {
    return construire('repertorie', 'Site répertorié par Tourmentin (source publique)', 'vert-pale', true);
  }
  // 5. N2
  if (verdict.niveau === 'N2') {
    return construire('n2-imitation', `Imitation probable de ${libelleMarque(listes, verdict.marqueDetectee)} : ne saisissez rien`, 'rouge', true);
  }
  // 6. N1, avec ses détails derrière le lien de la popup
  if (verdict.niveau === 'N1') {
    const marque = libelleMarque(listes, verdict.marqueDetectee);
    return construire(
      'n1-ressemble',
      `Ce site ressemble à ${marque}, mais ce n'est pas son adresse officielle`,
      'orange',
      true,
      {
        marque,
        motif: verdict.motif,
        signaux: [...(verdict.signauxImitation ?? []), ...(verdict.signauxExposition ?? [])].map(ligneSignal),
      },
    );
  }
  // 7. déclaré par cet utilisateur, en attente (jamais avant une alerte : une déclaration ne fait pas taire l'alerte en cours).
  // 14.22 C3 : le libellé dit ce qui est vrai. « Vérification en cours » seulement quand l'envoi a eu lieu (14.26 étape 3).
  if (dejaDeclare.length > 0) {
    const transmise = declarations.some((d) => d.hote === cible.hote && d.envoi === 'ok');
    return construire(
      'declare-en-attente',
      transmise
        ? 'Vous avez signalé ce site : vérification en cours'
        : modeEnvoi === 'jamais'
          ? TEXTE_JAMAIS_TRANSMIS
          : 'Signalement enregistré sur cet ordinateur, pas encore transmis',
      'bleu',
      true,
    );
  }
  // 8 et 9. N0
  if (aSaisieSensible(verdict)) {
    return construire('inconnu-prudence', 'Site inconnu : prudence avant de saisir vos informations', 'jaune', true);
  }
  return construire('non-repertorie', 'Site non répertorié par Tourmentin', 'gris', true);
}

// La boutique d'extensions interdit l'injection de tout script de contenu :
// aucune analyse n'y aura jamais lieu (14.22 A). Vérifié en unitaire seulement.
const HOTES_SANS_INJECTION = new Set(['chromewebstore.google.com']);

function estSansInjection(u: URL): boolean {
  return HOTES_SANS_INJECTION.has(u.hostname.toLowerCase()) || (u.hostname.toLowerCase() === 'chrome.google.com' && u.pathname.startsWith('/webstore'));
}

/**
 * Onglet sans verdict. Avec `host_permissions: <all_urls>`, l'adresse de tout
 * onglet http(s) est lisible ; une adresse illisible ou d'un autre schéma est
 * donc une page interne (chrome://, autre extension) — statut 1 ; de même la
 * boutique d'extensions, où aucun script de contenu ne s'exécute. Une adresse
 * http(s) sans verdict est une analyse pas encore arrivée : pas de statut
 * (`null`) ; c'est à l'appelant de ne pas laisser cet état durer (14.22 A).
 */
export function statutSansVerdict(adresse: string | undefined): StatutAffiche | null {
  let cible: CibleStatut | null = null;
  let boutique = false;
  if (adresse) {
    try {
      const u = new URL(adresse);
      cible = { hote: u.hostname.toLowerCase(), schema: u.protocol.replace(/:$/, ''), domaineEnregistrable: '' };
      boutique = estSansInjection(u);
    } catch {
      cible = null;
    }
  }
  if (cible && !boutique && !estHorsPerimetre(cible)) return null;
  return {
    code: 'hors-perimetre',
    texte: 'Tourmentin ne s\'applique pas à cette page',
    couleur: 'gris',
    peutSignalerOfficiel: false,
    peutDeclarerFrauduleuse: false,
    dejaDeclare: [],
    champMotDePasse: false,
    pagePaiement: false,
  };
}
