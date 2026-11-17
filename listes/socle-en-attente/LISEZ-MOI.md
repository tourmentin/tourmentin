# Empreintes en attente (banques et services financiers)

Brouillons issus de la lecture des pages réelles le 17/11/2026 (spec 14.87). Ils ne sont **pas lus** par le générateur ni par les tests : rien n'est publié.

Pour en activer un :
1. compléter à la main `couleurs` et `format_identifiant` (le schéma les exige ; non relevés ici, rien n'a été inventé) ;
2. relire les libellés sur la page de connexion réelle (protocole `../verifier-socle.md`), surtout pour les six marques dont la connexion n'a pas été lue (SG, BNP Paribas, Crédit Agricole, Caisse d'Épargne, Revolut, Monetico) ;
3. mesurer les faux positifs sur le corpus (`corpus/`, 3 580 sites légitimes) : le faux positif est l'échec principal ;
4. déplacer le fichier dans `../socle/`, mettre à jour les tests qui comptent les marques (12 aujourd'hui), régénérer et signer.

Vérifié le 17/11/2026 : LCL, La Banque Postale, Crédit Mutuel, BoursoBank (domaine et libellés de connexion lus). Partiels : les six autres (domaine d'accueil seulement).
