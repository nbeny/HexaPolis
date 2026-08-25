# PoliGraph — Fiche de transparence des députés (V1)

**Date** : 2026-08-25
**Dépôt** : HexaPolis
**Statut** : design validé, prêt pour la planification d'implémentation

---

## 1. Objectif

PoliGraph permet de chercher un député et de consulter une fiche complète et sourcée : identité,
mandats, groupe politique, commissions, activité de vote, résultats électoraux et financement de
campagne.

La promesse tient en une phrase : **chaque information affichée est rattachable à sa source
officielle**. Un utilisateur doit pouvoir demander « pourquoi PoliGraph affirme-t-il cela ? » et
obtenir la chaîne complète, jusqu'au fichier publié par l'administration.

### Note de nommage

Le produit s'appelle **PoliGraph** ; le dépôt s'appelle **HexaPolis**. Les deux noms coexistent :
`HexaPolis` désigne le dépôt et l'organisation du code, `PoliGraph` désigne le produit, la CLI
(`poligraph`) et l'API.

---

## 2. Périmètre de la V1

### Dans le périmètre

| Dimension | Décision |
|---|---|
| Personnes exposées | Les députés de la législature en cours (17e), ~577 fiches |
| Profondeur des votes | Scrutins des 14e, 15e, 16e et 17e législatures |
| Historique des mandats | Fourni par l'Assemblée nationale (le RNE ne couvre que les mandats en cours) |
| Financement | Comptes de campagne des législatives 2012, 2017 et 2022 ; comptes des partis |
| Rafraîchissement | CLI manuelle, idempotente et rejouable |
| Arbitrage d'identité | Fichier de décisions versionné dans git + commande de revue |

### Conséquence à assumer : périmètre d'import ≠ périmètre d'affichage

Importer les scrutins d'une législature impose d'importer **toutes** les positions de vote de cette
législature, donc des personnes qui ne sont plus députées aujourd'hui — sans quoi les décomptes
officiels ne peuvent pas être recomptés et vérifiés.

Décision : `bronze` et `silver` contiennent les députés des 14e à 17e législatures ; **l'API et le
front n'exposent que les députés de la 17e**. Ouvrir les fiches des députés antérieurs est un
changement de filtre en `gold`, pas une reprise du modèle.

### Hors périmètre V1

- Les domaines thématiques de data.gouv.fr (santé, énergie, agriculture, logement, sécurité,
  immigration, éducation, transport, finances publiques, démographie…). Ils ne servent pas une fiche
  de personne. Ils entrent en V2, sur l'architecture existante.
- Les ~500 000 élus locaux du RNE (maires, conseillers municipaux, départementaux, régionaux).
- Les sénateurs, faute de connecteur Sénat.
- Toute analyse ou classification générée automatiquement. Aucune n'existe en V1.
- L'extraction de données depuis des PDF (voir §3.4).

---

## 3. État réel des sources (vérifié le 2026-08-25)

### 3.1 Deux canaux d'accès, quatre adapters

Le RNE et la CNCCFP sont **distribués par data.gouv.fr**. Il n'existe donc que deux canaux réseau :

- `DataGouvClient` — API `https://www.data.gouv.fr/api/1/` : sert le RNE, la CNCCFP et les
  résultats électoraux.
- `AssembleeNationaleClient` — archives ZIP de `https://data.assemblee-nationale.fr` (XML et JSON).

Les quatre sources restent quatre **adapters** distincts, mais ne dupliquent pas la couche réseau.

### 3.2 Assemblée nationale

- Scrutins de la législature en cours : `Scrutins.json.zip` / `Scrutins.xml.zip`.
- Archives par législature : `/archives-16e/votes`, `/archives-xive/scrutins`, etc. — les 14e à 17e
  sont couvertes.
- Acteurs, mandats et organes : fichiers `AMO10` (composite), `AMO40` et `AMO50` (éclatés), en
  XML, JSON et CSV.
- L'identifiant d'acteur (`PA…`) est **stable entre législatures**. C'est le pivot de l'identité.

### 3.3 RNE — Répertoire national des élus

- Dataset unique `5c34c4d1634f4173183a64f1` (Ministère de l'Intérieur), 12 ressources CSV.
- Seule `elus-deputes-dep.csv` est utilisée en V1.
- **Le RNE ne contient que les élus en exercice** : il n'apporte aucun historique. Il sert à
  enrichir l'identité et à fournir un identifiant externe supplémentaire.

### 3.4 CNCCFP

- Publie sur data.gouv.fr des jeux structurés par élection : législatives **2012**, **2017**
  (XLSX) et **2022** (CSV), sénatoriales, régionales, départementales, partielles, plus
  « Comptes des partis et groupements politiques » (CSV / XLSX / PDF).
- **Aucun jeu de données pour les législatives de 2024**, l'élection qui a produit les députés
  actuellement en exercice.

Règle retenue : **on n'importe que du structuré** (CSV / XLSX / JSON / API officielle). Aucune
extraction depuis PDF, aucun scraping, aucune valeur estimée. Quand la donnée n'existe pas dans un
format exploitable, la fiche affiche explicitement « donnée non disponible » avec un lien vers la
publication officielle.

Conséquence directe : la section « financement de campagne » sera vide pour la majorité des fiches
de la 17e législature. C'est un état assumé et affiché, pas un bug.

### 3.5 data.gouv.fr

Résultats des élections législatives par circonscription et référentiel géographique
(régions, départements, communes, circonscriptions).

---

## 4. Architecture

### 4.1 Monorepo

pnpm + Turborepo.

| Unité | Rôle | Dépend de |
|---|---|---|
| `apps/web` | Next.js (App Router). Consomme le GraphQL, n'accède **jamais** à Prisma. | schéma GraphQL |
| `apps/api` | NestJS : serveur GraphQL (code-first) et hôte de la CLI (`nest-commander`). | `packages/*` |
| `packages/db` | Schéma Prisma, migrations, client généré. Seul endroit qui connaît SQL. | — |
| `packages/ingestion` | Un adapter par source : téléchargement, parsing, normalisation. | `db`, `domain` |
| `packages/domain` | Entités métier, normalisation, entity resolution. **Aucune dépendance à une source ni à Prisma.** | — |

`packages/domain` matérialise la règle « le modèle interne est indépendant des fournisseurs de
données ». Ajouter le Sénat, l'INSEE, la DARES, Eurostat ou tout autre organisme = un nouvel
adapter dans `packages/ingestion`, sans modifier `domain` ni `db`.

### 4.2 Flux

```
data.gouv API   ─┐
AN archives ZIP ─┴─► BRONZE ──► SILVER ──► GOLD ──► GraphQL ──► Next.js
                    (fidèle)   (normalisé) (lecture)
```

Trois schémas PostgreSQL distincts (`bronze`, `silver`, `gold`), via
`previewFeatures = ["multiSchema"]` de Prisma.

- **`bronze`** — une table de staging par ressource source, colonnes en texte brut, plus la
  provenance (import, ressource, numéro de ligne, checksum). Jamais corrigée : c'est la photo de ce
  que la source a publié.
- **`silver`** — le modèle PoliGraph. Typé, dédupliqué, indépendant du fournisseur.
- **`gold`** — projections de lecture pour l'API, sous forme de **vues matérialisées** rafraîchies
  en fin d'import. Pas de tables dupliquées en V1 : moins de code de synchronisation. Promotion en
  tables si les mesures de performance l'exigent.

Le bronze est typé par ressource, ce qui a un coût en migrations. En V1 il est donc **limité aux
ressources réellement consommées par la fiche député** — pas aux 12 CSV du RNE.

Prisma gère mal les vues en écriture : les vues `gold` sont exposées en lecture seule.

---

## 5. Modèle de données (`silver`)

### 5.1 Identité

| Entité | Champs clés | Rôle |
|---|---|---|
| `Person` | nom d'usage, prénom, nom de famille, date de naissance, sexe, lieu de naissance | Entité centrale. Une seule par être humain, toutes sources confondues. |
| `PersonNameVariant` | personId, forme observée, source | Conserve « MACRON Emmanuel », « Emmanuel Macron ». Sert la résolution d'identité et la recherche. |
| `ExternalIdentifier` | ownerType, ownerId, source, type, valeur | `PA1592` (AN), identifiant RNE, slug data.gouv. Unicité sur (source, type, valeur). Polymorphe : sert aussi aux partis, territoires et élections. |

Il n'existe **pas** de `RnePerson`, `DeputyPerson`, `RneMayor` ni équivalent. Une seule `Person`,
enrichie par plusieurs sources via `ExternalIdentifier`.

### 5.2 Mandats et institutions

`Institution` (Assemblée nationale, Sénat, commune…) → `Legislature` (numéro, début, fin) →
`Mandate` (person, institution, type, territoire, législature, début, fin, cause de fin).

`Body` + `BodyMembership` couvrent **groupes parlementaires et commissions avec les mêmes tables**
(`type: PARLIAMENTARY_GROUP | COMMITTEE | DELEGATION`) : l'AN les publie déjà sous une forme unique
(« organes ») et ils partagent la même structure — une période, une qualité (membre, président,
apparenté).

`PoliticalParty` est **séparé** de `Body` : un parti n'est pas un organe parlementaire, il vit hors
de l'AN et porte les comptes CNCCFP.

### 5.3 Activité parlementaire

`ParliamentaryBallot` — scrutin : législature, numéro, date, intitulé, type, résultat, décomptes
officiels publiés par l'AN.

`BallotPosition` — position individuelle : scrutin, person, position
(`POUR | CONTRE | ABSTENTION | NON_VOTANT`), motif d'absence, **groupe au moment du vote**.

Le nommage évite `Vote` seul, ambigu dans ce projet entre bulletin d'électeur et position de député.

Stocker le groupe au moment du vote est délibéré : un député qui change de groupe ne doit pas
réécrire l'historique de ses votes passés.

### 5.4 Élections et financement

`Election` (type, tours, dates) → `Candidacy` (person, élection, territoire, parti, nuance, voix,
pourcentage, élu ou non) → `CampaignAccount` (candidature, recettes, dépenses, plafond,
remboursement, sens de la décision CNCCFP).

`PartyAccount` (parti, exercice, recettes, dépenses, dons, aide publique).

Le financement s'accroche à la **candidature**, pas à la personne : c'est ainsi que la CNCCFP
publie, et cela évite d'additionner des campagnes distinctes.

Aucun montant financier n'est estimé, arrondi ou recalculé. La valeur officielle est conservée telle
que publiée.

### 5.5 Territoires

`Territory`, auto-référencée : type (`REGION | DEPARTEMENT | COMMUNE | CIRCONSCRIPTION | EPCI`),
code officiel, nom, parent.

### 5.6 Provenance

`Source → Dataset → DatasetResource → Import`, puis une table `Provenance` polymorphe :
entityType, entityId, champ, importId, référence de la ligne bronze.

Polymorphe plutôt qu'une colonne `sourceId` par table, pour deux raisons :

1. un même fait peut être attesté par plusieurs sources (un mandat de député confirmé par l'AN
   *et* par le RNE) ;
2. la question « d'où vient cette information ? » se pose au niveau du **champ**, pas seulement de
   la ligne.

### 5.7 Statut des faits

Chaque fait porte un statut : `OFFICIAL | NORMALIZED | COMPUTED`.

Aucune valeur produite par un traitement ne peut porter le statut `OFFICIAL`. Il n'existe pas de
statut lié à l'IA en V1 puisqu'aucune analyse générée n'est produite ; la valeur d'enum sera ajoutée
le jour où cette fonctionnalité existera.

---

## 6. Pipeline d'ingestion

### 6.1 Contrat des adapters

```ts
interface SourceAdapter {
  readonly source: SourceKey                          // AN | DATA_GOUV | CNCCFP | RNE
  discover(): Promise<ResourceDescriptor[]>           // que publie la source aujourd'hui ?
  fetch(r: ResourceDescriptor): Promise<FetchedFile>  // téléchargement + checksum
  stage(f: FetchedFile, run: ImportRun): Promise<StageReport>    // → bronze, sans interprétation
  normalize(run: ImportRun): Promise<NormalizeReport> // bronze → silver, via packages/domain
}
```

Correspondance avec les étapes initialement envisagées :

| Étape envisagée | Où elle vit |
|---|---|
| `download` | fusionnée dans `fetch` |
| `validate`, `parse` | à l'intérieur de `stage` — une ligne mal formée produit un rejet, pas une exception |
| `deduplicate` | hors adapter : c'est l'entity resolution (§7), partagée par toutes les sources |
| `persist` | résultat de `stage` et `normalize` |
| `report` | valeur de retour, pas une étape |

### 6.2 Idempotence et rejouabilité

Une ressource est identifiée par `(source, resourceId, checksum)`.

- Checksum inchangé → `stage` est sauté, la CLI l'indique explicitement.
- `normalize` est rejouable seul (`--renormalize`), **sans accès réseau** : c'est ce qui permet de
  corriger un parser et de rejouer l'import à partir du bronze.
- En `silver`, tout est upsert par clé naturelle.

### Limite connue : changer la formule d'une clé naturelle

Une clé naturelle est calculée à partir des données, et non stockée par la source. Si sa formule
change — parce qu'elle s'avérait insuffisamment discriminante —, les lignes déjà écrites conservent
l'ancienne clé. La renormalisation ne les retrouve plus : au lieu de les mettre à jour, elle crée un
jeu parallèle et laisse les anciennes orphelines.

Constaté en conditions réelles : l'ajout de la qualité à la clé de `BodyMembership` a produit
1382 nouvelles lignes à côté des 1323 existantes.

Conséquence à retenir pour les plans suivants : **une modification de formule de clé naturelle est
une migration de données, pas une correction de code.** Elle exige de purger les lignes de l'ancien
format, ou de recalculer les clés existantes, avant de renormaliser. Tant que le `bronze` est
conservé, l'état correct reste reconstructible sans nouveau téléchargement — c'est précisément à cela
que sert l'archivage du brut.

### 6.3 Aucun échec silencieux

Toute ligne non intégrée est enregistrée dans `ImportRejection` (run, référence bronze, code,
message) et comptée dans le rapport final :

```
lues / créées / mises à jour / inchangées / rejetées / en attente d'arbitrage
```

Une ligne ne peut pas disparaître entre bronze et silver sans laisser de trace.

### 6.4 Ordre d'exécution

Imposé par les dépendances : territoires → acteurs et mandats AN → scrutins AN → enrichissement RNE
→ résultats électoraux → comptes CNCCFP.

`import all` enchaîne dans cet ordre ; chaque commande reste lançable seule.

```
poligraph import an:acteurs   --legislature 17
poligraph import an:scrutins  --legislature 14,15,16,17
poligraph import rne:deputes
poligraph import cnccfp:comptes-campagne --election legislatives-2022
poligraph import all
poligraph resolve review
poligraph gold refresh
poligraph check
```

### 6.5 Périmètre des adapters en V1

- **AN** — acteurs, mandats, organes (`AMO*`) et scrutins des 14e à 17e législatures. Adapter le
  plus lourd, seul à gérer XML et ZIP.
- **RNE** — `elus-deputes-dep.csv` uniquement.
- **CNCCFP** — comptes de campagne des législatives 2012, 2017, 2022 + comptes des partis.
- **data.gouv** — résultats des législatives par circonscription + référentiel géographique.

### 6.6 Fichiers téléchargés

Conservés dans `.data/` (hors git), nommés par checksum, jamais réécrits. Le bronze porte le lien
vers le fichier. Si `.data/` est purgé, le bronze reste suffisant pour renormaliser — le fichier ne
sert qu'à re-stager.

---

## 7. Entity resolution

### 7.1 Les trois rapprochements

| Rapprochement | Éléments communs | Difficulté |
|---|---|---|
| AN 14e ↔ AN 17e | identifiant `PA…` stable entre législatures | triviale |
| RNE ↔ AN | nom, prénom, date de naissance, circonscription | faible |
| CNCCFP ↔ AN | nom, prénom, élection, circonscription — **pas de date de naissance** | réelle |

Les fichiers CNCCFP n'exposent ni date de naissance ni identifiant national. Le rattachement d'un
compte de campagne à une personne repose sur nom + circonscription + élection : discriminant dans
l'immense majorité des cas, mais pas certain.

### 7.2 Cascade de décision

| Niveau | Critère | Statut | Fusion |
|---|---|---|---|
| 1 | Identifiant externe déjà connu | `CONFIRMED` | automatique |
| 2 | Nom normalisé + date de naissance identiques | `CONFIRMED` | automatique |
| 3 | Nom normalisé + circonscription + période cohérente | `PROBABLE` | en attente d'arbitrage |
| 4 | Nom normalisé seul | `POSSIBLE` | en attente d'arbitrage |
| 5 | Contradiction (même identifiant, dates de naissance divergentes) | `CONFLICT` | bloquant, remonté en tête de rapport |

Seuls les niveaux 1 et 2 fusionnent sans intervention humaine.

### 7.3 Normalisation des noms

Appliquée **avant comparaison uniquement** : casse, accents, particules (« de », « d' »), traits
d'union, ordre nom/prénom, noms composés, noms d'usage différents du nom de naissance.

Chaque forme rencontrée est conservée dans `PersonNameVariant`. On normalise pour comparer, jamais
pour remplacer la donnée d'origine.

### 7.4 Arbitrages humains

Fichier `data/identity-decisions.yaml`, commité dans le dépôt :

```yaml
- decision: MERGE
  left:  { source: CNCCFP, key: "legislatives-2022:075-01:MARTIN Jean" }
  right: { source: AN, key: "PA721234" }
  reason: "Même circonscription, même parti, unique candidat de ce nom"
  decidedOn: 2026-08-25
```

Ce fichier est **prioritaire sur l'algorithme** et rejoué à chaque import : une décision prise une
fois n'est jamais redemandée. `SPLIT` sert au cas inverse — deux homonymes qu'un assouplissement
ultérieur des règles voudrait fusionner à tort.

`poligraph resolve review` liste les cas `PROBABLE`, `POSSIBLE` et `CONFLICT`, présente les
éléments de comparaison et écrit la décision dans le fichier.

### 7.5 Traitement des cas non résolus

Ce qui n'est pas résolu n'est pas affiché. Le fait reste en `bronze`, n'est pas projeté en `silver`,
et figure dans le rapport d'import et dans `resolve review`.

Une fiche ne montre jamais une donnée dont le rattachement est incertain : elle montre une absence.

---

## 8. API GraphQL

### 8.1 Schéma orienté fiche

```graphql
type Query {
  deputy(slug: String!): Deputy
  deputies(legislature: Int, groupId: ID, departmentCode: String,
           first: Int, after: String): DeputyConnection!
  search(query: String!, first: Int): [SearchHit!]!
  provenance(entityType: String!, entityId: ID!, field: String): [ProvenanceRecord!]!
}

type Deputy {
  id: ID!
  displayName: String!
  mandates: [Mandate!]!
  groupMemberships: [BodyMembership!]!
  committees: [BodyMembership!]!
  ballotPositions(legislature: Int, first: Int, after: String): BallotPositionConnection!
  votingSummary(legislature: Int): VotingSummary!
  candidacies: [Candidacy!]!
  sources: [SourceRef!]!
}
```

Le slug est bâti sur l'identifiant AN (`/deputes/pa721234-jean-martin`) : les homonymes existent, un
slug purement nominal finirait par en écraser un.

Conformément au périmètre d'affichage (§2), `deputies` et `deputy` ne renvoient en V1 que des
députés de la 17e législature. L'argument `legislature` filtre l'**activité** consultée (les
scrutins d'une législature antérieure à laquelle le député a participé), pas la population des
fiches accessibles.

### 8.2 Exposition de la provenance

Deux niveaux, pour ne pas rendre le schéma illisible :

- chaque **objet** porte `sources: [SourceRef!]!` — suffisant pour afficher « source : Assemblée
  nationale, importé le 25/08/2026 » sous chaque section ;
- la query `provenance(entityType, entityId, field)` donne le détail **au champ**, jusqu'à la ligne
  bronze.

Envelopper chaque valeur dans un `SourcedValue { value, source, importedAt }` a été écarté : schéma
illisible et réponses considérablement alourdies pour un besoin qui reste ponctuel.

### 8.3 Volume et pagination

Quatre législatures de scrutins représentent plusieurs milliers de scrutins par législature
multipliés par ~577 positions.

- `ballotPositions` est paginé en connexion Relay et obligatoirement filtré par législature sur la
  fiche.
- Les agrégats sont portés par les vues matérialisées `gold`, jamais recalculés à l'affichage.

### 8.4 Sécurité

API publique en lecture seule, sans authentification en V1, mais avec :

- limite de profondeur de requête ;
- limite de complexité de requête ;
- rate limiting.

Sans ces protections, une API GraphQL publique est exposée au déni de service par requête imbriquée.

---

## 9. Front Next.js

App Router, Server Components interrogeant le GraphQL côté serveur, types générés depuis le schéma.
Pas de client GraphQL lourd côté navigateur : la fiche est une page de lecture.

**Routes**

- `/` — recherche
- `/deputes` — liste filtrable par législature, groupe, département
- `/deputes/[slug]` — fiche

**Six sections de fiche** : identité · mandats · groupe et commissions · activité de vote ·
élections et résultats · financement.

Chaque section affiche sa source et sa date d'import. Quand la donnée manque, elle affiche un état
explicite « donnée non disponible » avec un lien vers la publication officielle — c'est le cas le
plus fréquent pour le financement en 17e législature, et l'interface doit le traiter comme un état
légitime, pas comme un vide.

`votingSummary` (taux de participation aux scrutins, cohérence avec le groupe) est une donnée
`COMPUTED` et doit être visuellement distincte des faits officiels. La distinction entre donnée
officielle et donnée calculée doit se voir, pas se deviner.

---

## 10. Tests et vérification

Sur un projet de données, la plupart des défauts ne sont pas des exceptions : ce sont des chiffres
faux affichés sans erreur. La stratégie est construite autour de ce constat.

### 10.1 Niveaux de test

1. **Unitaires sur `packages/domain`** — sans I/O. Normalisation des noms, cascade de résolution
   d'identité, application du fichier de décisions, règles de statut. C'est là que se concentre la
   logique risquée, testable sans base ni réseau parce que `domain` ne dépend de rien.
2. **Parsing sur fixtures réelles** — extraits authentiques de quelques kilo-octets de chaque
   ressource (`Scrutins.json`, `AMO*`, CSV RNE, CSV CNCCFP), commités dans `fixtures/`. **Aucun test
   ne touche le réseau** : les sources changent, les tests ne doivent pas casser parce qu'un fichier
   a été republié.
3. **Intégration du pipeline** — PostgreSQL éphémère, import d'une fixture de bout en bout,
   assertions sur `bronze`, `silver` et le rapport.
4. **API** — schéma GraphQL sur base seedée.
5. **E2E** — un parcours de fiche.

### 10.2 Tests protégeant les règles centrales

- **Idempotence** : rejouer le même import crée 0 ligne et modifie 0 ligne.
- **Renormalisation hors ligne** : corriger un parser puis relancer `--renormalize` produit le
  résultat attendu sans aucun appel réseau.
- **Non-fusion** : deux homonymes sans date de naissance ne fusionnent jamais automatiquement.
- **Comptabilité des rejets** : une ligne malformée produit un rejet tracé, pas une exception, et le
  compteur du rapport est exact.

### 10.3 Contrôles de cohérence sur données réelles

`poligraph check`, distinct des tests car portant sur les données importées et non sur le code :

- **Recompte des scrutins** — l'AN publie ses propres décomptes pour / contre / abstention. On
  recompte depuis les positions individuelles importées et on compare. Un écart signale
  immédiatement un défaut de parsing : c'est le contrôle le plus rentable du projet.
- Nombre de députés cohérent par législature.
- Mandats se chevauchant anormalement.
- Montants financiers négatifs ou hors plafond.
- Positions de vote orphelines.

### 10.4 CI

Lint, typecheck, tests unitaires et d'intégration sur PostgreSQL, build.

L'implémentation suit le TDD : test d'abord, pour chaque règle de normalisation et de résolution.

---

## 11. Extensibilité

L'architecture n'est pas limitée aux quatre sources prioritaires. Ajouter le Sénat, l'INSEE, la
DARES, la DREES, la Banque de France, Eurostat, l'OCDE, l'INED, un ministère ou une collectivité
consiste à :

1. écrire un adapter implémentant `SourceAdapter` dans `packages/ingestion` ;
2. ajouter les tables `bronze` correspondantes ;
3. écrire la normalisation vers les entités existantes de `silver`.

Aucune modification de `packages/domain`, du schéma `silver` ou de l'API n'est requise pour une
source qui décrit des personnes, des mandats, des partis, des élections ou des territoires déjà
modélisés.

L'ouverture aux domaines thématiques (indicateurs économiques, immigration, santé, logement,
sécurité, énergie…) relève de la V2 et introduira une entité `Indicator` distincte, sans toucher au
modèle des personnes.
