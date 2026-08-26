# PoliGraph — Plan 5 : Résultats des élections législatives

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importer les résultats officiels des élections législatives de 2024, publiés par le ministère de l'Intérieur, pour que la section « élections et résultats » d'une fiche affiche les voix, le pourcentage et l'issue de la candidature — et non seulement le compte de campagne.

**Architecture:** Une source de plus derrière le contrat `SourceAdapter`, dont le format large impose un dépivotage. Les candidatures créées par la CNCCFP sont enrichies plutôt que dupliquées. Six élus dont les sources publient le nom différemment passent par le fichier d'arbitrage — c'est son usage prévu.

**Tech Stack:** inchangée.

**Spec de référence:** `docs/superpowers/specs/2026-08-25-poligraph-fiche-depute-design.md`
**Plans précédents:** p1 fondations, p2 scrutins, p3 identité, p4 gold et GraphQL

---

## Faits mesurés sur les fichiers réels

Vérifiés en téléchargeant et analysant les fichiers publiés, le 2026-08-26.

### Les deux ressources

Publiées par le ministère de l'Intérieur sur data.gouv.fr, **UTF-8**, séparateur **`;`** :

| Tour | Ressource | Taille | Lignes | Colonnes | Candidats max |
|---|---|---|---|---|---|
| 1er | `resultats-definitifs-par-circonscriptions-legislatives.csv` | 330 Ko | 577 | 189 | **19** |
| 2nd | `resultats-definitifs-par-circonscription.csv` | 147 Ko | 501 | 54 | 4 |

URL du 1er tour :
`https://static.data.gouv.fr/resources/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour/20240710-171413/resultats-definitifs-par-circonscriptions-legislatives.csv`

URL du 2nd tour :
`https://static.data.gouv.fr/resources/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-2nd-tour/20240710-170728/resultats-definitifs-par-circonscription.csv`

Noter que les deux fichiers **ne portent pas le même nom** : `circonscriptions-legislatives` au premier tour, `circonscription` au second.

### Le format est large, pas long

Les 18 premières colonnes décrivent la circonscription : code et libellé du département, **code de la circonscription** (`0101`), libellé, inscrits, votants, abstentions, exprimés, blancs, nuls, avec leurs pourcentages.

Ensuite, **neuf colonnes se répètent par candidat** : numéro de panneau, nuance, nom, prénom, sexe, voix, % voix/inscrits, % voix/exprimés, et un champ `Elu N` non vide pour le vainqueur.

Jusqu'à **19 candidats** sur une même ligne au premier tour. Le parseur doit dépivoter : une ligne du fichier produit N enregistrements de candidature.

Le nombre de blocs se déduit des colonnes : `(nbColonnes - 18) / 9`. Ne pas coder en dur 19 ou 4 — les deux fichiers diffèrent, et un scrutin futur différera encore.

### Volumes et cohérence

| Tour | Candidats dépivotés | Élus |
|---|---|---|
| 1er | 4 009 | **76** |
| 2nd | 1 094 | **501** |

76 + 501 = **577**, exactement le nombre de sièges. Cette égalité est un contrôle de lecture : si le total diffère, le dépivotage est fautif.

### Le code de circonscription est déjà connu

`Code circonscription législative` vaut `0101` — **le même format que le RNE**. La fonction de normalisation écrite au plan 3 (`0101` → `01-1`) s'applique telle quelle. Ne pas en écrire une seconde.

### Piège mesuré : les deux tours ne codent pas les départements pareil

Le fichier du **premier tour** omet le zéro initial des départements 1 à 9, celui du **second** le conserve :

| Source | Département | Circonscription |
|---|---|---|
| 1er tour | `1` | `101` |
| 2nd tour | `01` | `0101` |
| Base (`silver.territory`) | — | `01-1` |

La normalisation écrite au plan 3 découpe les deux derniers caractères. Appliquée à `101`, elle produit `1-1` au lieu de `01-1` : la circonscription n'est jamais retrouvée.

**34 circonscriptions sur 577** sont concernées au premier tour, aucune au second. Le correctif est de compléter le code de département à deux chiffres avant de composer la clé — mais sans lui, 34 circonscriptions et leurs élus se rattachent à un territoire inexistant, **sans lever la moindre erreur**.

Un test doit couvrir explicitement le code court : `101` doit donner `01-1`, comme `0101`.

### Rapprochement : 571 élus sur 577

Mesuré contre les 3 119 personnes en base, avec les fonctions de `packages/domain` :

| Tour | Élus rapprochés par le nom |
|---|---|
| 1er | **76 / 76** (100 %) |
| 2nd | **495 / 501** (98 %) |

**Six élus ne se rapprochent pas**, tous pour la même raison : les sources publient des formes différentes du nom.

| Résultats électoraux | En base (Assemblée nationale) |
|---|---|
| Sophie VAGINAY | Sophie **Ricourt** Vaginay |
| Yannick FAVENNEC | Yannick Favennec-**Bécot** |
| Benjamin LUCAS | Benjamin Lucas-**Lundy** |
| Emeline KBIDI | Émeline **K/Bidi** |
| Emmanuel TACHE DE LA PAGERIE | Emmanuel Taché |
| (un sixième, à identifier à l'import) | |

Le cas `KBIDI` est un retour de bâton de notre propre correctif : au plan 1 nous avons décidé de traiter la barre oblique comme un séparateur, produisant `k bidi`, tandis que cette source écrit le nom sans séparateur, produisant `kbidi`.

### Pourquoi la circonscription ne sert PAS de règle automatique

Une circonscription n'élit qu'un député, et pour ces six cas la circonscription désigne bien la bonne personne — vérifié.

Mais **68 circonscriptions sur 577 ont eu plusieurs députés** sous la 17e législature :

```
01-3 | Olga Givernet du 2024-07-07 | Sophie Delorme Duret du 2024-07-07
08-1 | Flavien Termet du 2024-07-07 | Lionel Vuibert du 2024-12-08
```

Le premier cas est un titulaire nommé au gouvernement dont la suppléante siège, **avec la même date de début** ; le second un remplacement en cours de mandat. Une règle « le député de cette circonscription » désignerait donc parfois le suppléant plutôt que l'élu.

**Décision : pas de niveau de cascade fondé sur la circonscription seule.** Les six cas partent en arbitrage, où le fichier de décisions les tranchera une fois pour toutes. C'est exactement l'usage pour lequel il a été construit, et six décisions écrites à la main coûtent moins qu'une règle automatique dont on ne maîtrise pas les 68 exceptions.

---

## Décisions de conception

1. **Les candidatures existantes sont enrichies, pas dupliquées.** Le plan 3 a créé 6 290 `Candidacy` depuis la CNCCFP pour l'élection de 2022. Ce plan importe 2024 : ce sont d'autres candidatures, rattachées à une autre `Election`. Mais la clé naturelle doit être conçue pour qu'un futur import CNCCFP 2024 retrouve ces candidatures au lieu d'en créer de secondes.
2. **Les voix et les pourcentages sont des faits officiels**, recopiés tels que publiés. Les pourcentages du fichier ne sont pas recalculés : ils viennent de la source et peuvent différer d'un arrondi maison.
3. **Le statut d'élu est un fait**, porté par la candidature.
4. **Les deux tours sont deux ressources distinctes** du même `SourceAdapter`, chacune avec son propre import et son propre checksum.
5. **Le dépivotage est déterminé par l'en-tête**, jamais codé en dur.

---

## Task 1 : Modèle des résultats

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/ingestion/tests/helpers/db.ts`

- [ ] **Step 1 : Table bronze**

```prisma
model ElectionResultRaw {
  id                  BigInt  @id @default(autoincrement())
  importRunId         String  @map("import_run_id")
  ligne               Int
  rang                Int
  codeDepartement     String? @map("code_departement")
  codeCirconscription String? @map("code_circonscription")
  libelleCirco        String? @map("libelle_circonscription")
  inscrits            String?
  votants             String?
  exprimes            String?
  blancs              String?
  nuls                String?
  nuance              String?
  nom                 String?
  prenom              String?
  sexe                String?
  voix                String?
  pctInscrits         String? @map("pct_inscrits")
  pctExprimes         String? @map("pct_exprimes")
  elu                 String?
  payload             Json

  @@unique([importRunId, ligne, rang])
  @@index([codeCirconscription])
  @@map("election_result_raw")
  @@schema("bronze")
}
```

> `ligne` est le numéro de ligne du fichier, `rang` la position du candidat dans cette ligne. Ensemble ils forment la référence bronze : le fichier n'a aucun identifiant de candidature.

- [ ] **Step 2 : Champs silver sur `Candidacy`**

```prisma
  round            Int?      @map("round")
  votes            Int?
  votePctRegistered Decimal? @map("vote_pct_registered") @db.Decimal(6, 2)
  votePctExpressed  Decimal? @map("vote_pct_expressed") @db.Decimal(6, 2)
  elected          Boolean   @default(false)
```

Et sur `Election`, de quoi porter le tour et les chiffres de participation par circonscription — ou une table dédiée si vous jugez que `Election` n'est pas le bon porteur. Justifiez votre choix dans le rapport.

- [ ] **Step 3 : Migrer les deux bases, étendre le helper, committer**

Procédure des plans précédents. **Ne jamais `prisma migrate reset`** : la base de développement contient 2,46 millions de positions de vote.

Rappel : les URL de connexion utilisent `127.0.0.1`, jamais `localhost` — voir la note du plan 4.

---

## Task 2 : Lecture du format large

**Files:**
- Create: `packages/ingestion/src/adapters/resultats/wide-csv.ts`
- Test: `packages/ingestion/tests/wide-csv.test.ts`

Une fonction qui prend une ligne et son en-tête, et rend un enregistrement par candidat.

- [ ] **Tests à écrire d'abord :**

- l'en-tête à 54 colonnes donne 4 blocs, celui à 189 en donne 19 — le nombre se **déduit**, il n'est pas fourni ;
- un bloc dont le nom est vide n'est pas rendu (les colonnes sont remplies jusqu'au maximum du fichier, pas jusqu'au nombre réel de candidats) ;
- le champ `Elu` non vide devient `true`, vide devient `false` ;
- les voix et pourcentages sont rendus **tels quels**, en chaînes, sans conversion — la conversion appartient à la normalisation ;
- une ligne tronquée (moins de colonnes que l'en-tête) ne lève pas d'exception et rend les blocs complets qu'elle contient.

Construisez une fixture réduite depuis les fichiers réels, comme aux plans précédents, avec un script committé dans `scripts/`.

---

## Task 3 : Import des résultats

**Files:**
- Create: `packages/ingestion/src/adapters/resultats/{stage-resultats,normalize-resultats,resultats.adapter}.ts`
- Tests: les fichiers correspondants

**Staging** — une ligne bronze par candidat dépivoté, valeurs inchangées.

**Normalisation** — crée l'`Election` de 2024 (deux tours), les `Candidacy` avec voix, pourcentages et statut d'élu, résout l'identité via `buildKnownPersonIndex` et `resolveAndRecordIdentity`, et rattache la candidature quand le verdict est automatiquement fusionnable.

Le rapprochement dispose ici du **nom, du prénom et de la circonscription**, mais d'aucune date de naissance : la cascade plafonnera à `PROBABLE`, sauf pour le niveau « élection puis mandat » du plan 4, qui s'applique pleinement ici — c'est même son terrain naturel, puisque la source dit explicitement qui a été élu.

Passez `electionDate` (`2024-06-30` pour le premier tour, `2024-07-07` pour le second) et calculez `uniqueInDistrict` **sur l'ensemble du fichier**, en deux passes, comme au plan 4. Un test doit le prouver avec un homonyme placé loin derrière dans le fichier.

**Adapter** — `ResultatsAdapter`, deux ressources (`legislatives-2024-t1`, `legislatives-2024-t2`), format `csv`, encodage `utf-8`.

**Tests attendus, avec les nombres mesurés :**
- 4 009 candidats dépivotés au premier tour, 1 094 au second ;
- 76 élus au premier tour, 501 au second, **577 au total** ;
- les voix d'un candidat connu correspondent au fichier ;
- un candidat non élu a `elected = false`, jamais `null` ;
- l'import est idempotent.

---

## Task 4 : Import réel et arbitrage des six cas

- [x] Importer les deux tours, rapporter les chiffres réels.
- [x] Vérifier que **577 candidatures portent `elected = true`**.
- [x] Vérifier que `silver.person` reste à 3 119 : cette source ne crée aucune personne.
- [x] Lancer `poligraph resolve review --source DATA_GOUV` et consigner ce qu'il produit.
- [x] **Écrire les six arbitrages** dans `data/identity-decisions.yaml`, avec un motif explicite pour chacun — c'est le premier usage réel de ce fichier, et il doit servir d'exemple pour les suivants. Vérifier avant d'écrire que la circonscription désigne bien une personne unique dans chaque cas.
- [x] Réimporter et vérifier que les six sont désormais rattachés.
- [x] Rafraîchir les vues `gold`, interroger l'API pour un député, et vérifier que la section « élections et résultats » est alimentée.
- [x] Consigner les chiffres réels dans ce plan et committer.

### Réalisé — chiffres réels (import du 2026-08-26)

**Import** (`poligraph import resultats:legislatives`) : 1er tour 4 009 candidats dépivotés (créés), 2nd tour 1 094 — exactement les chiffres mesurés. `silver.candidacy` : round 1 → 4 009 lignes, 76 élues ; round 2 → 1 094 lignes, 501 élues. 76 + 501 = **577**. `silver.person` inchangé à **3 119**. Toutes les candidatures des deux tours résolvent un territoire (`silver.candidacy.territory_id IS NOT NULL` : 5 103 / 5 103).

**Piège supplémentaire trouvé à l'import réel, non mesuré dans la phase de préparation** : au-delà du zéro manquant (34 circonscriptions), le fichier publie deux départements sous un code alphabétique que `silver.territory` ne porte pas sous cette forme — `ZZ01`…`ZZ11` pour les 11 circonscriptions des Français établis hors de France (portées en base sous `099-1`…`099-11`, comme le RNE) et `ZX01` pour Saint-Barthélemy/Saint-Martin (porté en base sous `977-1`). Sans correctif, 157 candidatures des deux tours (dont 12 élues, une par circonscription concernée) restaient sans territoire, sans lever d'erreur — exactement le risque silencieux que le critère « chaque circonscription résout un territoire » est censé attraper. Corrigé par un alias explicite (`ZZ → 099`, `ZX → 977`) dans `districtCodeFromCirconscription` (`packages/ingestion/src/adapters/resultats/normalize-resultats.ts`), avec deux tests dédiés.

**Bug de portée corrigé en même temps** : les deux tours partagent le `sourceId` `DATA_GOUV` mais sont deux runs distincts, chacun ne connaissant que les `sourceKey` de son propre fichier (préfixées par le tour). `assertDecisionsAreResolvable` recevait la liste complète des décisions à chaque run, y compris celles visant l'autre tour — qu'il ne pouvait jamais résoudre. Corrigé par un filtre `decisionAppliesToRound` avant l'appel, avec un test de régression.

**`resolve review --source DATA_GOUV`** : 307 rapprochements en attente d'arbitrage (PROBABLE + POSSIBLE + AMBIGUOUS + CONFLICT), et 3 726 `UNMATCHED` exclus par défaut (candidats non élus, sans personne correspondante — l'écrasante majorité des ~4 000 candidats non retenus). Les 50 premiers PROBABLE affichés sont tous des candidats connus rapprochés sur nom + circonscription, plafonnés à PROBABLE faute de date de naissance dans cette source (comme prévu par la conception).

**Les six élus non rapprochés par le nom**, dérivés par `SELECT ... WHERE elected AND person_id IS NULL` (et non recopiés de la liste indicative du plan) :

| Circonscription | Résultats électoraux | En base (AN) | PA |
|---|---|---|---|
| 04-2 (Alpes-de-Haute-Provence) | Sophie VAGINAY | Sophie Ricourt Vaginay | PA840657 |
| 13-16 (Bouches-du-Rhône) | Emmanuel TACHE DE LA PAGERIE | Emmanuel Taché | PA793382 |
| 53-3 (Mayenne) | Yannick FAVENNEC | Yannick Favennec-Bécot | PA267042 |
| 78-8 (Yvelines) | Benjamin LUCAS | Benjamin Lucas-Lundy | PA795636 |
| 974-4 (La Réunion) | Emeline KBIDI | Émeline K/Bidi | PA795998 |
| 987-3 (Polynésie française) | Mereana REID ABERLOT | Mereana Reid Arbelot | PA795240 |

Le sixième cas, à identifier à l'import comme prévu par le plan, est Mereana Reid Arbelot/Aberlot (987-3) — transposition de deux lettres, pas une omission de patronyme composé comme les cinq autres. Pour chacun, vérifié avant d'écrire la décision qu'un seul mandat parlementaire de la 17e législature existe pour cette circonscription (`silver.mandate` × `silver.legislature.number = 17` × `silver.territory.code`) : aucun des six ne fait partie des 68 circonscriptions à mandats multiples.

Après réécriture de `data/identity-decisions.yaml` (six décisions `MERGE`, motif en français citant la vérification effectuée) et réimport (`--renormalize`), les six candidatures sont rattachées : `SELECT count(*) FROM silver.candidacy WHERE elected AND person_id IS NULL` → **0**. `silver.person` toujours **3 119**.

**API** : après `gold refresh` et démarrage compilé (`PORT=4100 pnpm --filter @poligraph/api serve`), la fiche de Michèle Martinez (`PA794770`, 4e circonscription des Pyrénées-Orientales) porte trois candidatures triées par année décroissante — 2024 tour 2 (38 045 voix, 37,03 % inscrits, 58,14 % exprimés, élue), 2024 tour 1 (33 159 voix, non élue), 2022 CNCCFP (`round`, `votes`, les deux pourcentages à `null`, jamais `0`). La fiche de Sophie Ricourt Vaginay (un des six arbitrages) confirme le rattachement : 21 655 voix, 32,48 % inscrits, élue, 2e circonscription des Alpes-de-Haute-Provence.

**Écart de scope signalé par le coordinateur et traité** : le modèle GraphQL `Candidacy` n'exposait pas `round`/`votes`/`votePctRegistered`/`votePctExpressed`/`elected` — le critère d'achèvement « une fiche affiche les voix et le pourcentage » ne pouvait pas être vérifié. Ajoutés à `apps/api/src/graphql/models/candidacy.model.ts` et `SilverRepository.candidaciesForPerson` (réutilise `toNumber` pour les `Decimal`), avec un test dans `apps/api/tests/fiche.test.ts` couvrant à la fois la présence (candidature 2024 avec résultats) et l'absence explicite (candidature CNCCFP 2022, `null` partout sauf `elected: false`).

`pnpm -r test` : tous les paquets testés passent (`packages/ingestion` 198 tests, `apps/api` 31 tests).

---

## Critère d'achèvement

- 577 candidatures marquées élues, réparties 76 au premier tour et 501 au second.
- `silver.person` reste à 3 119.
- Les six variantes de nom sont arbitrées, motivées, et rattachées après réimport.
- Une fiche affiche les voix et le pourcentage de son député.
- `pnpm test` passe intégralement.
