// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Schéma Zod du format d'empreinte de marque tel qu'écrit à la main dans
// listes/socle/*.json (chapitre 5.3 de la spec, plus les champs de suivi de
// vérification propres à ce dépôt : a_verifier, notes_verification,
// avertissement, priorite_detection, signal_specifique).
import { z } from 'zod';

const COULEUR_HEX = /^#[0-9a-f]{6}$/i;

// 12.3.3.6 : contrôle de forme sur les entrées de domaine — refuse une barre
// oblique, un schéma (http:, https:...) ou un espace. `ameli.fr/assure` est un
// chemin, pas un hôte ; rien ne l'empêchait d'entrer dans `domaines` avant ce
// contrôle. N'exige pas un nom d'hôte pleinement valide (les IDN, punycode et
// cas limites du DNS ne sont pas le sujet ici) : seulement l'absence de ce
// qu'un hôte ne peut structurellement pas contenir.
const DOMAINE_SANS_CHEMIN_NI_SCHEMA = /^[^\s/:]+$/;

const domaineValide = () =>
  z.string().min(1).regex(DOMAINE_SANS_CHEMIN_NI_SCHEMA, 'doit être un nom d\'hôte : ni barre oblique, ni schéma, ni espace');

const empreinteSchemaBase = z.object({
  id: z.string().min(1),
  libelle: z.string().min(1),
  criticite: z.number().int().min(1),
  // Seul critère de publication (5.3). Obligatoire : une marque sans ce champ
  // doit faire échouer la validation plutôt que se retrouver active ou
  // inactive par accident d'un défaut implicite.
  actif: z.boolean(),
  domaines: z.array(domaineValide()).min(1),
  domaines_verifies: z.array(domaineValide()).default([]),
  // 14.12 : le bandeau N2 affiche un domaine enregistrable comme « adresse
  // officielle », jamais un sous-domaine. Champ obligatoire, choisi une fois
  // par nous et non par une heuristique à l'exécution — vérifié ci-dessous
  // qu'il figure bien dans `domaines`.
  domaine_principal: domaineValide(),
  // Un terme fort pèse 30 points dans le moteur (5.3) : sous 12 caractères, il
  // est presque toujours trop générique pour être distinctif (verifier-socle.md).
  termes_forts: z.array(z.string().min(12)).min(1).max(5),
  // 12.3.3.11 : trois termes forts mal classés (décrivant un service, pas la
  // marque) rejoignent cette liste. 12.3.3.16 : "porte-documents" les rejoint
  // (généricité montrée par la mesure, pas par l'intuition), portant le
  // maximum observé à 17.
  termes_faibles: z.array(z.string().min(1)).max(17),
  termes_saisie: z.array(z.string().min(1)).min(1),
  format_identifiant: z.string().min(1),
  racines_typo: z.array(z.string().min(1)),
  couleurs: z.array(z.string().regex(COULEUR_HEX)).min(1),
  franceconnect: z.boolean(),
  espaces_multiples: z.array(z.string()),
  a_verifier: z.boolean(),
  notes_verification: z.string().optional(),
  avertissement: z.string().optional(),
  priorite_detection: z.string().optional(),
  signal_specifique: z.string().optional(),
  // Rempli au lot L5 à partir des favicons réellement téléchargées : absent
  // à ce stade, jamais deviné.
  favicon_hash: z.array(z.string()).optional(),
});

// 12.3.3.11 : un terme fort dit « cette page est la marque » (I1, poids 30) ;
// un terme de saisie dit « cette page demande cette donnée » (E2). Un même
// libellé dans les deux listes contredit ce partage — « code personnel »
// classé à la fois comme marqueur de marque et comme donnée demandée n'a
// qu'une lecture cohérente, celle de termes_saisie.
export const empreinteSchema = empreinteSchemaBase.superRefine((empreinte, ctx) => {
  const saisie = new Set(empreinte.termes_saisie);
  for (const terme of empreinte.termes_forts) {
    if (saisie.has(terme)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `le terme "${terme}" figure à la fois dans termes_forts et dans termes_saisie`,
        path: ['termes_forts'],
      });
    }
  }
  if (!empreinte.domaines.includes(empreinte.domaine_principal)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `domaine_principal ("${empreinte.domaine_principal}") doit figurer dans domaines`,
      path: ['domaine_principal'],
    });
  }
});

export type EmpreinteBrute = z.infer<typeof empreinteSchema>;

/**
 * `actif` est le seul critère de publication (5.3) — pas `avertissement`, un
 * champ de commentaire libre qui peut légitimement exister sur une marque par
 * ailleurs active, ni `a_verifier`, qui documente un état de vérification
 * manuelle (vrai sur les douze fichiers à ce stade, cf. listes/verifier-socle.md)
 * sans rapport avec la publication.
 */
export function estActive(empreinte: EmpreinteBrute): boolean {
  return empreinte.actif;
}
