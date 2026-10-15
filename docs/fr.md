# MikroTik

Suivez votre routeur [MikroTik](https://mikrotik.com) depuis Gladys, sur votre
réseau local : sachez qui est à la maison grâce aux téléphones connectés à
votre Wi-Fi, surveillez la santé du routeur et les débits de votre accès
internet, soyez prévenu quand le WAN coupe ou qu'un appareil inconnu se
connecte et, si vous l'autorisez, coupez internet sur la tablette des enfants
depuis une scène.

> **Développée sans le matériel : vos retours sont bienvenus.** Cette
> intégration a été écrite et testée sur les réponses documentées par MikroTik
> et les données de test de l'intégration Home Assistant, pas sur un vrai
> routeur. Si quelque chose ne marche pas comme décrit, dites-le sur le
> [forum Gladys](https://community.gladysassistant.com) ou dans les
> [issues](https://github.com/guim31/gladys-mikrotik/issues).

Cette intégration n'est pas affiliée à MikroTik.

## Ce qu'il vous faut

- Gladys Assistant 5.1.0 ou plus récent.
- Un routeur MikroTik sous **RouterOS 7** (API REST) ou **RouterOS 6.43** ou
  plus récent (API), joignable depuis Gladys.
- Un de ces services RouterOS activé (**IP** → **Services**) : `www-ssl`
  (HTTPS, RouterOS 7), `api-ssl`, `www` (HTTP, RouterOS 7) ou `api`. La
  configuration par défaut de RouterOS active `www` et `api`.
- Un utilisateur RouterOS pour Gladys (voir ci-dessous).

## Mise en place

### L'utilisateur RouterOS

Créez un utilisateur dédié plutôt que d'utiliser `admin`. Un compte en
**lecture seule** suffit pour les capteurs de présence, les mesures, les
déclencheurs et les widgets. Dans un terminal (WinBox, WebFig ou SSH) :

```
/user add name=gladys group=read password=un-long-mot-de-passe
```

Vérifiez que le groupe a le droit `api`, et `rest-api` sous RouterOS 7
(**System** → **Users** → **Groups**). Les commandes (règles de pare-feu,
redémarrage) demandent un groupe avec les droits `write` et `reboot`, comme
`write`.

Pour aller plus loin, n'autorisez le service que depuis l'adresse de Gladys,
par exemple `/ip service set www address=192.168.88.10/32`.

### La configuration

Ouvrez **Intégrations** → **MikroTik** → **Configuration** :

- **Adresse du routeur** : son adresse IP (`192.168.88.1` par défaut), avec
  `:port` si le service n'utilise pas son port par défaut.
- **Nom d'utilisateur** et **Mot de passe** de l'utilisateur RouterOS.
- **Protocole** : _Automatique_ essaie REST en HTTPS, API-SSL, REST en HTTP
  puis API, et garde le premier qui marche ; les chiffrés d'abord. Choisissez
  en un pour l'imposer.
- **Accepter un certificat auto-signé** : pour HTTPS et API-SSL. RouterOS
  utilise un certificat auto-signé si vous n'en avez pas installé d'autre.
- **Intervalle de rafraîchissement** : de 10 secondes à 1 minute (30 secondes
  par défaut).
- **Interfaces WAN** : vide, l'intégration prend les membres de la liste
  d'interfaces `WAN` de RouterOS (la configuration par défaut y met `ether1`),
  sinon `ether1`. Quatre noms au plus, séparés par des virgules.
- **Présence** : le **Délai de départ (minutes)** et les sources (voir plus bas).
- **Règles de pare-feu à suivre** et **Autoriser les commandes** (voir plus
  bas).
- **Langue des noms** : la langue des noms d'appareils et de fonctionnalités.

Appuyez ensuite sur **Tester la connexion** : le compte rendu indique le
protocole utilisé, les interfaces WAN suivies, le nombre de clients vus et si
les règles suivies existent. Ouvrez enfin l'onglet **Découverte** et ajoutez
les appareils voulus.

## Les appareils

### Le routeur

Un appareil, au nom de l'identité RouterOS :

| Fonctionnalité                  | Ce qu'elle montre                                  |
| ------------------------------- | -------------------------------------------------- |
| Charge du processeur            | en %                                               |
| Mémoire utilisée                | en %                                               |
| Température                     | en °C, quand le routeur a un capteur               |
| Temps de fonctionnement         | en heures                                          |
| Version de RouterOS             | ex. `7.18.2`                                       |
| Mise à jour RouterOS disponible | On quand RouterOS signale une version récente      |
| Débit descendant / montant      | par interface WAN, en Mbit/s, moyenne sur un cycle |
| Lien WAN                        | par interface WAN : On quand le lien est actif     |

L'intégration demande à RouterOS de chercher les mises à jour une fois par
jour (un utilisateur en lecture seule ne le peut pas : c'est alors la
dernière recherche faite par RouterOS qui s'affiche).

### Capteurs de présence

L'onglet Découverte liste les clients du routeur : ses baux DHCP, ses tables
d'enregistrement Wi-Fi (`wireless`, `wifiwave2`, `wifi` et CAPsMAN) et, si
activée, sa table ARP. Ajoutez les téléphones à suivre : chacun devient un
capteur **Présence**, nommé d'après son commentaire dans RouterOS, sinon son
nom d'hôte.

- Un appareil est **présent** dès que le routeur le voit : associé au Wi-Fi,
  ou avec une entrée ARP vivante si **Utiliser aussi la table ARP** est coché,
  ou avec un bail DHCP actif si **Compter un bail DHCP comme présent** est
  coché.
- Il ne devient **absent** que s'il n'a pas été vu pendant le **Délai de
  départ** (5 minutes par défaut) : un téléphone en veille quitte le Wi-Fi
  quelques minutes sans quitter la maison.
- Quand le routeur ne peut pas être lu, personne ne change d'état.

Un appareil présent est republié toutes les deux minutes, si bien que
l'action de scène _Vérifier la présence_ de Gladys fonctionne aussi ; avec le
délai de départ, elle sert rarement.

Les téléphones utilisent une adresse Wi-Fi privée (aléatoire) par réseau.
Gardez-la **fixe** pour le Wi-Fi de la maison (sur iOS : _Adresse Wi-Fi
privée_ sur _Fixe_ ; sur Android : aléatoire par réseau, pas par connexion),
sinon l'appareil paraîtra nouveau après un changement.

### Règles de pare-feu

Pour suivre une règle, donnez-lui un commentaire dans RouterOS (**IP** →
**Firewall** → **Filter Rules**), puis saisissez ce commentaire dans **Règles
de pare-feu à suivre** (**Lister les règles de pare-feu** affiche les règles
commentées). Chacune devient un appareil avec une fonctionnalité **Règle
activée** (On quand la règle est activée). Les règles IPv4 et IPv6 qui
partagent le commentaire comptent pour une.

L'état est en lecture seule. Avec **Autoriser les commandes** coché, les
actions de scène et le widget peuvent activer ou désactiver la règle :
l'intégration ne change alors que le drapeau `disabled` de ces règles, et rien
d'autre dans la configuration.

## Tableau de bord

Trois widgets :

- **Routeur MikroTik** : processeur, mémoire, température, débits descendant
  et montant de la première interface WAN, l'état de chaque lien WAN, le temps
  de fonctionnement, la version de RouterOS ou la mise à jour disponible, et
  un bouton **Redémarrer** (avec confirmation) quand les commandes sont
  autorisées.
- **Appareils présents** : les appareils suivis comme capteurs de présence,
  présents d'abord, avec depuis combien de temps les autres sont absents. Son
  réglage **Afficher** ne garde que les présents.
- **Règles de pare-feu** : les règles suivies et, quand les commandes sont
  autorisées, un bouton par règle (quatre au plus) pour l'activer ou la
  désactiver, avec confirmation. Une coche signale les règles activées.

## Scènes

### Déclencheurs

- **Appareil inconnu connecté** : une adresse MAC jamais vue s'est connectée
  au Wi-Fi ou a obtenu un bail DHCP. Les appareils présents au tout premier
  démarrage de l'intégration sont appris sans déclencher. Filtre : _Vu par_
  (Wi-Fi ou bail DHCP). Variables : adresse MAC, adresse IP, nom d'hôte, vu
  par, interface.
- **Lien WAN coupé** : une interface WAN a perdu son lien. Filtre :
  _Interface_. Variable : interface.
- **Lien WAN rétabli** : le lien est revenu. Filtre : _Interface_. Variables :
  interface, coupure en minutes.

### Actions

Elles demandent **Autoriser les commandes**, et un utilisateur RouterOS avec
les droits `write` et `reboot`.

- **Activer une règle de pare-feu** et **Désactiver une règle de pare-feu** :
  choisissez un appareil règle. Sortie : _Règle activée_.
- **Redémarrer le routeur MikroTik** : le réseau est coupé une à deux minutes.

### Idées de scènes

- _Personne à la maison_ : quand la présence de chaque téléphone est « Pas de
  présence », armez l'alarme et baissez le chauffage.
- _Extinction de la tablette_ : chaque soir à 21 h, **Activer une règle de
  pare-feu** « Bloquer tablette enfants » ; à 7 h, **Désactiver une règle de
  pare-feu**.
- _Coupure internet_ : sur **Lien WAN coupé**, envoyez un message par un canal
  qui n'a pas besoin d'internet (une passerelle SMS du réseau local), et sur
  **Lien WAN rétabli**, indiquez sa durée.
- _Qui est-ce ?_ : sur **Appareil inconnu connecté**, envoyez-vous un message
  avec son nom d'hôte et son adresse IP.

## À quelle fréquence le routeur est lu

L'intégration lit elle-même le routeur, à l'intervalle de rafraîchissement de
la configuration (Gladys n'interroge pas ces appareils). Une lecture, c'est
une dizaine de petites listes (ressources, santé, interfaces, Wi-Fi, ARP, baux
DHCP, règles) : négligeable pour le routeur. L'état des mises à jour est lu
toutes les heures, et RouterOS interroge les serveurs de MikroTik une fois par
jour. Seules les valeurs qui changent partent vers Gladys, plus un battement
de cœur toutes les six heures.

## Dépannage

- **« nom d'utilisateur ou mot de passe refusé »** : vérifiez-les dans WinBox.
  Après un refus, l'intégration réessaie toutes les cinq minutes (chaque essai
  est une ligne dans le journal de RouterOS).
- **« il manque une permission au groupe »** : donnez au groupe `api` (et
  `rest-api` sous RouterOS 7).
- **« certificat refusé »** : cochez **Accepter un certificat auto-signé**, ou
  installez un certificat reconnu par Gladys.
- **« ne répond pas »** : vérifiez l'adresse, que le service est activé dans
  **IP** → **Services** et que son champ `address` autorise Gladys.
- **Pas de débit WAN** : les débits demandent deux lectures ; vérifiez les
  noms dans **Interfaces WAN**.
- **Un téléphone reste absent** : cochez **Utiliser aussi la table ARP**,
  augmentez le délai de départ et vérifiez que son adresse Wi-Fi privée est
  fixe.
- Plus de détails : démarrez l'intégration avec `LOG_LEVEL=debug`. Au niveau
  par défaut, les logs ne montrent que le démarrage, le routeur perdu et
  retrouvé, les problèmes (une fois chacun) et vos commandes. Les mots de
  passe n'apparaissent jamais dans les logs.

## Limites

- Un routeur par intégration. Avec plusieurs points d'accès, suivez la
  présence sur celui qui voit tous les clients (le contrôleur CAPsMAN, ou le
  routeur avec la table ARP).
- L'état du lien WAN est celui de l'interface : une panne d'internet derrière
  un lien actif (côté opérateur) n'est pas vue.
- Les débits sont des moyennes sur l'intervalle de rafraîchissement, d'après
  les compteurs des interfaces.
- Les tables Wi-Fi des points d'accès d'autres marques ne sont pas lues :
  utilisez la table ARP.
- Les noms des appareils et des fonctionnalités sont fixés à l'ajout d'un
  appareil dans Gladys.
- Règles de filtrage du pare-feu seulement (pas de NAT, de mangle ni de Kid
  Control), trouvées par leur commentaire exact.
- Développée sans le matériel : les réponses de vrais routeurs peuvent
  différer de celles documentées. Vos retours sont bienvenus.
