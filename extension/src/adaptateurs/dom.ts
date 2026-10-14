// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Livrable 3 du lot L3 : construit un EntreeAnalyse (4.4) depuis un Document.
// Aucune valeur de champ ne traverse cette frontière — voir formulaireDe() :
// seule la LONGUEUR d'une saisie est lue, jamais son contenu (règle 2 de
// CLAUDE.md, critère C7). extension/tests/adaptateurs/dom.test.ts le vérifie
// en inspectant le JSON produit.
import { analyserHote } from '../moteur/domaine.js';
import { contientTerme, normaliser } from '../moteur/texte.js';
import type { ChampFormulaire, EntreeAnalyse, FormulaireNormalise, LienNormalise, UrlAnalysee } from '../moteur/types.js';
import { chargerSocle } from '../listes/chargement.js';
import { extraireTexteVisible } from './texte-visible.js';
import { selectionnerProfond } from './shadow.js';

const CHAMPS_SAISIE = 'input, textarea, select';

// 12.3.3.7 : un champ hors de toute balise <form> était jusqu'ici invisible
// pour Z5, E1 et E2 — pas parce que ces règles mentionnent <form> (elles ne le
// font pas), mais parce que EntreeAnalyse.formulaires ne contenait que les
// champs d'un <form> réel. La vraie mire d'ameli (identifiant seul) et une
// classe entière de sites construits en JavaScript (Wix, Salesforce
// Experience Cloud) échappaient ainsi entièrement à l'axe d'exposition.
//
// Lexique de saisie (E2) : union des termesSaisie de toutes les empreintes
// actives, calculée une fois. Champ hors formulaire à part : chargerSocle()
// duplique dans le bundle du content script les quelques mots que E2 compare
// déjà côté service worker (~30 courtes chaînes, pas les empreintes
// complètes) — c'est le prix pour que l'adaptateur puisse juger un champ
// sans attendre le verdict du moteur.
const TERMES_SAISIE_NORMALISES = [...new Set(chargerSocle().flatMap((e) => e.termesSaisie))].map(normaliser);

const TYPES_RETENUS_HORS_FORM = new Set(['password', 'email', 'tel']);
const AUTOCOMPLETE_RETENUS_HORS_FORM = new Set(['username', 'email', 'current-password', 'one-time-code']);
const NOMS_RECHERCHE = new Set(['q', 's', 'query', 'search', 'recherche']);

function vide(s: string | null | undefined): string | undefined {
  return s ? s : undefined;
}

function urlDe(document: Document): UrlAnalysee | undefined {
  const location = document.defaultView?.location ?? document.location;
  if (!location) return undefined;

  const schema = location.protocol.replace(':', '').toLowerCase();
  const hote = location.hostname.toLowerCase();
  const analyse = analyserHote(hote);

  return {
    href: location.href,
    hote,
    schema,
    domaineEnregistrable: analyse.domaineEnregistrable,
    suffixePublic: analyse.suffixePublic,
    sousDomaines: analyse.sousDomaines,
    chemin: location.pathname,
    punycode: analyse.punycode,
    estAdresseIp: analyse.estAdresseIp,
  };
}

function libelleDe(champ: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string | undefined {
  const ariaLabel = vide(champ.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel;

  // .labels vaut null pour input[type=hidden] (HTML Living Standard) : un
  // champ non labelable par nature, pas un cas défensif improbable.
  const labels = champ.labels;
  if (labels && labels.length > 0) {
    // Element.textContent n'est jamais null (seul Document/DocumentType le sont) :
    // l'assertion documente cette garantie plutôt que d'introduire une branche morte.
    const texte = Array.from(labels)
      .map((l) => (l.textContent as string).trim())
      .filter(Boolean)
      .join(' ');
    if (texte) return texte;
  }

  const idLabelledBy = champ.getAttribute('aria-labelledby');
  if (idLabelledBy) {
    const texte = idLabelledBy
      .split(/\s+/)
      .map((id) => {
        const cible = champ.ownerDocument.getElementById(id);
        return cible ? (cible.textContent as string).trim() : '';
      })
      .filter(Boolean)
      .join(' ');
    if (texte) return vide(texte);
  }

  return undefined;
}

function champDe(element: Element): ChampFormulaire {
  const e = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const tag = e.tagName.toLowerCase();
  const type = tag === 'input' ? (e as HTMLInputElement).type.toLowerCase() : tag;

  const style = e.ownerDocument.defaultView?.getComputedStyle(e);
  // Taille déclarée nulle (largeur ou hauteur à 0) : jointe au masquage
  // classique (12.3.3.7) — un champ de taille nulle n'est visible d'aucune
  // manière, dans un <form> ou hors formulaire. Sur une déclaration
  // explicite (style width/height), jamais sur la géométrie calculée
  // (getBoundingClientRect) : jsdom ne met rien en page et y renverrait
  // toujours 0, ce qui masquerait tout à tort dans les tests.
  const tailleNulle = style?.width === '0px' || style?.height === '0px';
  const masque = e.hasAttribute('hidden') || type === 'hidden' || style?.display === 'none' || style?.visibility === 'hidden' || tailleNulle;

  const longueurSaisie = 'value' in e && tag !== 'select' ? (e as HTMLInputElement | HTMLTextAreaElement).value.length : undefined;

  return {
    type,
    nom: vide(e.getAttribute('name')),
    libelle: libelleDe(e),
    placeholder: 'placeholder' in e ? vide((e as HTMLInputElement).placeholder) : undefined,
    autocomplete: vide(e.getAttribute('autocomplete')),
    visible: !masque,
    longueurSaisie,
  };
}

function domaineDeAction(form: HTMLFormElement): string | undefined {
  const action = form.getAttribute('action');
  // Un formulaire sans action (ou vide) soumet vers la page courante : ce
  // n'est pas un domaine "différent" pour E6, pas la peine de le résoudre.
  if (action === null || action.trim() === '') return undefined;
  try {
    const url = new URL(form.action, form.ownerDocument.location?.href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return analyserHote(url.hostname.toLowerCase()).domaineEnregistrable;
  } catch {
    return undefined;
  }
}

function formulaireDe(form: HTMLFormElement): FormulaireNormalise {
  return {
    champs: selectionnerProfond(form, CHAMPS_SAISIE).map(champDe),
    actionDomaineEnregistrable: domaineDeAction(form),
    // Cette frame ne sait pas si elle est elle-même dans une iframe
    // cross-origin par rapport à une autre : c'est le service worker qui le
    // détermine en agrégeant les frames d'un même onglet (6.5, arriere-plan/fusion.ts).
    dansIframeCrossOrigin: false,
  };
}

// --- formulaires implicites (12.3.3.7) --------------------------------------

function estDansFormulaire(e: Element): boolean {
  return e.closest('form') !== null;
}

function estChampRecherche(e: Element, champ: ChampFormulaire): boolean {
  if (champ.type === 'search') return true;
  if (e.closest('[role="search"]')) return true;
  const nom = (champ.nom ?? '').toLowerCase();
  const id = (e.getAttribute('id') ?? '').toLowerCase();
  return NOMS_RECHERCHE.has(nom) || NOMS_RECHERCHE.has(id);
}

function correspondAUnTermeDeSaisie(champ: ChampFormulaire): boolean {
  const texte = normaliser([champ.libelle, champ.nom, champ.placeholder].filter(Boolean).join(' '));
  if (!texte) return false;
  return TERMES_SAISIE_NORMALISES.some((terme) => texte.includes(terme));
}

type RaisonRetenue = 'type' | 'autocomplete' | 'lexique';

function raisonRetenueHorsFormulaire(champ: ChampFormulaire): RaisonRetenue | undefined {
  if (TYPES_RETENUS_HORS_FORM.has(champ.type)) return 'type';
  if (champ.autocomplete && AUTOCOMPLETE_RETENUS_HORS_FORM.has(champ.autocomplete.toLowerCase())) return 'autocomplete';
  if (correspondAUnTermeDeSaisie(champ)) return 'lexique';
  return undefined;
}

interface CandidatHorsFormulaire {
  element: Element;
  champ: ChampFormulaire;
  raison: RaisonRetenue;
}

/**
 * Champs hors de toute balise `<form>` porteurs d'un sens d'identification ou
 * de secret (12.3.3.7). Écarte les champs de recherche, masqués ou de taille
 * nulle, puis le cas de la lettre d'information isolée : un seul candidat sur
 * toute la page, retenu par son seul type email/tel — sans autocomplete
 * d'identification ni terme de saisie d'une empreinte — n'est pas un champ
 * d'identification, c'est le motif dominant d'un simple champ d'inscription.
 */
function candidatsHorsFormulaire(document: Document): CandidatHorsFormulaire[] {
  const candidats: CandidatHorsFormulaire[] = [];
  for (const e of selectionnerProfond(document, CHAMPS_SAISIE)) {
    if (estDansFormulaire(e)) continue;
    const champ = champDe(e);
    if (!champ.visible || estChampRecherche(e, champ)) continue;
    const raison = raisonRetenueHorsFormulaire(champ);
    if (raison) candidats.push({ element: e, champ, raison });
  }
  const seul = candidats.length === 1 ? candidats[0] : undefined;
  if (seul && seul.raison === 'type' && seul.champ.type !== 'password') {
    return [];
  }
  return candidats;
}

function ancetres(e: Element): Element[] {
  const chaine: Element[] = [];
  for (let n = e.parentElement; n; n = n.parentElement) chaine.push(n);
  return chaine;
}

/**
 * Plus proche ancêtre commun à deux champs, à condition qu'il soit plus
 * spécifique que `<body>`/`<html>` — au-delà, deux champs n'ont plus rien de
 * commun qui justifie de les regrouper dans le même formulaire implicite.
 */
function partagentUnAncetreSignificatif(a: Element, b: Element): boolean {
  const ensembleA = new Set(ancetres(a));
  for (const n of ancetres(b)) {
    if (ensembleA.has(n)) return n.tagName !== 'BODY' && n.tagName !== 'HTML';
  }
  return false;
}

/** Union-Find : un formulaire implicite par plus proche ancêtre commun visible (12.3.3.7). */
function regrouperEnFormulairesImplicites(candidats: CandidatHorsFormulaire[]): ChampFormulaire[][] {
  const parent = candidats.map((_, i) => i);
  function trouver(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }
  for (let i = 0; i < candidats.length; i++) {
    for (let j = i + 1; j < candidats.length; j++) {
      if (partagentUnAncetreSignificatif(candidats[i]!.element, candidats[j]!.element)) {
        parent[trouver(i)] = trouver(j);
      }
    }
  }
  const groupes = new Map<number, ChampFormulaire[]>();
  candidats.forEach((c, i) => {
    const racine = trouver(i);
    groupes.set(racine, [...(groupes.get(racine) ?? []), c.champ]);
  });
  return [...groupes.values()];
}

function formulairesImplicites(document: Document): FormulaireNormalise[] {
  return regrouperEnFormulairesImplicites(candidatsHorsFormulaire(document)).map((champs) => ({
    champs,
    // Sans balise <form>, il n'y a pas d'attribut action à résoudre (E6) ; la
    // frontière d'iframe cross-origin reste, comme pour un <form> réel, du
    // ressort du service worker (fusion.ts).
    actionDomaineEnregistrable: undefined,
    dansIframeCrossOrigin: false,
  }));
}

function lienDe(a: HTMLAnchorElement): LienNormalise | null {
  let url: URL;
  try {
    url = new URL(a.href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return {
    href: a.href,
    texteAffiche: (a.textContent as string).trim(),
    domaineEnregistrable: analyserHote(url.hostname.toLowerCase()).domaineEnregistrable,
  };
}

export function construireEntreeAnalyse(document: Document): EntreeAnalyse {
  return {
    source: 'page',
    url: urlDe(document),
    titre: document.title,
    texteVisible: extraireTexteVisible(document),
    liens: selectionnerProfond<HTMLAnchorElement>(document, 'a[href]')
      .map(lienDe)
      .filter((l): l is LienNormalise => l !== null),
    formulaires: [
      ...selectionnerProfond<HTMLFormElement>(document, 'form').map(formulaireDe),
      ...formulairesImplicites(document),
    ],
    ressources: {
      // Empreinte de favicon et couleurs dominantes : analyse d'image, non
      // implémentée à ce lot (favicon_hash lui-même n'est rempli qu'au lot
      // L5, cf. listes/outils/schema.ts). I5 et I6 restent inertes jusque-là.
      logosHash: [],
      couleursDominantes: [],
    },
    // Signaux comportementaux du 5.9 : lot L8.
    comportements: [],
    horodatage: Date.now(),
  };
}
