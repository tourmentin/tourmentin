// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.84 : pages publiques « Les chiffres », « Protéger mes proches » et « Vérifier un lien ». Produit site/publie/{chiffres,proteger-mes-proches,verifier-un-lien}/index.html.
// Les deux scripts en ligne ne parlent qu'à tourmentin.fr (même origine) : /api/v1/stats (GET, aucun paramètre) et /api/v1/verifier-lien (POST, voir la page).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS_COMMUN, FAVICON, SCRIPT_COURRIEL, entete, pied } from './identite.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const page = (titre, description, corps, script = '') => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titre} — Tourmentin</title>${FAVICON}
<meta name="description" content="${description}">
<meta name="robots" content="index, follow">
<style>${CSS_COMMUN}
main{max-width:44rem;margin:0 auto;padding:2rem 1.25rem}
h1{font-size:clamp(1.6rem,3vw,2.2rem);line-height:1.15;margin:0 0 1rem}h2{font-size:1.25rem;margin:2rem 0 .5rem}
.chiffres{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:1rem;margin:1.5rem 0}
.chiffre{background:var(--blanc);border:1px solid #C9D5DB;border-left:6px solid var(--balise);border-radius:8px;padding:1rem}
.chiffre b{display:block;font-size:2.2rem;line-height:1.1}.chiffre span{color:var(--brume);font-size:.95rem}
.carte{background:var(--blanc);border:1px solid #C9D5DB;border-radius:8px;padding:1rem 1.2rem;margin:1rem 0}
form.verif{display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0}form.verif input{flex:1 1 18rem;font:inherit;padding:.7rem;border:1px solid var(--brume);border-radius:6px}
form.verif button,.bouton{background:var(--voile);color:var(--mer);font:inherit;font-weight:700;border:0;border-radius:6px;padding:.7rem 1.2rem;cursor:pointer;text-decoration:none;display:inline-block}
#reponse{margin-top:1rem}#reponse .ok{border-left:6px solid var(--balise)}#reponse .non{border-left:6px solid #C0392B}#reponse .inconnu{border-left:6px solid var(--sable)}
</style></head><body>
${entete([['/installer', 'Installer'], ['/chiffres/', 'Les chiffres'], ['/gestion/connexion', 'Se connecter'], ['/gestion/inscription', 'Créer un compte']])}
<main>
${corps}
</main>
${pied()}
${SCRIPT_COURRIEL}
${script}
</body></html>
`;

const SCRIPT_STATS = `<script>
(function(){
  var cibles = document.querySelectorAll('[data-stat]');
  if(!cibles.length || !window.fetch) return;
  fetch('/api/v1/stats', {credentials:'omit', cache:'no-store'}).then(function(r){return r.ok ? r.json() : null;}).then(function(d){
    if(!d) return;
    cibles.forEach(function(e){ var v = d[e.getAttribute('data-stat')]; if(typeof v === 'number') e.textContent = v.toLocaleString('fr-FR'); });
  }).catch(function(){});
})();
</script>`;

const chiffres = `<h1>Les chiffres de Tourmentin</h1>
<p>Tourmentin est construit à plusieurs : chaque site vérifié protège tous ceux qui utilisent l'extension. Voici l'état de la base, mis à jour en direct. Aucun chiffre ne concerne une personne ou un site en particulier.</p>
<div class="chiffres">
<div class="chiffre"><b data-stat="sites_verifies">…</b><span>sites vérifiés ou répertoriés</span></div>
<div class="chiffre"><b data-stat="sites_frauduleux">…</b><span>sites confirmés frauduleux</span></div>
<div class="chiffre"><b data-stat="declarations">…</b><span>déclarations reçues de la communauté</span></div>
</div>
<p>Un site n'entre dans la liste « vérifié » qu'après examen par une personne de confiance : le nombre de déclarations ne suffit jamais.</p>
<h2>Faire grandir ces chiffres</h2>
<p><a href="/proteger-mes-proches/">Déclarer mes sites préférés pour protéger mes proches</a> · <a href="/verifier-un-lien/">Vérifier un lien reçu</a> · <a href="/installer">Installer Tourmentin</a></p>
<p>Vous pouvez partager cette page : <a href="https://tourmentin.fr/chiffres/">tourmentin.fr/chiffres</a>.</p>`;

const proches = `<h1>Déclarer mes sites préférés pour protéger mes proches</h1>
<p>Tourmentin reconnaît les imitations de sites que la liste connaît. Plus la liste contient de sites que vous et vos proches utilisez vraiment (votre banque régionale, votre mutuelle, votre commune, votre fournisseur d'énergie…), mieux elle les protège, et mieux elle repère ceux qui les copient.</p>
<div class="carte"><strong>Un seul clic suffit.</strong> Vous signalez le site comme fiable, une personne de confiance le vérifie, et une fois validé, vous êtes protégé à vie contre les tentatives d'hameçonnage qui imitent ce site, comme tous les utilisateurs de Tourmentin.</div>
<h2>Comment faire, en trois gestes</h2>
<div class="carte"><ol>
<li><strong>Installez Tourmentin</strong> sur votre navigateur (<a href="/installer">page d'installation</a>).</li>
<li><strong>Allez sur un site que vous connaissez et utilisez vraiment</strong>, en tapant vous-même l'adresse ou depuis vos favoris, jamais depuis un message reçu.</li>
<li><strong>Cliquez sur l'icône de Tourmentin</strong>, puis sur « Signaler comme site officiel ». Tourmentin vous montre ce qui sera envoyé et attend votre confirmation.</li>
</ol></div>
<h2>À faire avec soin</h2>
<p>Ne déclarez que des sites dont vous êtes certain, atteints par une adresse que vous avez saisie ou mise en favori vous-même. Une déclaration n'entre jamais directement dans la liste : une personne de confiance l'examine. Une déclaration fausse est écartée, et la répéter vous éloigne de l'équipe de confiance.</p>
<h2>Aller plus loin</h2>
<p>Les personnes qui déclarent beaucoup de sites, sans jamais se tromper, peuvent se voir proposer par l'équipe de devenir « utilisateur de confiance » : elles examinent à leur tour les sites signalés par les autres. Si cela vous tente, déclarez et attendez qu'un bouton apparaisse dans les options de l'extension.</p>
<p><a class="bouton" href="/installer">Installer Tourmentin</a></p>
<p>Un proche a reçu un lien suspect ? <a href="/verifier-un-lien/">Vérifier un lien reçu</a>.</p>`;

const verifier = `<h1>Vérifier un lien reçu</h1>
<p>Vous avez reçu un lien par courriel, SMS ou messagerie et vous hésitez ? Collez-le ici. <strong>Ne l'ouvrez pas.</strong> Le site compare le nom de domaine à la liste de Tourmentin.</p>
<form class="verif" id="formulaire" autocomplete="off"><label for="lien" style="flex-basis:100%">Lien reçu</label><input id="lien" name="lien" type="text" maxlength="2048" placeholder="https://…" required><button type="submit">Vérifier</button></form>
<div id="reponse" role="status" aria-live="polite"></div>
<h2>Ce que ce service fait et ne fait pas</h2>
<p>Seul le nom du site (par exemple « exemple.fr ») est lu : le reste du lien, qui peut contenir des informations personnelles, n'est ni envoyé à une autre page ni conservé. Le nom du site, lui, est enregistré quand la liste ne le connaît pas : une personne de confiance pourra l'examiner.</p>
<p><strong>« Inconnu » ne veut pas dire « sûr ».</strong> Un site absent de la liste peut être légitime comme frauduleux. Dans le doute, tapez vous-même l'adresse du service que vous cherchez, ou passez par vos favoris. Tourmentin est une aide, pas une garantie.</p>`;

const SCRIPT_VERIF = `<script>
(function(){
  var f = document.getElementById('formulaire'), r = document.getElementById('reponse');
  if(!f || !window.fetch) return;
  function montrer(classe, titre, texte){ r.textContent = ''; var d = document.createElement('div'); d.className = 'carte ' + classe; var h = document.createElement('strong'); h.textContent = titre; var p = document.createElement('p'); p.textContent = texte; d.appendChild(h); d.appendChild(p); r.appendChild(d); }
  f.addEventListener('submit', function(e){
    e.preventDefault();
    montrer('inconnu', 'Vérification en cours…', '');
    fetch('/api/v1/verifier-lien', {method:'POST', credentials:'omit', headers:{'Content-Type':'application/json'}, body: JSON.stringify({lien: document.getElementById('lien').value})})
      .then(function(x){ return x.json().then(function(d){ return {s:x.status, d:d}; }); })
      .then(function(o){
        if(o.s === 429){ montrer('inconnu', 'Trop de vérifications', 'Réessayez dans une heure.'); return; }
        if(o.s !== 200){ montrer('inconnu', 'Lien non lisible', "Collez une adresse complète, par exemple https://www.impots.gouv.fr."); return; }
        var h = o.d.hote;
        if(o.d.resultat === 'frauduleux') montrer('non', 'À éviter : ' + h, "Ce site est connu de Tourmentin comme frauduleux. N'ouvrez pas le lien et ne saisissez rien.");
        else if(o.d.resultat === 'verifie') montrer('ok', 'Site connu : ' + h, "Ce nom de domaine figure dans la liste des sites vérifiés. Assurez-vous que l'adresse affichée dans votre navigateur est exactement celle-ci.");
        else montrer('inconnu', 'Site inconnu : ' + h, "Tourmentin ne connaît pas ce site. Cela ne veut pas dire qu'il est sûr : n'y saisissez aucun mot de passe ni numéro de carte, et passez plutôt par l'adresse officielle que vous connaissez.");
      }).catch(function(){ montrer('inconnu', 'Service indisponible', 'Réessayez plus tard.'); });
  });
})();
</script>`;

const sortie = [
  ['chiffres', page('Les chiffres', 'Le nombre de sites vérifiés et de déclarations de la communauté Tourmentin.', chiffres, SCRIPT_STATS)],
  ['proteger-mes-proches', page('Protéger mes proches', 'Déclarer vos sites préférés comme fiables pour protéger vos proches avec Tourmentin.', proches)],
  ['verifier-un-lien', page('Vérifier un lien reçu', "Collez un lien reçu pour savoir si Tourmentin connaît le site, sans l'ouvrir.", verifier, SCRIPT_VERIF)],
];
for (const [dossier, html] of sortie) {
  mkdirSync(join(ICI, 'publie', dossier), { recursive: true });
  writeFileSync(join(ICI, 'publie', dossier, 'index.html'), html);
}
console.log('ok');
