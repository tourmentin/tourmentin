#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.56 : contrôle qui précède toute publication du code. Il lit un DOSSIER (la copie propre produite par exporter-depot.mjs) et refuse (code de sortie 1) s'il trouve :
//   1. un secret : bloc de clé privée, jeton connu (GitHub, Slack, AWS, JWT), clé d'API Mozilla (user:<n>:<n>), affectation « mot de passe / secret / jeton = "valeur" » ;
//      et, surtout, la VALEUR de l'un des secrets de ce poste, lus dans l'environnement (accès SFTP, clés d'API Mozilla) : jamais affichée, seul le chemin du fichier l'est ;
//   2. une adresse Gmail ou Hotmail, ou l'identifiant de l'une d'elles ;
//   3. un chemin du dossier personnel de Ph sur ce poste (toutes graphies) ;
//   4. un fichier qui ne doit jamais être publié (clé, .env, wp-config, archive, build).
// Il n'affiche JAMAIS la valeur d'un secret : le chemin du fichier, le numéro de ligne et le motif de la règle, rien d'autre.
//   node publication/controle-prepublication.mjs <dossier>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

const dossier = process.argv[2];
if (!dossier) { console.error('usage : node publication/controle-prepublication.mjs <dossier>'); process.exit(2); }

function env(nom) {
  if (process.env[nom]) return process.env[nom];
  try { return execFileSync('powershell', ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${nom}','User')`], { encoding: 'utf8' }).replace(/\r?\n$/, ''); } catch { return ''; }
}
const nettoyer = (v) => v.trim().replace(/^['"]+|['"]+$/g, '');

const REGLES_TEXTE = [
  { id: 'gmail', motif: /@(?:googlemail|gmail)\.[a-z]{2,}/i, categorie: 'adresse personnelle' },
  { id: 'hotmail', motif: /@(?:hotmail|outlook|live|msn)\.[a-z.]{2,}/i, categorie: 'adresse personnelle' },
  // motifs construits par fragments : ce fichier ne doit pas se signaler lui-même
  { id: 'identifiant-hotmail', motif: new RegExp('peter' + 'pan69007', 'i'), categorie: 'adresse personnelle' },
  { id: 'identifiant-gmail', motif: /ph\.geoffroy\+?[a-z0-9]*@/i, categorie: 'adresse personnelle' },
  { id: 'chemin-local', motif: /(?:[A-Za-z]:)?[\\/]+Users[\\/]+Ph(?:[\\/]|\b)/, categorie: 'chemin local' },
  { id: 'sauvegardes', motif: new RegExp('Sauvegardes' + '-tourmentin', 'i'), categorie: 'chemin local' },
  { id: 'cle-privee', motif: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, categorie: 'secret' },
  { id: 'jeton-github', motif: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, categorie: 'secret' },
  { id: 'jeton-slack', motif: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, categorie: 'secret' },
  { id: 'cle-aws', motif: /\bAKIA[0-9A-Z]{16}\b/, categorie: 'secret' },
  { id: 'jwt', motif: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, categorie: 'secret' },
  { id: 'cle-api-mozilla', motif: /\buser:\d{5,}:\d{2,}\b/, categorie: 'secret' },
  // affectation d'un littéral de 8 caractères ou plus à un nom de secret ; les lectures d'environnement et les valeurs d'exemple évidentes sont écartées plus bas
  { id: 'affectation-secret', motif: /\b(?:pass(?:word|wd)?|mot_?de_?passe|secret|token|jeton|api[_-]?key)\w*\s*[:=]\s*(['"`])([^'"`\s]{8,})\1/i, categorie: 'secret à relire', aRelire: true },
];
const PAS_UN_SECRET = /process\.env|env\(|\$\{|<[^>]+>|exemple|example|jetable|factice|fictif|placeholder|xxxx|\*{4}|changeme|test/i;

const NOMS_INTERDITS = [
  { motif: /^docs(\/|$)/i, categorie: 'document interne (la spec n\'est pas publiée)' },
  { motif: /^CLAUDE\.md$/i, categorie: 'document interne (la spec n\'est pas publiée)' },
  { motif: /(^|\/)cle-privee[^/]*$/i, categorie: 'fichier interdit' },
  { motif: /\.(pem|key|p12|pfx|jks)$/i, categorie: 'fichier interdit' },
  { motif: /(^|\/)\.env(\.|$)/i, categorie: 'fichier interdit' },
  { motif: /(^|\/)wp-config\.php$/i, categorie: 'fichier interdit' },
  { motif: /\.(zip|xpi|crx|tar|tgz|7z)$/i, categorie: 'archive' },
  { motif: /(^|\/)(node_modules|dist|\.vite|coverage)(\/|$)/i, categorie: 'dossier de construction' },
  { motif: /(^|\/)(journal-ecritures|sauvegarde)[^/]*$/i, categorie: 'fichier interdit' },
];

// valeurs des secrets de ce poste : cherchées dans les fichiers, jamais affichées
const SECRETS_POSTE = ['TOURMENTIN_SFTP_HOTE', 'TOURMENTIN_SFTP_UTILISATEUR', 'TOURMENTIN_SFTP_MOT_DE_PASSE', 'WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET']
  .map((nom) => ({ nom, valeur: nettoyer(env(nom)) }))
  .filter((s) => s.valeur.length >= 6);

function fichiers(d) {
  return readdirSync(d).flatMap((nom) => {
    const chemin = join(d, nom);
    if (nom === '.git') return [];
    return statSync(chemin).isDirectory() ? fichiers(chemin) : [chemin];
  });
}

const trouvailles = [];
const ajouter = (fichier, ligne, categorie, regle, bloquant = true) => trouvailles.push({ fichier, ligne, categorie, regle, bloquant });
const liste = fichiers(dossier);

for (const chemin of liste) {
  const rel = relative(dossier, chemin).split('\\').join('/');
  for (const n of NOMS_INTERDITS) if (n.motif.test(rel)) ajouter(rel, 0, n.categorie, 'nom de fichier');
  const octets = readFileSync(chemin);
  const binaire = octets.subarray(0, 4000).includes(0);
  for (const s of SECRETS_POSTE) if (octets.includes(Buffer.from(s.valeur))) ajouter(rel, 0, 'secret de ce poste', `valeur de ${s.nom} présente (valeur non affichée)`);
  if (binaire) continue;
  const lignes = octets.toString('utf8').split(/\r?\n/);
  lignes.forEach((texte, i) => {
    for (const r of REGLES_TEXTE) {
      const m = r.motif.exec(texte);
      if (!m) continue;
      if (r.aRelire && (PAS_UN_SECRET.test(texte) || PAS_UN_SECRET.test(m[2] ?? ''))) continue;
      ajouter(rel, i + 1, r.categorie, r.id, !r.aRelire);
    }
  });
}

const bloquantes = trouvailles.filter((t) => t.bloquant);
const aRelire = trouvailles.filter((t) => !t.bloquant);
const parCategorie = (liste) => Object.entries(liste.reduce((a, t) => ({ ...a, [t.categorie]: (a[t.categorie] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(', ') || 'aucune';

console.log(`Contrôle de pré-publication : ${liste.length} fichiers lus dans ${dossier}`);
console.log(`Secrets de ce poste recherchés (valeurs jamais affichées) : ${SECRETS_POSTE.map((s) => s.nom).join(', ') || 'aucun (variables absentes)'}`);
console.log(`Règles bloquantes : ${bloquantes.length} trouvaille(s) (${parCategorie(bloquantes)})`);
for (const t of bloquantes) console.log(`  BLOQUANT  ${t.fichier}${t.ligne ? ':' + t.ligne : ''}  [${t.categorie} / ${t.regle}]`);
console.log(`À relire à la main (affectations ressemblant à un secret) : ${aRelire.length}`);
for (const t of aRelire) console.log(`  À RELIRE  ${t.fichier}:${t.ligne}  [${t.regle}]`);
if (bloquantes.length) { console.log('\nRÉSULTAT : REFUSÉ. Rien ne doit être publié tant que ces points ne sont pas corrigés.'); process.exit(1); }
console.log(aRelire.length ? '\nRÉSULTAT : aucune règle bloquante ; relire les lignes ci-dessus avant le « go ».' : '\nRÉSULTAT : propre.');
