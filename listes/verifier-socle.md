# Protocole de vérification du socle

Aucune des 12 empreintes ne doit être activée en production avant d'avoir été
confirmée sur la page réelle. Les pages de connexion des services publics sont
protégées contre la lecture automatisée : la vérification se fait à la main, une
fois, et se refait à chaque refonte du service.

## Pour chaque marque

1. Ouvrir la page de connexion officielle dans un navigateur privé.
2. Relever la barre d'adresse exacte, y compris après redirection. C'est cette
   valeur qui alimente `domaines`, pas celle de la page d'accueil.
3. Copier les libellés des champs tels qu'affichés, avec accents et casse.
4. Vérifier chaque `terme_fort` : rechercher l'expression sur la page (Ctrl+F).
   Si elle n'y figure pas littéralement, la corriger ou la retirer.
5. Passer `a_verifier` à `false` et dater dans `notes_verification`.

Le champ `a_verifier` ne commande pas la publication. Seul `actif` le fait.
Une marque peut donc être publiée sans avoir été vérifiée — c'est l'état actuel
des neuf marques du MVP — et l'objet de ce protocole est précisément de résorber
cet écart avant la mise en production.

## Critère d'un bon terme fort

Un terme fort pèse 30 points dans le moteur, soit près de la moitié du seuil
d'alerte. Le test à appliquer : si cette expression apparaît sur une page
quelconque du web, y a-t-il une forte présomption que cette page prétend être ce
service ? « espace particulier » passe le test, « impôts » ne le passe pas.

Contre-épreuve obligatoire : chercher l'expression entre guillemets dans un
moteur de recherche. Si elle remonte des pages sans rapport avec le service, le
terme est trop faible et doit être retiré.

## Trois marques à laisser désactivées dans le MVP

| Marque | Raison |
|---|---|
| MSA | 35 caisses régionales avec autant de domaines locaux non recensés. Risque de faux positifs élevé tant que la liste n'est pas exhaustive. |
| Chorus Pro | Aucun domaine confirmé, et paysage de la facturation électronique de l'État en cours d'évolution. |
| Timbres fiscaux | Domaine non confirmé, et absence de compte utilisateur : l'axe Exposition doit être adapté au signal « formulaire de paiement » avant activation. |

Le MVP démarre donc à 9 marques actives, ce qui est suffisant pour le calibrage
du lot L6 et évite d'introduire des faux positifs dès la première mesure.

## Cas particuliers relevés

**La Poste et Timbres fiscaux** n'ont pas de mot de passe dans le schéma
d'attaque dominant : la victime paie de faux frais. Le moteur doit donc traiter
la présence d'un formulaire de carte bancaire comme un signal d'exposition à
part entière, au même poids qu'un champ mot de passe. C'est un ajout à la
spécification, chapitre 5.4, à intégrer avant le lot L1.

**FranceConnect** est la cible la plus rentable, puisqu'une fausse mire donne
accès à tous les services connectés. Un seuil abaissé pour cette marque a été
envisagé, puis reporté : c'est une question de calibrage, tranchée au lot L6 sur
les chiffres, pas une décision de conception. Voir le chapitre 12.6 de la spec.

**France Travail** conserve les racines « pole-emploi » : les campagnes de
phishing exploitent encore l'ancienne marque, plus de deux ans après la bascule.
