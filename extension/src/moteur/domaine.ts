// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Calcul du domaine enregistrable via la Public Suffix List (5.3, point d'attention).
//
// Bibliothèque choisie : tldts. Justification : une implémentation naïve
// « les deux derniers labels » traiterait impots.gouv.fr comme le sous-domaine
// gouv.fr d'un domaine "fr", alors que gouv.fr est un suffixe public à part
// entière (AFNIC) : le domaine enregistrable réel est impots.gouv.fr. tldts
// embarque la liste complète publicsuffix.org (pas seulement les TLD ICANN nus),
// résout donc correctement ce cas, est activement maintenu, distribué en
// TypeScript typé, et sans dépendance native — vérifié empiriquement avant
// d'écrire ce fichier : impots.gouv.fr -> domain=impots.gouv.fr / publicSuffix
// =gouv.fr, impots-gouv.fr -> domain=impots-gouv.fr / publicSuffix=fr.
import { parse } from 'tldts';

export interface DomaineAnalyse {
  domaineEnregistrable: string;
  suffixePublic: string;
  sousDomaines: string[];
  punycode: boolean;
  estAdresseIp: boolean;
}

const REGEX_IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

function estIpv4(hote: string): boolean {
  if (!REGEX_IPV4.test(hote)) return false;
  return hote.split('.').every((segment) => Number(segment) <= 255);
}

function estIpv6(hote: string): boolean {
  const nu = hote.startsWith('[') && hote.endsWith(']') ? hote.slice(1, -1) : hote;
  return nu.includes(':') && /^[0-9a-fA-F:]+$/.test(nu);
}

/**
 * Analyse un hôte brut (ex. "cfspart.impots.gouv.fr", une IP littérale, ou un
 * hôte sans suffixe public reconnu) et en tire le domaine enregistrable, le
 * suffixe public retenu et les sous-domaines. Fonction pure : aucune requête
 * réseau, tldts travaille sur des données embarquées dans le paquet.
 */
export function analyserHote(hote: string): DomaineAnalyse {
  const hoteNormalise = hote.toLowerCase();

  if (estIpv4(hoteNormalise) || estIpv6(hoteNormalise)) {
    return {
      domaineEnregistrable: hoteNormalise,
      suffixePublic: '',
      sousDomaines: [],
      punycode: false,
      estAdresseIp: true,
    };
  }

  const resultat = parse(hoteNormalise, { allowPrivateDomains: true });
  const domaineEnregistrable = resultat.domain ?? hoteNormalise;
  const suffixePublic = resultat.publicSuffix ?? '';
  const sousDomaines = resultat.subdomain ? resultat.subdomain.split('.').filter(Boolean) : [];
  const punycode = hoteNormalise.split('.').some((label) => label.startsWith('xn--'));

  return { domaineEnregistrable, suffixePublic, sousDomaines, punycode, estAdresseIp: false };
}

/**
 * Le domaine enregistrable de `hote` correspond-il à l'un des domaines connus
 * de la marque (empreinte.domaines, qui peut contenir des sous-domaines) ?
 * Comparaison au niveau du domaine enregistrable, pas de l'hôte complet.
 */
export function appartientAuxDomaines(domaineEnregistrable: string, domainesConnus: string[]): boolean {
  return domainesConnus.some((d) => analyserHote(d).domaineEnregistrable === domaineEnregistrable);
}

/**
 * I8 : "gouv" apparaît comme label ou fragment (séparé par un tiret) de l'hôte
 * en dehors du suffixe public réellement reconnu par la PSL. Distingue
 * impots.gouv.fr (gouv fait partie du suffixe gouv.fr) de impots-gouv.fr et de
 * impots.gouv.fr.securise.com (gouv apparaît hors du suffixe public "fr"/"com").
 */
export function contientTokenHorsSuffixe(hote: string, suffixePublic: string, token: string): boolean {
  const labelsHote = hote.toLowerCase().split('.');
  const labelsSuffixe = suffixePublic ? suffixePublic.toLowerCase().split('.') : [];
  const labelsHorsSuffixe = labelsHote.slice(0, labelsHote.length - labelsSuffixe.length);
  const tokens = labelsHorsSuffixe.flatMap((label) => label.split('-'));
  return tokens.includes(token);
}

/**
 * I7 (heuristique [H]) : un label punycode (xn--) cohabite avec un label
 * purement latin ASCII dans le même hôte. Capture le cas réel d'une
 * substitution homographe portant sur un seul label (ex. le label du nom de
 * marque est encodé, "gouv" et le TLD restent en clair), sans décoder le
 * punycode ni embarquer de table de scripts Unicode — hors de portée d'un
 * signal marqué hypothèse dans la spec, à valider au calibrage du lot L6.
 */
export function possedeLabelPunycodeMeleALatin(hote: string): boolean {
  const labels = hote.toLowerCase().split('.');
  const aUnLabelPunycode = labels.some((l) => l.startsWith('xn--'));
  const aUnLabelLatinPur = labels.some((l) => !l.startsWith('xn--') && /^[a-z0-9-]+$/.test(l));
  return aUnLabelPunycode && aUnLabelLatinPur;
}
