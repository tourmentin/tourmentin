// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.7 point 3, 14.19 A2/B : l'aperçu et la confirmation d'une déclaration, communs à la popup et au
// bandeau de connexion — même aperçu, même confirmation (14.22 B). Le texte dit toujours la vérité sur
// ce qui part : rien en mode « Ne jamais envoyer » ; le corps EXACT en mode « Me demander » (avec le choix) et
// en mode « Envoyer automatiquement ».

export type ModeEnvoiAffiche = 'jamais' | 'demander' | 'automatique';

export interface ApercuDeclaration {
  texte: string;
  envoi?: { mode: ModeEnvoiAffiche; corps: string };
}

export interface ResultatConfirmation {
  envoi: 'non' | 'ok' | 'echec';
  erreur?: string;
  /** Réglage « Ne jamais envoyer » : aucun envoi n'était possible (l'aperçu n'a proposé aucun envoi). */
  jamais?: boolean;
}

export const TEXTE_NON_TRANSMIS = 'Signalement enregistré sur cet ordinateur, pas encore transmis.';
/** Décision de Ph (07/10/2026) : sous « Ne jamais envoyer », « pas encore » suggérait un envoi ultérieur qui n'existe pas. */
export const TEXTE_JAMAIS_TRANSMIS = 'Signalement enregistré sur cet ordinateur. Il ne sera pas transmis (réglage « Ne jamais envoyer »).';

const RAISONS: Record<string, string> = {
  'delai-depasse': 'délai dépassé',
  'service-interne': 'le service interne de Tourmentin ne répond pas : rechargez l\'extension dans chrome://extensions',
  reseau: 'serveur injoignable',
  trop_de_requetes: 'trop de demandes, réessayez plus tard',
  espace_plein: 'le serveur est plein',
  signature_invalide: 'signature refusée',
  hote_invalide: 'adresse non acceptée par le serveur',
  paiement_interdit: 'page de paiement : déclaration « officiel » refusée',
};

export function messageResultat(r: ResultatConfirmation): string {
  if (r.envoi === 'ok') return 'Déclaration enregistrée et envoyée à tourmentin.fr : vérification en cours.';
  if (r.envoi === 'echec') return `Déclaration enregistrée sur cet ordinateur. L'envoi a échoué (${RAISONS[r.erreur ?? ''] ?? r.erreur ?? 'raison inconnue'}).`;
  return r.jamais ? TEXTE_JAMAIS_TRANSMIS : TEXTE_NON_TRANSMIS;
}

/**
 * Construit le contenu de confirmation. `confirmer(envoyer)` écrit l'entrée (toujours) et envoie si le
 * réglage l'autorise ; `surTermine` reçoit le résultat.
 */
export function construireConfirmation(
  apercu: ApercuDeclaration,
  confirmer: (envoyer: boolean) => Promise<ResultatConfirmation>,
  surTermine: (r: ResultatConfirmation) => void,
): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const envoi = apercu.envoi;
  const intro = document.createElement('div');
  intro.className = 'confirmation-texte';
  intro.textContent = (envoi ? 'Cette entrée sera écrite sur cet ordinateur :' : 'Rien n\'est envoyé. Cette entrée sera écrite sur cet ordinateur seulement :') + '\n\n' + apercu.texte;
  elements.push(intro);

  if (envoi) {
    const explication = document.createElement('div');
    explication.className = 'confirmation-envoi';
    explication.textContent = envoi.mode === 'automatique'
      ? 'Elle sera aussi envoyée à tourmentin.fr dès que vous confirmez. Voici exactement ce qui partira (jamais ce que vous avez saisi dans les champs) :'
      : 'Voulez-vous aussi l\'envoyer à tourmentin.fr ? Voici exactement ce qui partirait (jamais ce que vous avez saisi dans les champs) :';
    const corps = document.createElement('pre');
    corps.className = 'confirmation-corps';
    corps.textContent = envoi.corps;
    elements.push(explication, corps);
  }

  const lancer = (envoyer: boolean) => async (evenement: Event): Promise<void> => {
    const bouton = evenement.currentTarget as HTMLButtonElement;
    bouton.disabled = true;
    let resultat: ResultatConfirmation;
    try {
      resultat = await confirmer(envoyer);
    } catch {
      resultat = { envoi: 'non' };
    }
    surTermine(envoi ? resultat : { ...resultat, jamais: true });
  };
  const bouton = (id: string, libelle: string, envoyer: boolean): HTMLButtonElement => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = libelle;
    b.addEventListener('click', (e) => void lancer(envoyer)(e));
    return b;
  };
  if (!envoi) {
    elements.push(bouton('bouton-confirmer', 'Confirmer la déclaration', false));
  } else if (envoi.mode === 'automatique') {
    elements.push(bouton('bouton-confirmer', 'Confirmer et envoyer', true));
  } else {
    elements.push(bouton('bouton-confirmer-envoyer', 'Enregistrer et envoyer', true), bouton('bouton-confirmer', 'Enregistrer seulement', false));
  }
  return elements;
}
