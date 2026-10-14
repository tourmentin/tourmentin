// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Types du moteur de détection, spec chapitres 4.4 et 5.
// Aucun de ces types ne référence une API navigateur ou un type DOM : ils sont
// remplis par un adaptateur (AdaptateurDOM au MVP, AdaptateurMail en phase 3).

export type NiveauSensibilite = 'prudent' | 'equilibre' | 'strict';

export type NiveauAlerte = 'N0' | 'N1' | 'N2' | 'N3';

/** Famille d'un signal d'imitation, utilisée pour la règle des « deux familles indépendantes » du 5.6. */
export type FamilleImitation = 'textuelle' | 'lexicale-url' | 'visuelle';

/** Famille d'un signal d'exposition. Classement pour l'explicabilité, non utilisé par l'arbre de décision. */
export type FamilleExposition = 'identifiant' | 'formulaire' | 'paiement';

export type FamilleModificateur = 'modificateur';

export interface SignalDeclenche {
  code: string;
  poids: number;
  famille: FamilleImitation | FamilleExposition | FamilleModificateur;
  detail: string;
}

export interface UrlAnalysee {
  href: string;
  /** Hôte brut, ex. "cfspart.impots.gouv.fr" ou une adresse IP littérale. */
  hote: string;
  /** Schéma de l'URL en minuscules, ex. "https", "http", "chrome", "file". */
  schema: string;
  /** Domaine enregistrable au sens de la Public Suffix List, ex. "impots.gouv.fr". */
  domaineEnregistrable: string;
  /** Suffixe public retenu par la PSL pour ce domaine, ex. "gouv.fr". */
  suffixePublic: string;
  /** Labels entre l'hôte et le domaine enregistrable, ex. ["cfspart"]. */
  sousDomaines: string[];
  chemin: string;
  /** Un des labels de l'hôte est encodé en punycode (xn--). */
  punycode: boolean;
  /** L'hôte est une adresse IP littérale (v4 ou v6), pas un nom de domaine. */
  estAdresseIp: boolean;
  /**
   * Date de création du domaine, fournie uniquement par une source RDAP.
   * Absente en mode local (MVP) : M2 (5.5) reste ainsi inactif par construction,
   * sans drapeau de configuration séparé, tant qu'aucun adaptateur ne la renseigne.
   */
  dateCreationDomaine?: number;
}

export interface ChampFormulaire {
  /** Type de champ tel qu'observé, ex. "password", "text", "email", "tel". */
  type: string;
  nom?: string;
  libelle?: string;
  placeholder?: string;
  autocomplete?: string;
  visible: boolean;
  /** Nombre de caractères effectivement saisis par l'utilisateur dans ce champ, pour E4. */
  longueurSaisie?: number;
}

export interface FormulaireNormalise {
  champs: ChampFormulaire[];
  /** Domaine enregistrable de la cible de soumission du formulaire, si connue. */
  actionDomaineEnregistrable?: string;
  /** Le formulaire est rendu dans un iframe dont l'origine diffère de celle de la page. */
  dansIframeCrossOrigin: boolean;
  /** Domaine enregistrable de la frame contenant le formulaire, si différent de celui de la page. */
  domaineFrame?: string;
}

export interface LienNormalise {
  href: string;
  texteAffiche: string;
  domaineEnregistrable: string;
}

/** Comportements d'évasion du 5.9 (lot L8). Le type existe pour la forme d'EntreeAnalyse ; l'arbre du 5.6 ne les consomme pas. */
export type CodeComportement = 'B1' | 'B2' | 'B3' | 'B4';

export interface Comportement {
  code: CodeComportement;
  detail?: string;
}

export interface EntreeAnalyse {
  source: 'page' | 'mail';
  url?: UrlAnalysee;
  /** Phase 3, mail. */
  expediteur?: { affiche: string; reel: string; domaineEnregistrable: string };
  titre: string;
  /** Texte visible normalisé, tronqué à 20 000 caractères en amont par l'adaptateur. */
  texteVisible: string;
  liens: LienNormalise[];
  formulaires: FormulaireNormalise[];
  ressources: {
    faviconHash?: string;
    logosHash: string[];
    couleursDominantes: string[];
  };
  comportements: Comportement[];
  /**
   * Un secret utilisateur a été reconnu à la frappe (6.3) sur un domaine absent
   * de ses domaines autorisés — cette vérification de domaine est déjà faite en
   * amont par le module secrets (lot L7), hors du moteur pur. La seule présence
   * de ce champ signifie donc E5.
   */
  secretReconnu?: { idSecret: string };
  horodatage: number;
}

export interface EmpreinteMarque {
  id: string;
  libelle: string;
  domaines: string[];
  /** 14.12 : domaine enregistrable affiché comme « adresse officielle » par le bandeau N2 — un des domaines enregistrables de la marque, choisi une fois par nous, jamais deviné à l'exécution. */
  domainePrincipal: string;
  termesForts: string[];
  termesFaibles: string[];
  termesSaisie: string[];
  /** Empreintes perceptuelles connues du favicon de la marque. */
  faviconHash: string[];
  couleurs: string[];
  racinesTypo: string[];
  criticite: number;
}

export interface SecretSurveille {
  id: string;
  /** Libellé déclaré par l'utilisateur, comparé aux libellés/noms de champ pour E3. */
  libelle: string;
}

export interface Config {
  sensibilite: NiveauSensibilite;
  /** Alimentent I1 au même poids qu'un terme fort de marque (chapitre 10). */
  motsClesPersonnels: string[];
  /** Alimentent E3 ; la reconnaissance à la frappe (E5) arrive via EntreeAnalyse.secretReconnu. */
  secretsSurveilles: SecretSurveille[];
  /**
   * 14.5, 14.13 point 6 : plafond de la version d'essai. Quand faux, un N3
   * atteint **par le score** (imitation forte et exposition confirmée) est
   * rendu N2 ; les N3 de court-circuit (Z1 domaine révoqué, E5 secret reconnu
   * à la frappe) ne sont jamais plafonnés — ils ne portent pas de marque, et
   * E5 est l'alerte la plus grave du produit. Absent = actif (comportement
   * du moteur seul, mesures de faux positifs comprises).
   */
  n3ParScoreActif?: boolean;
}

export interface Listes {
  /** Empreintes actives uniquement : le filtrage par marque active (chapitre 3) est fait par l'appelant. */
  socle: EmpreinteMarque[];
  /** Domaines enregistrables de la liste de révocation signée (Z1, avant le socle depuis la v1.3). */
  revocation: string[];
  /** Exclusions personnelles de l'utilisateur (Z3). */
  exclusionsPersonnelles: string[];
  /** Hôtes exacts validés par la couche communautaire (M6, statut 4) : 14.33 F, jamais un domaine enregistrable. */
  communautaireValidee: string[];
  /**
   * 14.22 C2 : la couche communautaire porte la marque déclarée. Hôte exact -> id de marque.
   * Lu par l'affichage seulement (statut « officiel vérifié : {marque} »), jamais par le moteur.
   */
  communautaireMarques?: Record<string, string>;
  /**
   * 14.44, 14.47 : hôtes « répertoriés » (corpus public contrôlé). Lu par l'AFFICHAGE seulement (« Site répertorié », vert pâle) :
   PAS M6, la détection est celle d'un site inconnu (décision de Ph, 09/10/2026). Disjoint de `communautaireValidee`.
   */
  hotesRepertories?: string[];
  /**
   * 14.37 point 4 : hôtes exacts confirmés frauduleux (liste signée `frauduleux.json`). Même rang que la
   * révocation (Z1) : N3 immédiat, avant Z2 à Z5. Absent = liste vide.
   */
  hotesFrauduleux?: string[];
  /** Historique local des domaines enregistrables déjà vus par cette installation (M1). */
  domainesDejaVus: string[];
  /** TLD à fort taux d'abus, données embarquées (M5). */
  tldAbusifs: string[];
}

/**
 * Champs communs, renseignés uniquement lorsqu'ils ont effectivement été
 * calculés : un court-circuit Z1-Z5 ou le court-circuit E5 n'a pas besoin de
 * calculer l'axe manquant, et ne doit pas laisser croire à un score mesuré à 0.
 */
/** 14.57 : imitation retenue d'une page précédente du même hôte (la mémoire elle-même, avec sa durée de vie, est gérée hors du moteur). */
export interface ImitationRetenue {
  marque: string;
  scoreImitation: number;
  familles: string[];
}

interface VerdictBase {
  motif: string;
  /** 14.57 : le score d'imitation retenu d'une page précédente du même hôte a été utilisé (max avec celui de cette page). */
  imitationRetenueUtilisee?: ImitationRetenue;
  scoreImitation?: number;
  scoreExposition?: number;
  seuil?: number;
  signauxImitation?: SignalDeclenche[];
  signauxExposition?: SignalDeclenche[];
  modificateursSeuil?: SignalDeclenche[];
  /** Z1 : le verdict vient d'une liste signée de sites frauduleux (révocation ou hôte confirmé), pas d'un calcul. 14.37 point 4 : affiché par le bandeau rouge. */
  signaleParListe?: true;
}

/**
 * 14.12, point 2 : N1 et N2 ne sont atteints que via le score de l'axe
 * d'imitation (evaluerAxeImitation), qui ne renvoie un score non nul
 * qu'accompagné d'une marque (signaux-imitation.ts). `marqueDetectee` est
 * donc garanti sur ces deux niveaux -- le type le porte, pas une chaîne de
 * repli côté interface.
 */
interface VerdictAvecMarque extends VerdictBase {
  niveau: 'N1' | 'N2';
  marqueDetectee: string;
}

/**
 * N0 : jamais de marque exigée. N3 : la plupart du temps une marque (score
 * d'imitation élevé), mais deux voies en produisent sans marque et le type ne
 * doit pas le cacher : Z1 (domaine révoqué, verdict immédiat sans calcul
 * d'axe) et E5 (secret surveillé reconnu à la frappe, indépendant de l'axe
 * d'imitation -- un mot de passe réutilisé sur un site quelconque).
 */
interface VerdictSansMarqueGarantie extends VerdictBase {
  niveau: 'N0' | 'N3';
  marqueDetectee?: string;
}

export type Verdict = VerdictAvecMarque | VerdictSansMarqueGarantie;
