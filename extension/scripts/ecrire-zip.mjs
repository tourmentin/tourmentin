// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.59 : écrivain de zip minimal, lisible par l'Explorateur Windows (ce que `tar.exe` ne produit pas : noms en « ./ » et entrées de dossiers).
// Noms relatifs avec « / », uniquement des fichiers, deflate, sans descripteur de données, ordre alphabétique, date fixe (archive reproductible).
//   import { ecrireZip } from './ecrire-zip.mjs'; ecrireZip('dossier', 'archive.zip');
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const DATE_DOS = 0x5a21; // 1er janvier 2025 ; heure 00:00:00
const HEURE_DOS = 0;

function lister(racine, prefixe = '') {
  const sortie = [];
  for (const nom of readdirSync(join(racine, prefixe)).sort()) {
    const relatif = prefixe ? `${prefixe}/${nom}` : nom;
    if (statSync(join(racine, relatif)).isDirectory()) sortie.push(...lister(racine, relatif));
    else sortie.push(relatif);
  }
  return sortie;
}

export function ecrireZip(dossier, cheminZip) {
  const morceaux = [];
  const central = [];
  let decalage = 0;
  for (const relatif of lister(dossier)) {
    const donnees = readFileSync(join(dossier, relatif));
    const comprimees = deflateRawSync(donnees, { level: 9 });
    const nom = Buffer.from(relatif, 'utf8');
    const crc = crc32(donnees) >>> 0;
    const entete = Buffer.alloc(30);
    entete.writeUInt32LE(0x04034b50, 0);
    entete.writeUInt16LE(20, 4); // version nécessaire
    entete.writeUInt16LE(0x0800, 6); // noms en UTF-8
    entete.writeUInt16LE(8, 8); // deflate
    entete.writeUInt16LE(HEURE_DOS, 10);
    entete.writeUInt16LE(DATE_DOS, 12);
    entete.writeUInt32LE(crc, 14);
    entete.writeUInt32LE(comprimees.length, 18);
    entete.writeUInt32LE(donnees.length, 22);
    entete.writeUInt16LE(nom.length, 26);
    entete.writeUInt16LE(0, 28);
    morceaux.push(entete, nom, comprimees);
    const rep = Buffer.alloc(46);
    rep.writeUInt32LE(0x02014b50, 0);
    rep.writeUInt16LE(20, 4); // créé par
    rep.writeUInt16LE(20, 6); // version nécessaire
    rep.writeUInt16LE(0x0800, 8);
    rep.writeUInt16LE(8, 10);
    rep.writeUInt16LE(HEURE_DOS, 12);
    rep.writeUInt16LE(DATE_DOS, 14);
    rep.writeUInt32LE(crc, 16);
    rep.writeUInt32LE(comprimees.length, 20);
    rep.writeUInt32LE(donnees.length, 24);
    rep.writeUInt16LE(nom.length, 28);
    rep.writeUInt32LE(0, 38); // attributs externes
    rep.writeUInt32LE(decalage, 42);
    central.push(rep, nom);
    decalage += entete.length + nom.length + comprimees.length;
  }
  const tailleCentral = central.reduce((n, b) => n + b.length, 0);
  const fin = Buffer.alloc(22);
  const nb = central.length / 2;
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(nb, 8);
  fin.writeUInt16LE(nb, 10);
  fin.writeUInt32LE(tailleCentral, 12);
  fin.writeUInt32LE(decalage, 16);
  writeFileSync(cheminZip, Buffer.concat([...morceaux, ...central, fin]));
  return nb;
}
