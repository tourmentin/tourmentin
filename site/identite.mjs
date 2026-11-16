// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.50 : identité visuelle commune (couleurs, polices système, en-tête, pied de page) reprise de site/accueil/index.html.
// Aucune ressource externe : le logo est un SVG en ligne, aucune police distante, aucun script. Utilisé par /installer, /mentions-legales
// (site/construire-mentions.mjs, extension/scripts/construire-installer.mjs) ; le back-office /gestion en reprend la même feuille (serveur/, hors Git).

export const LOGO_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#13283B" stroke="#7FD6D0" stroke-opacity=".6"/><path d="M14 6 V24" stroke="#EEF3F4" stroke-width="1.6"/><path d="M15 7 C22.5 11 25.5 17.5 24 23 H15 Z" fill="#FFFFFF"/><path d="M13 10 C9 14.5 8 19 9 22.5 H13 Z" fill="#EEF3F4" fill-opacity=".8"/><path d="M7 26 C10 24.6 12.5 27.2 16 26 S22 24.6 25 26" fill="none" stroke="#FF6B1A" stroke-width="1.6" stroke-linecap="round"/></svg>';

export const FAVICON = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(LOGO_SVG.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}">`;

export const CSS_COMMUN = `
:root{--mer:#13283B;--ecume:#EEF3F4;--voile:#FF6B1A;--balise:#1F7A5A;--brume:#4F606C;--sable:#F2B705;--blanc:#FFFFFF;
  --sans:Seravek,"Gill Sans Nova",Ubuntu,Calibri,"DejaVu Sans",source-sans-pro,sans-serif;
  --mono:ui-monospace,"Cascadia Code","Source Code Pro",Menlo,Consolas,"DejaVu Sans Mono",monospace}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ecume);color:var(--mer);font-family:var(--sans);font-size:1.0625rem;line-height:1.6}
a{color:var(--mer);text-decoration:underline;text-underline-offset:.15em}
a:hover{text-decoration-color:var(--voile);text-decoration-thickness:2px}
:focus-visible{outline:3px solid var(--voile);outline-offset:3px;border-radius:2px}
.contenu{max-width:72rem;margin:0 auto;padding:0 1.25rem}
.entete{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 0;flex-wrap:wrap;gap:.5rem 1rem}
.marque{display:flex;align-items:center;gap:.6rem;text-decoration:none;font-weight:700;font-size:1.15rem;letter-spacing:.01em}
.marque svg{width:32px;height:32px}
.nav{display:flex;gap:1.25rem;font-size:.95rem}
.nav a{text-decoration:none;color:var(--brume)}
.nav a:hover{color:var(--mer);text-decoration:underline}
.bandeau-page{background:var(--mer);color:var(--ecume)}
.bandeau-page .marque,.bandeau-page .nav a{color:#F4F8F9}
.bandeau-page .nav a{color:#C9DDE3}
.bandeau-page .nav a:hover{color:#FFFFFF}
footer.pied{padding:2.5rem 0 3rem;font-size:.9rem;color:var(--brume);border-top:1px solid #C9D5DB;margin-top:3rem}
footer.pied .contenu{display:flex;flex-wrap:wrap;justify-content:space-between;gap:1rem}
footer.pied nav{display:flex;flex-wrap:wrap;gap:1.25rem}
footer.pied a{color:var(--brume)}
`;

export function entete(nav = [['/installer', 'Installer'], ['/gestion/connexion', 'Se connecter'], ['/gestion/inscription', 'Créer un compte']]) {
  const liens = nav.map(([h, t]) => `<a href="${h}">${t}</a>`).join('');
  return `<header class="bandeau-page"><div class="contenu entete"><a class="marque" href="/" aria-label="Tourmentin, accueil">${LOGO_SVG}Tourmentin</a><nav class="nav" aria-label="Navigation principale">${liens}</nav></div></header>`;
}

export function pied() {
  return `<footer class="pied"><div class="contenu"><p>Tourmentin. Projet sans publicité. Hébergé par OVH. Contact : ${COURRIEL}</p><nav aria-label="Liens de pied de page"><a href="/installer">Installer</a><a href="/gestion">Espace contributeurs</a><a href="/confidentialite">Confidentialité</a><a href="/mentions-legales">Mentions légales</a></nav></div></footer>${SCRIPT_COURRIEL}`;
}

// 14.52 : contact public assemblé par script (limite la collecte simple) ; texte lisible sans script : « contact arobase tourmentin point fr ».
export const COURRIEL = '<span class="courriel" data-u="contact" data-d1="tourmentin" data-d2="fr">contact arobase tourmentin point fr</span>';
export const SCRIPT_COURRIEL = `<script>document.querySelectorAll('.courriel').forEach(function(e){var a=e.dataset.u+'@'+e.dataset.d1+'.'+e.dataset.d2,l=document.createElement('a');l.href='mailto:'+a;l.textContent=a;e.replaceChildren(l)})</script>`;
