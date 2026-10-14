# Tourmentin

Tourmentin est une extension de navigateur (Chrome, Brave, Firefox) qui repère les pages imitant un service public français (impôts, assurance maladie, CAF, La Poste…) au moment où vous allez y saisir un mot de passe ou un numéro de carte bancaire.

L'analyse se fait sur votre appareil. Rien de ce que vous consultez n'est envoyé sans que vous le décidiez, et ce que vous saisissez dans un formulaire ne quitte jamais votre appareil.

**Version d'essai** : le silence de Tourmentin ne prouve pas qu'une page est sûre.

## Installer

Voir <https://tourmentin.fr/installer>.

## Contenu du dépôt

- `extension/` : l'extension (TypeScript, Manifest V3) et ses tests ;
- `listes/` : les outils qui signent les listes de sites, et les empreintes des marques ;
- `site/` : les pages publiques de tourmentin.fr ;
- `publication/` : les scripts d'export de ce dépôt.

Pour construire l'extension : `cd listes && npm install`, puis `cd ../extension && npm install && npm run build` (dossiers `dist/chrome-essai` et `dist/firefox-essai`). Les tests : `npm test` dans `extension/`.

## Licence

Le code est distribué sous la licence GNU Affero General Public License, version 3 ou ultérieure (`AGPL-3.0-or-later`) : voir le fichier [LICENSE](LICENSE). Les listes de sites (données) ne sont pas couvertes par cette licence. Les composants tiers sont indiqués dans [NOTICE](NOTICE).

Copyright (C) 2026 DE-TENTES ET CLAPOTIS LA VERONNIERE

## Sécurité

Pour signaler une faille, écrivez à contact@tourmentin.fr sans la rendre publique avant sa correction.

## Contact

contact@tourmentin.fr
