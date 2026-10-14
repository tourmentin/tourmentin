// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.50 point 3 : /mentions-legales. Produit site/publie/mentions-legales/index.html et site/mentions-legales/complet.html
// 14.56 (13/10/2026) : l'anonymat est abandonné ; éditeur = la SARL DE-TENTES ET CLAPOTIS LA VERONNIERE ; contact : contact@tourmentin.fr (jamais l'adresse personnelle).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS_COMMUN, FAVICON, COURRIEL, entete, pied } from './identite.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const page = (titre, corps) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titre} — Tourmentin</title>${FAVICON}
<meta name="robots" content="index, follow">
<style>${CSS_COMMUN}
main{max-width:44rem;margin:0 auto;padding:2rem 1.25rem}
h1{font-size:clamp(1.6rem,3vw,2.2rem);line-height:1.15;margin:0 0 1rem}h2{font-size:1.25rem;margin:2rem 0 .5rem}
.a-completer{background:#FFF1CC;border:1px solid #8A6A00;padding:.1rem .4rem;border-radius:3px}
</style></head><body>
${entete()}
<main>
${corps}
</main>
${pied()}
</body></html>
`;
const complet = page('Mentions légales', `<h1>Mentions légales</h1>
<h2>Éditeur du site</h2>
<p>DE-TENTES ET CLAPOTIS LA VERONNIERE, société à responsabilité limitée à associé unique au capital de 100 000 €, dont le siège est 1578 route des Chevaliers de l'An Mil, 38620 Montferrat, immatriculée au registre du commerce et des sociétés de Vienne sous le numéro 792 048 555.</p>
<h2>Directeur de la publication</h2>
<p>Pierre-Hervé Geoffroy, gérant.</p>
<h2>Contact</h2>
<p>Courriel : ${COURRIEL}<br>Téléphone : 04 76 55 33 94</p>
<h2>Hébergeur</h2>
<p>OVH SAS, 2 rue Kellermann, 59100 Roubaix, France. Société par actions simplifiée au capital de 50 000 000 €, immatriculée au registre du commerce et des sociétés de Lille Métropole sous le numéro 424 761 419. Coordonnées relevées sur le site d'OVHcloud (ovhcloud.com) le 11 octobre 2026.</p>
<h2>Données</h2>
<p>Ce site ne dépose aucun cookie de suivi et ne charge aucune ressource d'un autre site. Ce que l'extension Tourmentin peut envoyer, et ce qu'elle n'envoie jamais, est décrit sur la page <a href="/installer/">Installer</a>.</p>`);
mkdirSync(join(ICI, 'mentions-legales'), { recursive: true });
mkdirSync(join(ICI, 'publie', 'mentions-legales'), { recursive: true });
writeFileSync(join(ICI, 'mentions-legales', 'complet.html'), complet);
// Les deux pages (source versionnée et page publiée) portent le même texte.
writeFileSync(join(ICI, 'publie', 'mentions-legales', 'index.html'), complet);
console.log('ok');
