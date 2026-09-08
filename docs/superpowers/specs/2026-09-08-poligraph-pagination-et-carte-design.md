# Pagination bidirectionnelle et carte des circonscriptions

Conception validée le 2026-09-08. Deux chantiers indépendants qui partagent
une dépendance : l'un et l'autre demandent que le navigateur puisse interroger
l'API GraphQL directement, ce que rien ne permet aujourd'hui.

## 1. Le problème constaté

### 1.1 De la donnée paginée qu'on n'atteint jamais

Un audit de tous les points où de la donnée est paginée donne ceci :

| Endroit | État |
| --- | --- |
| Ingestion (AN, RNE, CNCCFP, résultats) | Aucune pagination HTTP. Les quatre adaptateurs téléchargent des fichiers entiers par `SourceFileClient`. Rien ne s'y perd. |
| `apps/web/src/lib/filter-options.ts` | Correct : boucle sur `hasNextPage`, 200 par page, garde-fou à 20 pages. |
| `apps/web/src/lib/queries.ts` — `ballotPositions(first: 25)` | **Figé.** Nicolas Metzdorf a 2 518 positions de vote ; la fiche en montre 25 et n'offre aucun moyen d'atteindre les 2 493 autres. |
| `/deputes` | Pagination en avant seulement : « Page suivante → » et « retour à la première page ». Aucun retour arrière. |
| Recherche de l'accueil | Plafonnée à 25 (sur 50 possibles), annoncée mais sans suite. |

La fiche est honnête — elle affiche « 25 affichés sur 2 518 » — mais l'honnêteté
ne remplace pas l'accès. C'est le trou principal.

### 1.2 Aucune donnée géographique en base

`silver.territory` (736 lignes) porte `type`, `code`, `label`, `parent_id`, et
rien d'autre. Pas de coordonnées, pas de contours. Toute carte suppose donc
d'importer une source géographique, et la ligne du projet impose qu'elle
arrive par le pipeline, avec sa provenance, comme n'importe quelle autre
source.

## 2. Ce qui a été tranché

| Question | Décision |
| --- | --- |
| Granularité de la carte | Deux niveaux : départements, puis circonscriptions au zoom |
| Où vit la géométrie | Importée par le pipeline pour la provenance, servie en asset statique |
| Rendu | Leaflet avec fond de carte OpenStreetMap |
| Pagination | Curseurs bidirectionnels, côté API et côté front |
| Front | On continue dans `apps/web` ; le neuf est rendu côté client |

Les trois pages existantes (accueil, `/deputes`, fiche) restent en rendu
serveur. Elles ne sont pas dans le périmètre.

## 3. Pagination bidirectionnelle

### 3.1 Ce que la lecture du code change à l'estimation

`apps/api/src/graphql/common/cursor.ts` encode un **offset** en base64
(`offset:42`), et non une clé de tri. La conséquence est heureuse : le retour
arrière ne demande ni requête inversée, ni re-tri, ni clé composite. Il se
calcule.

Elle a aussi une contrepartie qu'il faut dire : un curseur-offset ne protège
pas contre le décalage. Si `gold.deputy_card` est rafraîchie entre deux pages,
une ligne peut être sautée ou vue deux fois. Le module le documente déjà comme
un compromis assumé pour la V1 ; cette conception ne le corrige pas, elle
n'aggrave rien non plus.

### 3.2 API

`PageInfo` (`apps/api/src/graphql/common/connection.ts`) gagne deux champs :

```graphql
type PageInfo {
  startCursor: String        # nouveau
  endCursor: String
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!  # nouveau
}
```

Sémantique, avec `offset` la position de départ de la page et `pageSize` sa
taille :

- `startCursor` vaut `encodeCursor(offset)` — la position *avant* le premier
  élément, symétrique de `endCursor` qui vaut `encodeCursor(offset + n)`
- `hasPreviousPage` vaut `offset > 0`

Les deux résolveurs paginés acceptent un argument `before` en plus de `after` :

- `after` : `offset = decodeCursor(after)`, inchangé
- `before` : `offset = max(0, decodeCursor(before) - pageSize)`
- `after` et `before` ensemble : erreur explicite, jamais un choix implicite

Il n'y a pas d'argument `last`. La taille de page reste portée par `first`
dans les deux sens : `last` n'apporterait rien sur des offsets et doublerait
les chemins à tester.

### 3.3 Extraction au passage

`apps/api/src/graphql/resolvers/deputy.resolver.ts` assemble aujourd'hui une
connexion à la main deux fois (lignes ~90-110 et ~173-190), avec le même
calcul de curseurs, de `hasNextPage` et de `endCursor` recopié. Ajouter deux
champs dans les deux copies, c'est inviter la troisième divergence.

On extrait donc une fonction `buildConnection({ rows, offset, totalCount })`
dans `connection.ts`, seule responsable de la fabrication des arêtes et du
`PageInfo`. Les deux résolveurs l'appellent. C'est le seul remaniement prévu :
pas de refonte des dépôts, pas de touche aux modèles.

### 3.4 Front

**`/deputes`** — le composant de navigation passe de un lien à trois :
« ← Précédent », la position (« 26-50 sur 577 »), « Suivant → ». Les liens
continuent de passer par `buildListHref`, qui préserve les filtres actifs par
construction : c'est déjà le cas et ce n'est pas à refaire. `buildListHref` et
`DeputyListParams` gagnent `before` à côté de `after`.

`isPastLastPage` reste valable telle quelle : un `before` forgé ne peut pas
produire de page vide, puisqu'il est borné à zéro.

**Fiche député** — l'historique de vote devient un composant client qui
interroge l'API depuis le navigateur (§5) et garde son curseur dans son propre
état. Le reste de la fiche ne bouge pas : cinq des six sections restent
rendues côté serveur.

Ce choix a une conséquence à assumer : l'historique de vote n'est plus dans le
HTML initial, donc plus indexable ni lisible sans JavaScript. Les cinq autres
sections, elles, le restent.

## 4. Carte

### 4.1 La source, vérifiée

[Contours géographiques des circonscriptions législatives](https://www.data.gouv.fr/datasets/contours-geographiques-des-circonscriptions-legislatives),
data.gouv.fr, Licence Ouverte 2.0, mis à jour le 13/06/2024.

Ressource retenue : le GeoJSON « simplifié p20 », 5,2 Mo,
`https://www.data.gouv.fr/api/1/datasets/r/8b681b69-739c-47eb-a96b-06e8e2d8dc08`.
Le fichier a été téléchargé et inspecté pour écrire cette section : 559
entités, une propriété `codeDepartement` et une propriété
`codeCirconscription` sur chacune.

**Un seul fichier sert les deux niveaux.** Chaque entité portant son
`codeDepartement`, le niveau départemental s'obtient en regroupant les
circonscriptions : pas de second import, pas de fusion de polygones, et
surtout aucun risque que les deux couches se contredisent.

### 4.2 La correspondance des codes

Nos codes (`silver.territory.code`, `gold.deputy_card.constituency_code`) et
ceux du GeoJSON ne coïncident pas. La règle, établie en comparant les 577
codes réels aux 559 du fichier :

| Notre code | Code GeoJSON | Cas |
| --- | --- | --- |
| `01-4` | `0104` | métropole : département sur 2 caractères, rang sur 2 |
| `2A-1` | `2A01` | Corse : le département reste littéral |
| `971-1` | `ZA01` | Guadeloupe |
| `972-1` | `ZB01` | Martinique |
| `973-1` | `ZC01` | Guyane |
| `974-7` | `ZD07` | La Réunion |
| `975-1` | `ZS01` | Saint-Pierre-et-Miquelon |
| `976-2` | `ZM02` | Mayotte |

Le GeoJSON emploie les codes INSEE historiques à lettre pour l'outre-mer. La
table de correspondance est donc une donnée de la conception, pas une
dérivation : elle est écrite en clair et testée code par code.

### 4.3 Les 18 députés sans contour

**559 des 577 députés ont une géométrie.** Les 18 autres n'en ont aucune dans
la source :

| Département | Députés | Raison |
| --- | --- | --- |
| `099` Français de l'étranger | 11 | pas de territoire cartographiable, par nature |
| `987` Polynésie française | 3 | absent du fichier |
| `988` Nouvelle-Calédonie | 2 | absent du fichier |
| `986` Wallis-et-Futuna | 1 | absent du fichier |
| `977` Saint-Martin / Saint-Barthélemy | 1 | absent du fichier |

La carte les nomme sous elle, dans une liste titrée, avec un lien vers chaque
fiche. Les faire disparaître de l'interface parce que la source ne les
géolocalise pas serait le même défaut que publier un taux de participation de
0 % tiré d'un silence : laisser croire à une absence qui n'existe pas.

Le compte des députés affichés sur la carte doit donc toujours se lire
« 559 sur 577 », jamais « 559 ».

### 4.4 Ingestion

Nouvel adaptateur `packages/ingestion/src/adapters/geo/`, sur le modèle des
quatre existants :

- `geo.adapter.ts` — descripteur de ressource, téléchargement par
  `SourceFileClient` (sha256, cache)
- `stage-geo.ts` — une ligne bronze par entité, valeurs brutes, rejouable sans
  doublon dans un même run, comme tous les autres étages
- normalisation vers `silver` : la source `DATA_GOUV` existe déjà ; on ajoute
  le `dataset`, le `dataset_resource` et la `provenance`

Puis un script d'émission écrit `apps/web/public/geo/circonscriptions.json`.
Format : TopoJSON, pour l'arc partagé entre circonscriptions voisines — c'est
ce qui fait la différence entre un fichier de plusieurs mégaoctets et un
fichier que le navigateur charge sans y penser.

L'asset émis est versionné dans le dépôt. Il est dérivé, mais il est aussi la
seule chose que le front sert, et un `pnpm install` ne doit pas exiger un
import complet pour que la carte s'affiche.

### 4.5 Page `/carte`

Composant client, Leaflet et tuiles OpenStreetMap.

- Vue France : les 559 circonscriptions, chacune coloriée par le groupe
  parlementaire de son député, teintes reprises de `current_group_color`
- Survol : infobulle avec le nom du député, son groupe, sa circonscription
- Clic : navigation vers la fiche
- Deux niveaux, une seule géométrie. Au niveau France, les circonscriptions
  d'un même département sont dessinées d'une seule couleur — celle du groupe
  majoritaire du département — et leurs frontières internes sont masquées :
  le visiteur voit 101 zones. Passé un seuil de zoom, les frontières
  réapparaissent et chaque circonscription reprend la couleur de son propre
  député. Aucun second fichier, aucune fusion de polygones : seulement un
  trait et une couleur qui changent
- Le seuil de bascule est un réglage unique, nommé et testé, pas une valeur
  dispersée dans le composant
- Sous la carte : la liste des 18, et la ligne de provenance de la source
  géographique, au même format que les autres sections du site

**Dépendance externe assumée.** Les tuiles viennent de
`tile.openstreetmap.org` : l'adresse IP de chaque visiteur part chez un tiers,
et la carte ne s'affiche pas si ce tiers est indisponible. C'est un arbitrage
explicite, pris en connaissance de cause au moment de la conception, contre
une carte SVG sans fond cartographique.

## 5. Accès à l'API depuis le navigateur

Rien ne le permet aujourd'hui : l'API n'est jointe que par le réseau Docker
interne, et `graphql-fetch.ts` porte en tête « destiné aux Server Components
uniquement ».

- **CORS** : `enableCors` dans `apps/api/src/server.ts`, origine lue dans
  l'environnement, pas de joker en dur
- **`NEXT_PUBLIC_POLIGRAPH_API_URL`** : l'URL joignable depuis le navigateur
  (`http://localhost:30001/graphql` en développement). `POLIGRAPH_API_URL`
  reste en place, inchangée, pour les trois pages serveur
- **`graphql-fetch-client.ts`** : jumeau navigateur de l'existant, avec la
  même discipline — on regarde `body.errors` avant `body.data`, parce que
  GraphQL répond volontiers `200 OK` sur une panne

Deux points à surveiller, sans action prévue à ce stade : le `ThrottlerModule`
est réglé à 120 requêtes par minute et par IP, et comptait jusqu'ici un seul
client (le serveur Next) ; il comptera désormais des visiteurs. Et
`introspection: true` devient visible de tous dès que l'API est exposée.

## 6. Tests

**API** — `startCursor` et `hasPreviousPage` sur la première page, une page du
milieu et la dernière ; `before` borné à zéro ; `after` et `before` ensemble
rejetés ; `buildConnection` couverte directement, une seule fois, plutôt que
deux fois à travers ses appelants.

**Ingestion** — la table de correspondance des codes, cas par cas : les huit
formes du tableau §4.2 et les 18 absents nommés dans un test qui échoue si
l'un d'eux gagne ou perd un contour. Les étages bronze suivent les tests
existants : une ligne par entité, valeurs brutes, rejouabilité.

**Web** — le composant de pagination (ses trois états : première page, page du
milieu, dernière) et les fonctions pures de la carte, jointure et couleur par
groupe. Leaflet lui-même n'est pas testé : on teste ce qu'on écrit.

## 7. Hors périmètre

- Convertir les trois pages existantes au rendu client
- Corriger le décalage possible des curseurs-offsets (§3.1)
- La recherche de l'accueil, qui garde son plafond de 25
- Un second jeu géographique pour les départements (§4.1)
