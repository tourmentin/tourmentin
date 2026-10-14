// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lecture/écriture CSV minimale, partagée par les scripts du lot L5/12.3 —
// gère les guillemets et les champs contenant une virgule, rien de plus.

export function decouperLigneCsv(ligneBrute) {
  // Fichiers CRLF (tous les CSV du dépôt) lus via split('\n') : chaque ligne
  // garde un '\r' final, qui s'infiltrerait sinon dans le dernier champ —
  // silencieux tant que ce champ n'est pas consommé (vitalite_indicative),
  // reproductible dès qu'il l'est (date_verification).
  const ligne = ligneBrute.endsWith('\r') ? ligneBrute.slice(0, -1) : ligneBrute;
  const champs = [];
  let courant = '';
  let dansGuillemets = false;
  for (const c of ligne) {
    if (c === '"') dansGuillemets = !dansGuillemets;
    else if (c === ',' && !dansGuillemets) {
      champs.push(courant);
      courant = '';
    } else courant += c;
  }
  champs.push(courant);
  return champs;
}

export function champCsv(valeur) {
  const v = String(valeur ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
