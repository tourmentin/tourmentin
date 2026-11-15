// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.6 point c : interrupteur du journal (désactivé par défaut), vue du
// journal, liste des signalements séparée avec effacement individuel,
// export manuel en JSON lisible (14.11 rang 2, export.ts).
import type { MessageDepuisArrierePlan, MessageDepuisContenu } from '../messages.js';
import type { EntreeJournal } from '../arriere-plan/journal.js';
import { construireExport, nomFichierExport, type TypeExport } from '../arriere-plan/export.js';
import { versionSocle } from '../listes/chargement.js';
import { lireEtatPublication } from '../arriere-plan/publication.js';
import { URL_PUBLICATION } from '../version-publication.js';
import type { ModeAvertissement } from '../arriere-plan/bandeau-connexion.js';
import type { ModeEnvoi } from '../arriere-plan/reseau.js';
import { BUILD_DE_MESURE } from '../version-essai.js';

import { demander, texteErreur, verifierService } from '../ui/service-worker.js';
import { verifierEd25519 } from '../ui/compatibilite.js';

// 14.43 : alerte unique en tête de page quand le service interne ne répond pas ou n'est pas de la même construction.
const alerteService = document.getElementById('alerte-service')!;
function signalerProbleme(texte: string): void {
  alerteService.textContent = texte;
  alerteService.hidden = false;
}
void verifierService().then((v) => {
  if (!v.ok) signalerProbleme(v.texte);
});

/** Message sans réponse attendue côté page (effacements) ; un échec est dit, jamais avalé. */
async function lancer(message: MessageDepuisContenu): Promise<void> {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (e) {
    signalerProbleme(texteErreur(e));
  }
}

/** Charge une donnée du service worker ; sans réponse exploitable, le dit et rend `null`. */
async function charger<T extends MessageDepuisArrierePlan['type']>(message: MessageDepuisContenu, attendu: T): Promise<Extract<MessageDepuisArrierePlan, { type: T }> | null> {
  try {
    return await demander(message, attendu);
  } catch (e) {
    signalerProbleme(texteErreur(e));
    return null;
  }
}

// 14.43 point 3 : « Enregistré » pendant 2 secondes à côté du réglage qui vient de changer ; en cas d'échec, un message d'erreur
// qui reste affiché jusqu'au prochain changement.
const AFFICHAGE_ENREGISTRE_MS = 2000;
const minuteursEnregistre = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
async function enregistrerReglage(message: Extract<MessageDepuisContenu, { type: 'ECRIRE_REGLAGES' }>, zone: HTMLElement): Promise<void> {
  clearTimeout(minuteursEnregistre.get(zone));
  zone.className = 'enregistre';
  zone.textContent = '';
  try {
    const r = await demander(message, 'REGLAGES_ECRITS');
    if (!r.ok) throw new Error('refus');
    zone.textContent = 'Enregistré';
    minuteursEnregistre.set(zone, setTimeout(() => { zone.textContent = ''; }, AFFICHAGE_ENREGISTRE_MS));
  } catch (e) {
    zone.className = 'enregistre erreur';
    zone.textContent = `Réglage non enregistré. ${e instanceof Error && e.message === 'refus' ? 'Le service interne a échoué ; réessayez.' : texteErreur(e)}`;
  }
}

// 14.15 point 1 : le build de mesure s'annonce en tête de page.
document.getElementById('annonce-mesure')!.hidden = !BUILD_DE_MESURE;

// 14.6 point e : bascule entre l'écran de premier lancement et les
// paramètres, par le seul hash de l'URL -- pas une page distincte (voir la
// note dans options.html).
const vuePremierLancement = document.getElementById('vue-premier-lancement')!;
const vueVerifier = document.getElementById('vue-verifier')!;
const vueParametres = document.getElementById('vue-parametres')!;

// Trois vues statiques d'une même page, choisies par le seul hash ; toute
// autre valeur — et l'absence de hash — donne les paramètres.
function afficherVueDepuisHash(): void {
  const premierLancement = location.hash === '#premier-lancement';
  const verifier = location.hash === '#verifier';
  vuePremierLancement.hidden = !premierLancement;
  vueVerifier.hidden = !verifier;
  vueParametres.hidden = premierLancement || verifier;
}
window.addEventListener('hashchange', afficherVueDepuisHash);
afficherVueDepuisHash();

document.getElementById('bouton-compris')!.addEventListener('click', () => {
  location.hash = '#parametres';
});

const interrupteurJournal = document.getElementById('interrupteur-journal') as HTMLInputElement;
const modeAvertissement = document.getElementById('mode-avertissement') as HTMLSelectElement;
const radiosModeEnvoi = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="mode-envoi"]'));
const etatLiaison = document.getElementById('etat-liaison')!;
const champCode = document.getElementById('code-liaison') as HTMLInputElement;
const resultatLiaison = document.getElementById('resultat-liaison')!;
const boutonEffacerJournal = document.getElementById('effacer-journal') as HTMLButtonElement;
const corpsTableJournal = document.querySelector('#table-journal tbody')!;

function ligneVide(colonnes: number): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = colonnes;
  td.className = 'vide';
  td.textContent = 'Aucune entrée.';
  tr.append(td);
  return tr;
}

function adresseLisible(entree: { schema: string; hote: string; chemin: string; requetePresente: boolean }): string {
  return `${entree.schema}://${entree.hote}${entree.chemin}${entree.requetePresente ? ' …' : ''}`;
}

async function chargerReglages(): Promise<void> {
  const reponse = await charger({ type: 'LIRE_REGLAGES' }, 'REGLAGES');
  if (!reponse) return;
  interrupteurJournal.checked = reponse.journalActif;
  modeAvertissement.value = reponse.avertirConnexion;
  for (const radio of radiosModeEnvoi) radio.checked = radio.value === reponse.modeEnvoi;
}

for (const radio of radiosModeEnvoi) {
  radio.addEventListener('change', () => {
    if (radio.checked) void enregistrerReglage({ type: 'ECRIRE_REGLAGES', modeEnvoi: radio.value as ModeEnvoi }, document.getElementById('enregistre-mode-envoi')!);
  });
}

const LIBELLES_ROLE: Record<string, string> = { utilisateur: 'utilisateur', confiance: 'utilisateur de confiance', super: 'super-utilisateur' };

async function afficherLiaison(): Promise<void> {
  const r = await charger({ type: 'LIRE_LIAISON' }, 'LIAISON_ETAT');
  if (!r) {
    etatLiaison.textContent = 'État de la liaison indisponible : le service interne de Tourmentin ne répond pas.';
    return;
  }
  etatLiaison.textContent = r.lie
    ? `Ce navigateur est lié à un compte tourmentin.fr${r.role ? ` (rôle : ${LIBELLES_ROLE[r.role] ?? r.role}, tel que le serveur l'a dit)` : ''}.`
    : "Ce navigateur n'est lié à aucun compte.";
}

document.getElementById('lier')!.addEventListener('click', async () => {
  const code = champCode.value.trim();
  if (code === '') {
    resultatLiaison.textContent = "Collez d'abord le code de liaison.";
    return;
  }
  resultatLiaison.textContent = 'Liaison en cours…';
  let r: Extract<MessageDepuisArrierePlan, { type: 'LIAISON' }>;
  try {
    // un seul essai : une liaison ne se rejoue pas (le code est à usage unique) ; la requête vers le serveur est bornée à 10 s
    r = await demander({ type: 'LIER_COMPTE', code }, 'LIAISON', { essais: 1, delaiMs: 20000 });
  } catch (e) {
    resultatLiaison.textContent = texteErreur(e);
    return;
  }
  if (r.ok) {
    champCode.value = '';
    resultatLiaison.textContent = `Liaison réussie. Rôle : ${LIBELLES_ROLE[r.role ?? ''] ?? r.role}.`;
  } else {
    resultatLiaison.textContent = r.erreur === 'envoi-desactive'
      ? 'Le réglage est « Ne jamais envoyer » : aucune requête ne part. Changez-le pour lier un compte.'
      : `Liaison refusée (${r.erreur ?? 'raison inconnue'}).`;
  }
  await afficherLiaison();
});

document.getElementById('delier')!.addEventListener('click', async () => {
  const r = await charger({ type: 'DELIER_COMPTE' }, 'LIAISON_ETAT');
  resultatLiaison.textContent = r
    ? "Ce navigateur est délié (aucune requête n'a été envoyée ; le serveur garde l'ancienne entrée)."
    : 'La déliaison a échoué : le service interne de Tourmentin ne répond pas.';
  await afficherLiaison();
});
void afficherLiaison();

modeAvertissement.addEventListener('change', () => {
  void enregistrerReglage({ type: 'ECRIRE_REGLAGES', avertirConnexion: modeAvertissement.value as ModeAvertissement }, document.getElementById('enregistre-avertissement')!);
});

interrupteurJournal.addEventListener('change', () => {
  void enregistrerReglage({ type: 'ECRIRE_REGLAGES', journalActif: interrupteurJournal.checked }, document.getElementById('enregistre-journal')!);
});

async function chargerJournal(): Promise<void> {
  const reponse = await charger({ type: 'LIRE_JOURNAL' }, 'JOURNAL');
  if (!reponse) return;
  corpsTableJournal.replaceChildren();
  if (reponse.entrees.length === 0) { corpsTableJournal.append(ligneVide(4)); return; }
  for (const entree of [...reponse.entrees].reverse()) corpsTableJournal.append(ligneJournal(entree));
}

/** Libellés lisibles des niveaux, dans les mots de la page d'accueil (affichage seulement : les données et l'export gardent N0 à N3). */
const LIBELLES_NIVEAU: Record<string, string> = {
  N0: 'Site non répertorié par Tourmentin',
  N1: 'Site inconnu : prudence avant de saisir vos informations',
  N2: 'Imitation probable : ne saisissez rien',
  N3: 'Imitation quasi certaine : quittez la page',
};
const niveauLisible = (niveau: string): string => LIBELLES_NIVEAU[niveau] ?? niveau;

function ligneJournal(entree: EntreeJournal): HTMLTableRowElement {
  const tr = document.createElement('tr');
  for (const valeur of [entree.horodatage, adresseLisible(entree), niveauLisible(entree.niveau), entree.motif]) {
    const td = document.createElement('td');
    td.textContent = valeur;
    tr.append(td);
  }
  return tr;
}

boutonEffacerJournal.addEventListener('click', async () => {
  await lancer({ type: 'EFFACER_JOURNAL' });
  await chargerJournal();
});

void chargerReglages();
void chargerJournal();
void afficherCompteurs();

// 14.11 rang 2 : export manuel. Geste délibéré du testeur (14.1) : le fichier
// est produit ici, localement, par un lien de téléchargement — aucune requête,
// aucune permission supplémentaire (`downloads` non requise).
// 14.39 point 4 : texte du premier lancement sur le téléchargement des listes, seulement dans un build qui télécharge.
document.getElementById('information-listes-premier-lancement')!.hidden = URL_PUBLICATION === '';

// 14.33 F : état des listes signées, lu sur cet ordinateur (aucune requête depuis cette page).
const LIBELLE_REJET: Record<string, string> = {
  reseau: 'téléchargement impossible', cle: 'clé de vérification absente ou invalide', taille: 'fichier trop gros', json: 'fichier illisible', format: 'format invalide',
  liste: 'mauvais type de liste', entree: 'entrée invalide', signature: 'signature invalide, liste ignorée', 'retour-arriere': 'version plus ancienne que celle appliquée, ignorée',
};
void (async () => {
  const cible = document.getElementById('etat-listes')!;
  if (URL_PUBLICATION === '') {
    cible.textContent = 'Cette version ne télécharge aucune liste signée.';
    return;
  }
  // 14.37 point 5 : texte de Ph, affiché seulement dans un build qui télécharge réellement.
  document.getElementById('information-listes')!.hidden = false;
  const etat = await lireEtatPublication();
  const ligne = (nom: 'officiels' | 'frauduleux'): string => {
    const l = etat[nom];
    const rejet = etat.rejets?.[nom];
    const nbRepertories = l ? l.entrees.filter((e) => e.statut === 'repertorie').length : 0;
    const base = l ? `${nom} : version ${l.version}, ${l.entrees.length} hôte(s)${nbRepertories > 0 ? ` (dont ${nbRepertories} répertoriés)` : ''}, vérifiée le ${(etat.verifieLe?.[nom] ?? '').slice(0, 10)}` : `${nom} : pas encore reçue`;
    return rejet ? `${base} — dernier problème : ${LIBELLE_REJET[rejet] ?? rejet}` : base;
  };
  cible.textContent = `${ligne('officiels')}. ${ligne('frauduleux')}.`;
})();

// 14.19 E : `version_name` (« spec X.YY · hash ») identifie la construction, `version` seule ne le ferait pas.
const manifeste = chrome.runtime.getManifest();
const versions = { extension: manifeste.version, socle: versionSocle() };
document.getElementById('versions')!.textContent = `Tourmentin ${manifeste.version} (${manifeste.version_name ?? 'construction inconnue'}) — socle ${versions.socle}`;

async function telecharger(type: TypeExport, entrees: EntreeJournal[]): Promise<void> {
  const maintenant = new Date();
  const bandeaux = ((await chrome.storage.local.get('bandeauxParJour')).bandeauxParJour ?? {}) as Record<string, number>;
  const blob = new Blob([construireExport(type, entrees, versions, maintenant, bandeaux)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichierExport(type, maintenant);
  document.body.append(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(url);
}

document.getElementById('exporter-journal')!.addEventListener('click', async () => {
  const reponse = await charger({ type: 'LIRE_JOURNAL' }, 'JOURNAL');
  if (reponse) await telecharger('journal', reponse.entrees);
});


// 14.84 : compteurs et partage. Aucune requête ici, sauf la question « proposition ? » faite par le service worker (réglage d'envoi permettant, au moins une déclaration envoyée).
const URL_PARTAGE = 'https://tourmentin.fr/';
async function afficherCompteurs(): Promise<void> {
  const commun = document.getElementById('compteur-commun')!;
  if (URL_PUBLICATION === '') {
    commun.textContent = 'Cette version ne télécharge aucune liste : pas de compteur.';
  } else {
    const etat = await lireEtatPublication();
    const nb = etat.officiels ? new Set(etat.officiels.entrees.map((e) => e.hote)).size : 0;
    commun.textContent = nb > 0 ? `Grâce à la communauté, ${nb} sites sont déjà vérifiés et protègent tous les utilisateurs de Tourmentin.` : "La liste des sites vérifiés n'est pas encore arrivée sur cet ordinateur.";
  }
  const c = await charger({ type: 'LIRE_CONTRIBUTION' }, 'CONTRIBUTION');
  const cible = document.getElementById('compteur-declarations')!;
  if (!c) return;
  cible.textContent = c.declarees === 0
    ? "Vous n'avez encore déclaré aucun site comme étant fiable. Sur la page d'un site que vous connaissez bien, ouvrez Tourmentin et choisissez « Signaler comme site officiel »."
    : `Vous avez déclaré ${c.declarees} site${c.declarees > 1 ? 's' : ''} comme étant fiable${c.declarees > 1 ? 's' : ''} (${c.envoyees} envoyé${c.envoyees > 1 ? 's' : ''} à tourmentin.fr). Continuez, avec soin : une seule erreur et l'équipe ne vous proposera pas le compte.`;
  const bloc = document.getElementById('bloc-confiance')!;
  bloc.hidden = !c.proposee;
  if (c.proposee) {
    const sujet = encodeURIComponent('Utilisateur de confiance Tourmentin');
    const corps = encodeURIComponent(`Bonjour, j'accepte votre proposition de devenir utilisateur de confiance. Mon code : ${c.code ?? ''}`);
    (document.getElementById('bouton-confiance') as HTMLAnchorElement).href = `mailto:contact@tourmentin.fr?subject=${sujet}&body=${corps}`;
  }
}

const boutonPartager = document.getElementById('partager') as HTMLButtonElement;
const resultatPartage = document.getElementById('resultat-partage')!;
boutonPartager.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(URL_PARTAGE);
    resultatPartage.textContent = 'Lien copié : collez-le dans un message.';
  } catch {
    resultatPartage.textContent = `Copie impossible ici. Le lien : ${URL_PARTAGE}`;
  }
});
(document.getElementById('partager-courriel') as HTMLAnchorElement).href =
  `mailto:?subject=${encodeURIComponent('Un outil gratuit contre les faux sites')}&body=${encodeURIComponent(`Bonjour, j'utilise Tourmentin, une extension gratuite qui prévient quand une page imite un site officiel (impôts, banque, Ameli…). Pour protéger les proches, je te conseille de l'installer : ${URL_PARTAGE}`)}`;

// Un navigateur qui ne sait pas signer (Ed25519) empêche toute déclaration : on le dit en haut de la section, sinon on n'affiche rien.
void verifierEd25519().then((ed) => {
  if (ed.ok) return;
  const alerte = document.getElementById('compat-alerte')!;
  alerte.textContent = `Ce navigateur ne permet pas à Tourmentin de signer ses envois (${ed.texte}) : les déclarations à tourmentin.fr ne fonctionneront pas.`;
  alerte.hidden = false;
});
