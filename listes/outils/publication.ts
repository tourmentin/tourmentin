// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Chaîne de publication signée hors ligne (spec 14.33, 14.19 D4). Fonctions pures : elles ne lisent ni le
// disque, ni l'environnement, ni la clé. La clé privée vient de cle.ts, les entrées-sorties de publier.ts.
// Ce module ne tourne que sur le PC de Ph ; rien d'ici n'est jamais déployé sur le serveur.
import { sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

export type NomListe = 'officiels' | 'frauduleux';

export interface EntreeOfficiel {
  hote: string;
  marque?: string;
  /** 14.44 : absent = validé ; « repertorie » = corpus public contrôlé (sans marque). */
  statut?: 'repertorie';
  valide_le: string;
}
export interface EntreeFrauduleux {
  hote: string;
  portee: 'hote';
  confirme_le: string;
}
export interface ListePubliee<E> {
  liste: NomListe;
  version: string;
  genere_le: string;
  entrees: E[];
  signature: string;
}
export interface ExportServeur {
  officiels: { hote: string; marque: string | null; valide_le: string; statut?: 'repertorie' }[];
  frauduleux: { hote: string; portee: string; confirme_le: string }[];
}

const HOTE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = /^(\d{4})\.(\d{2})\.(\d{3})$/;

/** 14.33 D : le nom de la liste est dans les octets signés (un fichier ne peut pas être rejoué sous un autre nom). */
export function octetsSignes(liste: NomListe, version: string, genere_le: string, entrees: unknown[]): Buffer {
  return Buffer.from(`tmt-liste-v1\n${liste}\n${JSON.stringify({ version, genere_le, entrees })}`, 'utf8');
}

/** Valide l'export du back-office. Renvoie la liste des problèmes (vide = conforme) ; ne corrige rien. */
export function validerExport(brut: unknown, marquesConnues: ReadonlySet<string>): { export?: ExportServeur; problemes: string[] } {
  const problemes: string[] = [];
  if (typeof brut !== 'object' || brut === null) return { problemes: ['l\'export n\'est pas un objet JSON'] };
  const o = brut as Record<string, unknown>;
  if (!Array.isArray(o.officiels) || !Array.isArray(o.frauduleux)) return { problemes: ['l\'export doit contenir « officiels » et « frauduleux » (tableaux)'] };
  const vus = new Set<string>();
  const verifierHote = (genre: string, i: number, hote: unknown, date: unknown, champDate: string): string | null => {
    const nom = `${genre}[${i}]`;
    if (typeof hote !== 'string' || !HOTE.test(hote)) {
      problemes.push(`${nom} : hôte invalide (minuscules, sans générique, au moins deux étiquettes)`);
      return null;
    }
    if (typeof date !== 'string' || !DATE.test(date)) problemes.push(`${nom} (${hote}) : ${champDate} invalide`);
    if (vus.has(hote)) problemes.push(`${nom} : hôte en double (${hote}), ou à la fois officiel et frauduleux`);
    vus.add(hote);
    return hote;
  };
  const officiels = o.officiels.map((e: Record<string, unknown>, i: number) => {
    const hote = verifierHote('officiels', i, e?.hote, e?.valide_le, 'valide_le');
    const marque = e?.marque;
    if (marque !== null && marque !== undefined && (typeof marque !== 'string' || !marquesConnues.has(marque))) {
      problemes.push(`officiels[${i}] (${String(hote)}) : marque inconnue du socle`);
    }
    const statut = e?.statut;
    if (statut !== undefined && statut !== 'repertorie') {
      problemes.push(`officiels[${i}] (${String(hote)}) : statut « ${String(statut)} » inconnu (absent = validé, ou « repertorie »)`);
    }
    if (statut === 'repertorie' && typeof marque === 'string') {
      problemes.push(`officiels[${i}] (${String(hote)}) : un répertorié n'a pas de marque`);
    }
    return { hote: hote ?? '', marque: typeof marque === 'string' ? marque : null, valide_le: String(e?.valide_le ?? ''), ...(statut === 'repertorie' ? { statut: 'repertorie' as const } : {}) };
  });
  const frauduleux = o.frauduleux.map((e: Record<string, unknown>, i: number) => {
    const hote = verifierHote('frauduleux', i, e?.hote, e?.confirme_le, 'confirme_le');
    if (e?.portee !== 'hote') {
      problemes.push(`frauduleux[${i}] (${String(hote)}) : la portée « ${String(e?.portee)} » est refusée à cette étape (seule « hote » est émise, 14.33 D)`);
    }
    return { hote: hote ?? '', portee: String(e?.portee ?? ''), confirme_le: String(e?.confirme_le ?? '') };
  });
  return problemes.length > 0 ? { problemes } : { export: { officiels, frauduleux }, problemes };
}

/** « AAAA.MM.NNN » suivant : même mois = numéro + 1, sinon 001. Refuse un mois antérieur à la version précédente. */
export function versionSuivante(precedente: string | null, maintenant: Date): string {
  const mois = `${maintenant.getUTCFullYear()}.${String(maintenant.getUTCMonth() + 1).padStart(2, '0')}`;
  if (precedente === null) return `${mois}.001`;
  const m = VERSION.exec(precedente);
  if (!m) throw new Error(`version précédente illisible : ${precedente}`);
  const prec = `${m[1]}.${m[2]}`;
  if (prec > mois) throw new Error(`la version précédente (${precedente}) est postérieure à ce mois : horloge fausse ?`);
  if (prec === mois) return `${mois}.${String(Number(m[3]) + 1).padStart(3, '0')}`;
  return `${mois}.001`;
}

function listeSignee<E>(liste: NomListe, version: string, genere_le: string, entrees: E[], clePrivee: KeyObject): ListePubliee<E> {
  const signature = sign(null, octetsSignes(liste, version, genere_le, entrees), clePrivee).toString('hex');
  return { liste, version, genere_le, entrees, signature };
}

export function construirePublication(
  exportServeur: ExportServeur,
  versions: { officiels: string; frauduleux: string },
  maintenant: Date,
  clePrivee: KeyObject,
): { officiels: ListePubliee<EntreeOfficiel>; frauduleux: ListePubliee<EntreeFrauduleux> } {
  const genere = maintenant.toISOString();
  const entreesOfficiels: EntreeOfficiel[] = exportServeur.officiels.map((e) => ({
    hote: e.hote,
    ...(e.marque !== null ? { marque: e.marque } : {}),
    ...(e.statut === 'repertorie' ? { statut: 'repertorie' as const } : {}),
    valide_le: e.valide_le,
  }));
  const entreesFrauduleux: EntreeFrauduleux[] = exportServeur.frauduleux.map((e) => ({ hote: e.hote, portee: 'hote', confirme_le: e.confirme_le }));
  return {
    officiels: listeSignee('officiels', versions.officiels, genere, entreesOfficiels, clePrivee),
    frauduleux: listeSignee('frauduleux', versions.frauduleux, genere, entreesFrauduleux, clePrivee),
  };
}

/** Différence lisible entre deux états d'une liste (par hôte ; une marque modifiée compte comme modifiée). */
export function differences(avant: { hote: string; marque?: string; statut?: string }[], apres: { hote: string; marque?: string; statut?: string }[]): { ajoutes: string[]; retires: string[]; modifies: string[] } {
  const a = new Map(avant.map((e) => [e.hote, `${e.marque ?? ''}|${e.statut ?? ''}`]));
  const b = new Map(apres.map((e) => [e.hote, `${e.marque ?? ''}|${e.statut ?? ''}`]));
  return {
    ajoutes: [...b.keys()].filter((h) => !a.has(h)).sort(),
    retires: [...a.keys()].filter((h) => !b.has(h)).sort(),
    modifies: [...b.keys()].filter((h) => a.has(h) && a.get(h) !== b.get(h)).sort(),
  };
}
