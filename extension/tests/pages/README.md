# Pages de test du lot L3 — vérification manuelle des verdicts

Dix pages qui imitent un service institutionnel français, et dix pages
légitimes de forme comparable (formulaire de contact de mairie, connexion de
webmail associatif, boutique en ligne...). Ce dépôt a vocation à être public :
les dix imitations doivent donc être impossibles à confondre avec ce qu'elles
imitent.

## Quatre règles, pour toute page qui imite un service réel

**Aucun logo, aucune image, aucune police propre à la marque imitée.** Les
marqueurs testés sont textuels — c'est ce que le moteur analyse (5.3), et cela
suffit à exercer les signaux.

**Un commentaire HTML en tête de fichier** indiquant qu'il s'agit d'un
artefact de test, **et un bandeau visible dans la page elle-même** le disant
en clair. Une page ouverte par accident dans un navigateur doit s'annoncer.

**Aucun lien sortant vers le domaine réel du service imité, et aucune action
de formulaire hors du néant local** (`action="#"`, ou pas d'action du tout).
Une page de test n'envoie rien nulle part.

**Ces pages ne sont jamais déployées**, ni sur GitHub Pages, ni sur un domaine
du projet. Le `.gitignore` ne les exclut pas — elles doivent être versionnées
pour que les tests soient reproductibles — mais la configuration de build de
l'extension (`vite.config.ts`) ne référence que `src/`, jamais `tests/` : rien
de ce dossier ne se retrouve dans le paquet distribuable.

## Le domaine de test n'est pas dans le fichier

Ces pages sont des fragments HTML statiques, sans serveur. Le domaine évalué
par le moteur (le champ `url` d'`EntreeAnalyse`, y compris pour distinguer une
page légitime d'un typosquat) est fourni par le harnais de test
(`tests/integration/pages.test.ts`), pas par le fichier lui-même — de la même
manière que les gabarits de `corpus/portails-captifs/` ne portent pas non plus
leur propre domaine.

## Résultat attendu

Les dix pages légitimes doivent produire **N0**. Trois d'entre elles portent
un champ mot de passe sans aucun marqueur du socle : c'est le même principe que
les gabarits 05/06 de `corpus/portails-captifs/`, la preuve que l'axe
Exposition seul ne déclenche rien (5.6, « E == 0 → N0 » ne s'applique pas ici
puisque E > 0, c'est bien l'axe Imitation à zéro qui retient l'alerte).

Les dix imitations doivent produire une alerte (N1, N2 ou N3 selon la force du
signal réuni) — le niveau exact dépend du calibrage des poids, qui n'a lieu
qu'au lot L6. Ce que ce lot vérifie, c'est que le moteur réagit dans le bon
sens sur du contenu et des domaines plausibles, pas qu'il atteint un niveau
précis par construction.
