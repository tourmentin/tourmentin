// SPDX-FileCopyrightText: 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE <contact@tourmentin.fr>
// SPDX-License-Identifier: AGPL-3.0-or-later
// 14.69 : /confidentialite. Produit site/publie/confidentialite/index.html. Chaque phrase est rattachée au code dans
// publication/chrome-web-store/verification-confidentialite.md. Les passages « à compléter » (surlignés) sont des points
// que le code ne permet pas d'affirmer : Ph les tranche avant tout déploiement.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS_COMMUN, FAVICON, COURRIEL, entete, pied } from './identite.mjs';
import { TITRE_CE_QUE_TOURMENTIN_LIT, TEXTE_CE_QUE_TOURMENTIN_LIT } from './texte-ce-que-tourmentin-lit.mjs';

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

const a = (t) => `<span class="a-completer">${t}</span>`;

const corps = `<h1>Confidentialité</h1>
<p>Tourmentin est une extension de navigateur qui prévient quand une page imite un service officiel français. Cette page dit ce qu'elle lit, ce qui reste sur votre appareil, ce qui part vers nos serveurs, et ce qui n'est jamais collecté.</p>

<h2>Qui est responsable</h2>
<p>DE-TENTES ET CLAPOTIS, société à responsabilité limitée au capital de 390 000 €, dont le siège est 71 avenue de la Patinière, 38500 Voiron, immatriculée au registre du commerce et des sociétés de Vienne sous le numéro 530 960 970, qui exploite le camping Détente et Clapotis. Contact pour toute question sur vos données : ${COURRIEL}.</p>

<h2>${TITRE_CE_QUE_TOURMENTIN_LIT}</h2>
<p>${TEXTE_CE_QUE_TOURMENTIN_LIT}</p>

<h2>Ce qui reste sur votre appareil</h2>
<p>L'analyse d'une page se fait entièrement dans votre navigateur. Son résultat n'est pas envoyé. Tourmentin conserve sur votre appareil :</p>
<p>vos réglages (envoi, journal, avertissement sur les pages de connexion) ; le résultat de l'analyse de chaque onglet ouvert et, pendant quinze minutes, l'adresse d'un site qui venait de ressembler à un service officiel, effacés à la fermeture du navigateur ; les listes de sites vérifiées téléchargées depuis tourmentin.fr ; un compteur du nombre de bandeaux affichés chaque jour ; la liste, sous forme d'empreintes tronquées qui ne permettent pas de relire les adresses, des pages de connexion pour lesquelles Tourmentin vous a déjà prévenu ; les déclarations que vous avez faites vous-même (« Cette page est frauduleuse », « Signaler comme site officiel »), avec l'adresse sans la partie après « ? » ou « # », le niveau d'alerte et le motif, que vous pouvez consulter dans les options.</p>
<p>Un journal des pages signalées par l'extension existe, mais il est <strong>désactivé par défaut</strong> ; s'il est activé, il garde l'adresse sans la partie après « ? » ou « # » pendant trente jours au plus, et le bouton « Effacer le journal » des options le vide.</p>
<p>Enfin, l'extension crée pour elle-même une paire de clés cryptographiques. La clé privée reste dans votre navigateur et ne peut pas en être extraite ; elle ne sert qu'à signer ce que vous décidez d'envoyer, pour que personne ne puisse se faire passer pour votre installation.</p>

<h2>Ce qui part vers tourmentin.fr</h2>
<p><strong>Chaque heure</strong>, Tourmentin télécharge les listes de sites vérifiés et de sites frauduleux publiées sur tourmentin.fr. Cette requête ne contient ni identifiant, ni cookie, ni adresse que vous avez visitée : le serveur voit seulement, comme tout site web, une adresse IP et le type de navigateur. Il en tire un seul chiffre : une fois par jour et par réseau, il note une empreinte secrète du réseau (jamais l'adresse IP elle-même) pour savoir combien de réseaux différents téléchargent les listes. Cette empreinte est effacée au bout de huit jours.</p>
<p><strong>Quand vous déclarez une page</strong>, et seulement alors, Tourmentin prépare un envoi. Par défaut, il vous le montre et attend votre confirmation ; vous pouvez choisir dans les options « Envoyer automatiquement » ou « Ne jamais envoyer » (dans ce dernier cas aucune requête n'est émise). L'envoi contient : l'adresse du site sans la partie après « ? » ou « # », la marque évoquée, le niveau d'alerte et les signaux qui l'expliquent, le texte visible de la page nettoyé des adresses e-mail, numéros de téléphone et IBAN, les adresses de ses images, la date, la version de l'extension, et la signature de votre installation. Les noms et les adresses postales ne sont pas retirés automatiquement : c'est pourquoi l'envoi vous est montré avant votre confirmation. Au premier envoi, l'extension enregistre aussi sa clé publique ; l'identifiant de l'installation est l'empreinte de cette clé : il ne contient ni votre nom, ni votre adresse e-mail.</p>
<p>Si vous êtes contributeur et liez votre navigateur à un compte avec un code, l'extension demande aussi au serveur, avec la signature de l'installation, quel est votre rôle.</p>
<p>Si vous avez déjà envoyé au moins une déclaration « site officiel » et que le réglage d'envoi le permet, l'extension demande aussi de temps en temps au serveur, avec la signature de l'installation, si l'équipe vous propose de devenir utilisateur de confiance. La requête ne contient que cette question ; la réponse est un oui ou un non. Le nombre de sites que vous avez déclarés est compté sur votre appareil.</p>
<p>Sur le site tourmentin.fr, deux pages utilisent le serveur. La page des chiffres (et la page d'accueil) demande des totaux sans rien envoyer vous concernant. La page « Vérifier un lien reçu » envoie le lien que vous collez, mais le serveur n'en retient que le <strong>nom du site</strong> (par exemple « exemple.fr ») : le chemin, les paramètres et tout ce qui pourrait vous identifier sont jetés. Quand ce nom de site est inconnu de la base, il est conservé avec un compteur et des dates, sans lien avec vous, pour qu'une personne de confiance puisse l'examiner. Aucune décision n'est prise automatiquement à partir de ces vérifications.</p>
<p>Avec chaque déclaration, le serveur conserve aussi une empreinte secrète du réseau d'où elle vient (jamais l'adresse IP), pendant trente jours : elle sert à ce qu'un même réseau ne pèse qu'une fois quand plusieurs installations déclarent la même page. Quand un nombre suffisant d'installations différentes, installées depuis longtemps, déclarent la même page, son statut peut changer automatiquement ; un site validé par une personne n'est jamais déclaré frauduleux automatiquement, il est seulement soumis à examen.</p>
<p>Le serveur limite le nombre de requêtes par adresse IP. Pour cela, il n'enregistre pas l'adresse IP : il la transforme en empreinte secrète qui sert de compteur, effacée à la fin de sa période de comptage (une heure au plus).</p>
<p>Les déclarations reçues sont lues par les contributeurs qui décident si un site est officiel ou frauduleux. Elles ne sont ni vendues, ni transmises à des tiers, ni utilisées pour de la publicité. Elles sont conservées sans limite de durée, puisqu'elles alimentent une base collaborative de sites vérifiés ou frauduleux.</p>

<h2>Ce qui n'est jamais collecté</h2>
<p>Le contenu de ce que vous tapez dans une page, y compris mots de passe, identifiants, numéros de carte : Tourmentin lit le type et l'intitulé des champs, jamais les caractères que vous y tapez. Il compte seulement combien de caractères ont été tapés dans un champ d'identifiant ou de mot de passe (un nombre, par exemple « 12 caractères saisis », qui peut figurer parmi les signaux d'une déclaration que vous confirmez). Les adresses complètes avec leur partie après « ? » ou « # ». Votre historique de navigation : Tourmentin n'envoie rien des pages que vous ne déclarez pas. Les cookies : aucune requête de l'extension n'en emporte. Aucune statistique d'usage, aucun traceur, aucune publicité, aucun code téléchargé : seules des données (listes de sites) sont téléchargées.</p>

<h2>Hébergement du site et des serveurs</h2>
<p>Tourmentin est hébergé par OVH, en France. Comme tout hébergeur, OVH conserve des journaux techniques des accès (adresse IP, date, page demandée). Il les garde pendant la durée que la loi prévoit pour les hébergeurs ; Tourmentin n'y a pas accès. Ce site ne dépose aucun cookie de suivi et ne charge aucune ressource d'un autre site.</p>

<h2>Vos choix et vos droits</h2>
<p>Vous pouvez à tout moment désactiver tout envoi dans les options, vider le journal, supprimer l'extension (ce qu'elle conservait sur votre appareil disparaît avec elle). Pour demander l'accès à des données vous concernant ou leur suppression, écrivez à ${COURRIEL}. Une déclaration n'est rattachée à aucun nom ni aucune adresse e-mail : sans l'identifiant de l'installation, que l'extension n'affiche pas encore, nous ne pouvons pas retrouver celles d'une personne précise.</p>

<h2>Évolutions</h2>
<p>Cette page sera mise à jour avant tout changement de ce qui est lu, conservé ou envoyé, et la date de la dernière mise à jour figurera ci-dessous. Le code de l'extension est public : chacun peut vérifier ce que cette page affirme.</p>
<p>Dernière mise à jour : 15 novembre 2026.</p>`;

mkdirSync(join(ICI, 'publie', 'confidentialite'), { recursive: true });
writeFileSync(join(ICI, 'publie', 'confidentialite', 'index.html'), page('Confidentialité', corps));
console.log('ok');
