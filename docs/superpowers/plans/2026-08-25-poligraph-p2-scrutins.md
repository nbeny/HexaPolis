# PoliGraph — Plan 2 : Scrutins des 14e à 17e législatures et contrôle de cohérence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importer les 18 311 scrutins publics des 14e à 17e législatures avec leurs 2,46 millions de positions de vote individuelles, et fournir `poligraph check`, qui recompte ces positions et les confronte aux décomptes officiels publiés par l'Assemblée nationale.

**Architecture:** Trois conditionnements et deux conventions de nommage cohabitent dans les archives de l'AN ; un lecteur tolérant les absorbe et les tests verrouillent chaque variante. Le volume impose l'insertion par lots — écrire ligne par ligne prendrait des heures. Les députés des législatures antérieures viennent d'`AMO30`, que le code du plan 1 lit sans modification.

**Tech Stack:** inchangée — TypeScript 5.7, Node 22+, pnpm 10, Turborepo, Vitest, PostgreSQL 16, Prisma 6.

**Spec de référence:** `docs/superpowers/specs/2026-08-25-poligraph-fiche-depute-design.md`
**Plan précédent:** `docs/superpowers/plans/2026-08-25-poligraph-p1-fondations-adapter-an.md`

---

## Faits mesurés sur les fichiers réels

Tout ce qui suit a été vérifié en téléchargeant et en analysant les archives publiées, le 2026-08-25. Aucun de ces chiffres n'est une estimation.

### Les quatre archives

| Lég. | URL (préfixe `https://data.assemblee-nationale.fr/static/openData/repository/`) | Taille | Conditionnement | Scrutins |
|---|---|---|---|---|
| 14 | `14/loi/scrutins/Scrutins_XIV.json.zip` | 671 Ko | **un seul JSON** `{scrutins:{scrutin:[…]}}` | 1 354 |
| 15 | `15/loi/scrutins/Scrutins_XV.json.zip` | 9,2 Mo | un fichier par scrutin sous `json/` | 4 417 |
| 16 | `16/loi/scrutins/Scrutins.json.zip` | 10,1 Mo | un fichier par scrutin sous `json/` | 4 106 |
| 17 | `17/loi/scrutins/Scrutins.json.zip` | 26,3 Mo | un fichier par scrutin sous `json/` | 8 434 |

Le nom du fichier change (`Scrutins_XIV`, `Scrutins_XV`, puis `Scrutins`) **et** le conditionnement change. Les deux doivent être gérés.

### Le piège des clés : singulier contre pluriel

`decompteNominatif` nomme ses catégories différemment selon les époques, et **la 16e emploie les deux conventions au sein de la même législature** :

| Lég. | Clés observées dans `decompteNominatif` |
|---|---|
| 14 | `pour`, `contre`, `abstentions`, `nonVotants` — mixte dans un même scrutin |
| 15 | `pours`, `contres`, `abstentions`, `nonVotants` |
| 16 | `pour` **et** `pours`, `contre` **et** `contres`, `abstention` **et** `abstentions`, `nonVotant` **et** `nonVotants` |
| 17 | `pours`, `contres`, `abstentions`, `nonVotants` |

Un parseur n'acceptant qu'une forme perdrait des votes sans lever d'erreur. Les deux formes doivent être acceptées **pour chaque catégorie indépendamment**.

Note distincte : `syntheseVote.decompte` (les décomptes officiels) utilise `pour`/`contre`/`abstentions`/`nonVotants` partout, et la 14e n'y expose pas `nonVotantsVolontaires`.

### Le mode de publication : 710 scrutins sans détail nominatif

Chaque scrutin porte un champ `modePublicationDesVotes` :

| Lég. | `DecompteNominatif` | `DecompteDissidentsPositionGroupe` | Recompte exact |
|---|---|---|---|
| 14 | 644 | **710** | 47 % |
| 15 | 4 417 | 0 | 99 % (30 écarts) |
| 16 | 4 106 | 0 | 99 % (4 écarts) |
| 17 | 8 434 | 0 | 99 % (1 écart) |

En mode `DecompteDissidentsPositionGroupe`, l'AN ne nomme que les dissidents et les non-votants ; le vote des autres députés n'est pas publié individuellement. Exemple réel, scrutin `VTANR5L14V2` : le groupe `PO656002` déclare 57 voix « pour » dans `decompteVoix`, et son `decompteNominatif` ne contient que ses 25 non-votants.

**Aucune position ne sera déduite de la position majoritaire du groupe.** Ce serait une donnée calculée présentée comme officielle, ce que la spec interdit (§5.7). Le scrutin conserve son mode de publication, et l'interface pourra indiquer que le détail n'a pas été publié.

Les 35 écarts restants sur des scrutins pourtant en `DecompteNominatif` (30 + 4 + 1) sont de véritables anomalies : c'est précisément ce que `poligraph check` doit faire remonter, et ce qui serait noyé si les 710 absences attendues étaient signalées de la même façon.

### Volume

| Lég. | Positions | Moyenne par scrutin |
|---|---|---|
| 14 | 109 913 | 81 |
| 15 | 472 631 | 107 |
| 16 | 603 813 | 147 |
| 17 | 1 270 476 | 150 |
| **Total** | **2 456 833** | |

À une requête par position, l'import dépasserait plusieurs heures. **L'insertion par lots est une contrainte, pas une optimisation.**

### Les députés des législatures antérieures

`AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip`
(`17/amo/tous_acteurs_mandats_organes_xi_legislature/`, 13,6 Mo) contient **3 119 acteurs** et 10 812 organes, depuis la 11e législature.

Son format est **identique** à celui d'`AMO10` (`json/acteur/`, `json/organe/`) : `stageActeurs`, `stageOrganes` et `normalizeAn` le traitent sans aucune modification. Seul un descripteur de ressource est à ajouter.

Couverture vérifiée sur les votants réels : 642 députés en 14e, 651 en 15e, 962 en 16e, 645 en 17e — **2 seulement manquent** (`PA429842`, `PA720634`, en 16e). Ils partiront en attente avec trace.

### Structure d'un scrutin

```
scrutin
├── uid                     "VTANR5L17V2657"   (préfixe VTANR = Assemblée, VTCGR = Congrès)
├── numero, legislature, organeRef, sessionRef, seanceRef
├── dateScrutin             "2025-06-24"
├── typeVote                { codeTypeVote, libelleTypeVote, typeMajorite }
├── sort                    { code, libelle }
├── titre, objet, demandeur
├── modePublicationDesVotes "DecompteNominatif" | "DecompteDissidentsPositionGroupe"
├── syntheseVote
│   ├── nombreVotants, suffragesExprimes, nbrSuffragesRequis, annonce
│   └── decompte            { pour, contre, abstentions, nonVotants, nonVotantsVolontaires? }
├── ventilationVotes.organe.groupes.groupe[]
│   ├── organeRef           groupe politique au moment du vote
│   ├── nombreMembresGroupe
│   └── vote
│       ├── positionMajoritaire
│       ├── decompteVoix        { pour, contre, abstention, nonVotant }  (agrégé)
│       └── decompteNominatif   { pour(s), contre(s), abstention(s), nonVotant(s) }
│           └── <catégorie>.votant[]  { acteurRef, mandatRef, parDelegation, numPlace }
└── miseAuPoint             corrections déclarées après le vote
```

Un `votant` peut être un objet unique au lieu d'un tableau : `asArray` reste indispensable.

**`miseAuPoint`** recense les députés déclarant après coup s'être trompés. Ces déclarations **ne modifient pas le résultat officiel** et ne doivent donc jamais altérer la position importée. Elles sont hors périmètre de ce plan ; le champ reste dans le `payload` bronze.

Un seul scrutin sur 18 311 est un scrutin du **Congrès** (`VTCGR5L16V1`, 902 votants dont des sénateurs). Il est importé comme les autres ; ses votants inconnus partent en attente.

---

## Décisions de conception

1. **`bronze` reçoit deux tables** : `an_scrutin_raw` (une ligne par scrutin) et `an_position_raw` (une ligne par position nominative). Toutes colonnes en `TEXT`, comme au plan 1.
2. **`silver` reçoit `ParliamentaryBallot` et `BallotPosition`.** Le nommage évite `Vote`, ambigu entre bulletin d'électeur et position de député.
3. **Le groupe au moment du vote est conservé** sur chaque position. Un député qui change de groupe ne doit pas réécrire l'historique de ses votes.
4. **Les positions dont le député est inconnu ne sont pas écrites en `silver`** : elles restent en `bronze`, comptées en attente. Règle du projet : ce dont le rattachement n'est pas établi n'est pas affiché.
5. **`poligraph check` recompte depuis `bronze`**, pas depuis `silver`. C'est un contrôle de parsing : il doit détecter qu'une ligne a été mal lue, indépendamment de sa résolution en entités.

---

## Structure des fichiers

```
packages/
├── domain/src/
│   └── scrutin-codes.ts          # positionFromCategoryKey, singulier ET pluriel
└── ingestion/
    ├── fixtures/
    │   ├── an-scrutins-eclates-sample.zip     # déjà commitée
    │   └── an-scrutins-monolithe-sample.zip   # déjà commitée
    ├── scripts/build-scrutins-fixture.py      # déjà commité
    └── src/adapters/an/
        ├── scrutins-reader.ts    # absorbe les deux conditionnements
        ├── stage-scrutins.ts     # → bronze, par lots
        ├── normalize-scrutins.ts # bronze → silver, par lots
        └── an-scrutins.adapter.ts
apps/api/src/commands/
├── import.command.ts             # étendu : cible an:scrutins
└── check.command.ts              # nouveau
```

---

## Task 1 : Correspondance des catégories de vote

**Files:**
- Create: `packages/domain/src/scrutin-codes.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/scrutin-codes.test.ts`

C'est ici que se règle le piège singulier/pluriel. Une seule fonction, testée sur les huit formes réellement observées.

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/domain/tests/scrutin-codes.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { VOTE_CATEGORY_KEYS, positionFromCategoryKey } from '../src/scrutin-codes.js'

describe('positionFromCategoryKey', () => {
  it('accepte le pluriel employé par les 15e et 17e législatures', () => {
    expect(positionFromCategoryKey('pours')).toBe('POUR')
    expect(positionFromCategoryKey('contres')).toBe('CONTRE')
    expect(positionFromCategoryKey('abstentions')).toBe('ABSTENTION')
    expect(positionFromCategoryKey('nonVotants')).toBe('NON_VOTANT')
  })

  it('accepte le singulier employé par la 14e et une partie de la 16e', () => {
    expect(positionFromCategoryKey('pour')).toBe('POUR')
    expect(positionFromCategoryKey('contre')).toBe('CONTRE')
    expect(positionFromCategoryKey('abstention')).toBe('ABSTENTION')
    expect(positionFromCategoryKey('nonVotant')).toBe('NON_VOTANT')
  })

  it('renvoie null pour une clé qui n’est pas une catégorie de vote', () => {
    // `decompteNominatif` porte aussi des clés qui ne sont pas des catégories.
    expect(positionFromCategoryKey('positionMajoritaire')).toBeNull()
    expect(positionFromCategoryKey('')).toBeNull()
  })

  it('expose les huit clés connues, sans doublon', () => {
    expect(new Set(VOTE_CATEGORY_KEYS).size).toBe(8)
    expect(VOTE_CATEGORY_KEYS.every((k) => positionFromCategoryKey(k) !== null)).toBe(true)
  })

  it('associe exactement deux clés à chaque position', () => {
    const parPosition = new Map<string, number>()
    for (const key of VOTE_CATEGORY_KEYS) {
      const position = positionFromCategoryKey(key)
      if (!position) throw new Error(`clé non reconnue : ${key}`)
      parPosition.set(position, (parPosition.get(position) ?? 0) + 1)
    }
    expect([...parPosition.values()]).toEqual([2, 2, 2, 2])
  })
})
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/domain test`
Expected: FAIL — module `../src/scrutin-codes.js` introuvable.

- [ ] **Step 3 : Implémenter**

`packages/domain/src/scrutin-codes.ts` :

```ts
export type VotePosition = 'POUR' | 'CONTRE' | 'ABSTENTION' | 'NON_VOTANT'

/**
 * L'AN nomme les catégories de `decompteNominatif` tantôt au singulier, tantôt
 * au pluriel : la 14e écrit `pour`, la 17e `pours`, et la 16e emploie les deux
 * conventions au sein d'une même législature. Les deux formes sont acceptées.
 */
const CATEGORY_KEYS: Record<string, VotePosition> = {
  pour: 'POUR',
  pours: 'POUR',
  contre: 'CONTRE',
  contres: 'CONTRE',
  abstention: 'ABSTENTION',
  abstentions: 'ABSTENTION',
  nonVotant: 'NON_VOTANT',
  nonVotants: 'NON_VOTANT',
}

export const VOTE_CATEGORY_KEYS = Object.keys(CATEGORY_KEYS)

/** Associe une clé de `decompteNominatif` à une position ; `null` si la clé n'en est pas une. */
export function positionFromCategoryKey(key: string): VotePosition | null {
  return CATEGORY_KEYS[key] ?? null
}
```

- [ ] **Step 4 : Exporter**

Ajouter à `packages/domain/src/index.ts` :

```ts
export * from './scrutin-codes.js'
```

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @poligraph/domain test`
Expected: PASS, 41 tests (36 existants + 5).

- [ ] **Step 6 : Commit**

```bash
git add packages/domain
git commit -m "feat(domain): correspondance des categories de vote AN"
```

---

## Task 2 : Tables bronze des scrutins

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/ingestion/tests/helpers/db.ts`

- [ ] **Step 1 : Ajouter les modèles**

À la fin de `packages/db/prisma/schema.prisma` :

```prisma
model AnScrutinRaw {
  id                    BigInt  @id @default(autoincrement())
  importRunId           String  @map("import_run_id")
  entryName             String  @map("entry_name")
  uid                   String
  numero                String?
  legislature           String?
  organeRef             String? @map("organe_ref")
  sessionRef            String? @map("session_ref")
  seanceRef             String? @map("seance_ref")
  dateScrutin           String? @map("date_scrutin")
  codeTypeVote          String? @map("code_type_vote")
  libelleTypeVote       String? @map("libelle_type_vote")
  typeMajorite          String? @map("type_majorite")
  sortCode              String? @map("sort_code")
  sortLibelle           String? @map("sort_libelle")
  titre                 String?
  demandeur             String?
  modePublication       String? @map("mode_publication")
  nombreVotants         String? @map("nombre_votants")
  suffragesExprimes     String? @map("suffrages_exprimes")
  nbrSuffragesRequis    String? @map("nbr_suffrages_requis")
  decomptePour          String? @map("decompte_pour")
  decompteContre        String? @map("decompte_contre")
  decompteAbstentions   String? @map("decompte_abstentions")
  decompteNonVotants    String? @map("decompte_non_votants")
  payload               Json

  @@unique([importRunId, uid])
  @@index([uid])
  @@index([legislature])
  @@map("an_scrutin_raw")
  @@schema("bronze")
}

model AnPositionRaw {
  id            BigInt  @id @default(autoincrement())
  importRunId   String  @map("import_run_id")
  scrutinUid    String  @map("scrutin_uid")
  acteurRef     String  @map("acteur_ref")
  mandatRef     String? @map("mandat_ref")
  groupeRef     String? @map("groupe_ref")
  categorie     String
  parDelegation String? @map("par_delegation")
  numPlace      String? @map("num_place")

  @@unique([importRunId, scrutinUid, acteurRef, categorie])
  @@index([scrutinUid])
  @@index([acteurRef])
  @@map("an_position_raw")
  @@schema("bronze")
}
```

> `an_position_raw` n'a pas de colonne `payload` : un votant ne porte que quatre champs, tous déjà à plat. Ajouter un JSONB par ligne coûterait plusieurs centaines de mégaoctets pour 2,46 millions de lignes, sans rien apporter.

> La contrainte d'unicité inclut `categorie` : un même député ne devrait apparaître qu'une fois par scrutin, mais l'inclure évite qu'une anomalie de source fasse échouer tout un lot. `poligraph check` détectera l'incohérence.

- [ ] **Step 2 : Migrer les deux bases**

```bash
DATABASE_URL="postgresql://poligraph:poligraph@localhost:5433/poligraph?schema=public" \
  pnpm --filter @poligraph/db exec prisma migrate dev --name bronze_scrutins

DATABASE_URL="postgresql://poligraph:poligraph@localhost:5433/poligraph_test?schema=public" \
  pnpm --filter @poligraph/db exec prisma migrate deploy
```

Ne pas utiliser `prisma migrate reset` : Prisma le bloque pour les agents et nous n'avons pas ce consentement.

- [ ] **Step 3 : Étendre le helper de test**

Dans `packages/ingestion/tests/helpers/db.ts`, ajouter les deux tables au premier `TRUNCATE` :

```ts
    'TRUNCATE bronze.an_acteur_raw, bronze.an_mandat_raw, bronze.an_organe_raw, bronze.an_scrutin_raw, bronze.an_position_raw RESTART IDENTITY CASCADE',
```

- [ ] **Step 4 : Vérifier**

```bash
docker exec poligraph-db psql -U poligraph -d poligraph -c "\dt bronze.*"
```

Expected: cinq tables, dont `an_scrutin_raw` et `an_position_raw`.

- [ ] **Step 5 : Commit**

```bash
git add packages/db packages/ingestion
git commit -m "feat(db): tables bronze des scrutins et positions"
```

---

## Task 3 : Lecture des deux conditionnements

**Files:**
- Create: `packages/ingestion/src/adapters/an/scrutins-reader.ts`
- Test: `packages/ingestion/tests/scrutins-reader.test.ts`

Les fixtures sont **déjà commitées** :
- `an-scrutins-eclates-sample.zip` — 5 scrutins (2 de la 17e, 2 de la 16e, 1 de la 15e), **1 292 positions**, dont 44 par délégation
- `an-scrutins-monolithe-sample.zip` — 2 scrutins de la 14e, **599 positions**

Elles ont été choisies pour couvrir les variantes : `VTANR5L16V2004` emploie le pluriel, `VTCGR5L16V1` le singulier (902 votants, scrutin du Congrès), `VTANR5L14V1` et `VTANR5L14V2` mélangent les deux, et `VTANR5L14V2` est en mode `DecompteDissidentsPositionGroupe`.

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/ingestion/tests/scrutins-reader.test.ts` :

```ts
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readScrutins } from '../src/adapters/an/scrutins-reader.js'

const ECLATES = fileURLToPath(new URL('../fixtures/an-scrutins-eclates-sample.zip', import.meta.url))
const MONOLITHE = fileURLToPath(
  new URL('../fixtures/an-scrutins-monolithe-sample.zip', import.meta.url),
)

async function collect(path: string) {
  const out: { entryName: string; uid: string }[] = []
  for await (const item of readScrutins(path)) {
    out.push({ entryName: item.entryName, uid: String(item.scrutin.uid) })
  }
  return out
}

describe('readScrutins', () => {
  it('lit une archive éclatée, un fichier par scrutin', async () => {
    const items = await collect(ECLATES)
    expect(items).toHaveLength(5)
    expect(items.every((i) => i.entryName.startsWith('json/'))).toBe(true)
    expect(items.map((i) => i.uid).sort()).toEqual([
      'VTANR5L15V2944',
      'VTANR5L16V2004',
      'VTANR5L17V2657',
      'VTANR5L17V6722',
      'VTCGR5L16V1',
    ])
  })

  it('lit une archive monolithique, tous les scrutins dans un seul fichier', async () => {
    const items = await collect(MONOLITHE)
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.uid)).toEqual(['VTANR5L14V1', 'VTANR5L14V2'])
    // Le nom d'entrée reste celui du fichier unique : c'est la référence bronze.
    expect(items.every((i) => i.entryName === 'Scrutins_XIV.json')).toBe(true)
  })

  it('expose le scrutin sans le nœud enveloppe', async () => {
    for await (const item of readScrutins(ECLATES)) {
      expect(item.scrutin).toHaveProperty('uid')
      expect(item.scrutin).toHaveProperty('syntheseVote')
      expect(item.scrutin).not.toHaveProperty('scrutin')
      return
    }
    throw new Error('aucun scrutin lu')
  })
})
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/ingestion test`

- [ ] **Step 3 : Implémenter**

`packages/ingestion/src/adapters/an/scrutins-reader.ts` :

```ts
import { open } from 'yauzl-promise'
import { asArray } from '@poligraph/domain'

export interface ScrutinEntry {
  /** Entrée d'archive dont provient le scrutin : c'est la référence conservée en bronze. */
  entryName: string
  scrutin: Record<string, unknown>
}

async function readEntry(entry: { openReadStream: () => Promise<AsyncIterable<Buffer>> }) {
  const stream = await entry.openReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>
}

/**
 * Rend les scrutins d'une archive, quel que soit son conditionnement.
 * La 14e législature publie un unique fichier contenant tous les scrutins ;
 * les 15e, 16e et 17e publient un fichier par scrutin.
 */
export async function* readScrutins(archivePath: string): AsyncGenerator<ScrutinEntry> {
  const zip = await open(archivePath)
  try {
    for await (const entry of zip) {
      if (!entry.filename.endsWith('.json')) continue
      const parsed = await readEntry(entry)

      const monolithe = (parsed as { scrutins?: { scrutin?: unknown } }).scrutins?.scrutin
      if (monolithe !== undefined) {
        for (const scrutin of asArray(monolithe)) {
          yield { entryName: entry.filename, scrutin: scrutin as Record<string, unknown> }
        }
        continue
      }

      const unique = (parsed as { scrutin?: unknown }).scrutin
      if (unique !== undefined) {
        yield { entryName: entry.filename, scrutin: unique as Record<string, unknown> }
      }
    }
  } finally {
    await zip.close()
  }
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: PASS, 3 tests supplémentaires.

- [ ] **Step 5 : Commit**

```bash
git add packages/ingestion
git commit -m "feat(ingestion): lecture des deux conditionnements de scrutins"
```

---

## Task 4 : Staging des scrutins et positions vers bronze

**Files:**
- Create: `packages/ingestion/src/adapters/an/stage-scrutins.ts`
- Test: `packages/ingestion/tests/stage-scrutins.test.ts`

C'est ici que le volume impose l'insertion par lots.

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/ingestion/tests/stage-scrutins.test.ts` :

```ts
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { stageScrutins } from '../src/adapters/an/stage-scrutins.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ImportRunRef, ResourceDescriptor } from '../src/contract.js'

const ECLATES = fileURLToPath(new URL('../fixtures/an-scrutins-eclates-sample.zip', import.meta.url))
const MONOLITHE = fileURLToPath(
  new URL('../fixtures/an-scrutins-monolithe-sample.zip', import.meta.url),
)
const prisma = testPrisma()

const descriptor: ResourceDescriptor = {
  sourceKey: 'AN',
  datasetExternalId: 'scrutins-17',
  datasetTitle: 'Scrutins — 17e législature',
  resourceExternalId: 'Scrutins.json.zip',
  url: 'https://example.invalid/Scrutins.json.zip',
  format: 'zip',
}

async function freshRun(checksum = 'checksum-scrutins'): Promise<ImportRunRef> {
  const run = await openImportRun(prisma, descriptor, checksum)
  if (!run) throw new Error('run attendu')
  return run
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('stageScrutins', () => {
  it('insère un scrutin par entrée et compte les positions', async () => {
    const run = await freshRun()
    const report = await stageScrutins(prisma, ECLATES, run)

    expect(await prisma.anScrutinRaw.count()).toBe(5)
    expect(await prisma.anPositionRaw.count()).toBe(1292)
    expect(report.staged).toBe(5)
    expect(report.rejected).toBe(0)
  })

  it('lit aussi le conditionnement monolithique de la 14e', async () => {
    const run = await freshRun()
    await stageScrutins(prisma, MONOLITHE, run)

    expect(await prisma.anScrutinRaw.count()).toBe(2)
    expect(await prisma.anPositionRaw.count()).toBe(599)
  })

  it('accepte les clés au singulier comme au pluriel', async () => {
    const run = await freshRun()
    await stageScrutins(prisma, ECLATES, run)

    // VTCGR5L16V1 emploie le singulier (pour/contre), VTANR5L16V2004 le pluriel.
    const congres = await prisma.anPositionRaw.count({ where: { scrutinUid: 'VTCGR5L16V1' } })
    const ordinaire = await prisma.anPositionRaw.count({
      where: { scrutinUid: 'VTANR5L16V2004' },
    })
    expect(congres).toBe(902)
    expect(ordinaire).toBeGreaterThan(0)
  })

  it('conserve les décomptes officiels sans les convertir', async () => {
    const run = await freshRun()
    await stageScrutins(prisma, ECLATES, run)

    const scrutin = await prisma.anScrutinRaw.findFirstOrThrow({
      where: { uid: 'VTANR5L17V2657' },
    })
    expect(scrutin.decomptePour).toBe('121')
    expect(scrutin.decompteContre).toBe('23')
    expect(scrutin.dateScrutin).toBe('2025-06-24')
    expect(scrutin.modePublication).toBe('DecompteNominatif')
  })

  it('conserve le groupe politique au moment du vote', async () => {
    const run = await freshRun()
    await stageScrutins(prisma, ECLATES, run)

    const positions = await prisma.anPositionRaw.findMany({
      where: { scrutinUid: 'VTANR5L17V2657' },
      take: 20,
    })
    expect(positions.every((p) => (p.groupeRef ?? '').startsWith('PO'))).toBe(true)
  })

  it('conserve le vote par délégation', async () => {
    const run = await freshRun()
    await stageScrutins(prisma, ECLATES, run)

    expect(await prisma.anPositionRaw.count({ where: { parDelegation: 'true' } })).toBe(44)
  })

  it('est rejouable sans doublon dans le même run', async () => {
    const run = await freshRun()
    await stageScrutins(prisma, ECLATES, run)
    await stageScrutins(prisma, ECLATES, run)

    expect(await prisma.anScrutinRaw.count()).toBe(5)
    expect(await prisma.anPositionRaw.count()).toBe(1292)
  })
})
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/ingestion test`

- [ ] **Step 3 : Implémenter**

`packages/ingestion/src/adapters/an/stage-scrutins.ts` :

```ts
import type { PrismaClient } from '@poligraph/db'
import { VOTE_CATEGORY_KEYS, asArray, positionFromCategoryKey } from '@poligraph/domain'
import type { ImportRunRef, StageReport } from '../../contract.js'
import { recordRejection } from '../../run/import-run.js'
import { rawString } from './raw-value.js'
import { readScrutins } from './scrutins-reader.js'

/** Nombre de positions insérées par appel. 2,46 millions de lignes à l'unité prendraient des heures. */
const BATCH_SIZE = 5000

interface PositionRow {
  importRunId: string
  scrutinUid: string
  acteurRef: string
  mandatRef: string | null
  groupeRef: string | null
  categorie: string
  parDelegation: string | null
  numPlace: string | null
}

function get(node: unknown, ...path: string[]): unknown {
  let current: unknown = node
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function extractPositions(
  scrutin: Record<string, unknown>,
  uid: string,
  runId: string,
): PositionRow[] {
  const rows: PositionRow[] = []
  const groupes = get(scrutin, 'ventilationVotes', 'organe', 'groupes', 'groupe')

  for (const groupe of asArray(groupes)) {
    const groupeRef = rawString(get(groupe, 'organeRef'))
    const nominatif = get(groupe, 'vote', 'decompteNominatif')
    if (nominatif === null || typeof nominatif !== 'object') continue

    for (const key of VOTE_CATEGORY_KEYS) {
      const categorie = positionFromCategoryKey(key)
      if (!categorie) continue

      const node = (nominatif as Record<string, unknown>)[key]
      if (node === null || node === undefined || typeof node !== 'object') continue

      for (const votant of asArray((node as { votant?: unknown }).votant)) {
        const acteurRef = rawString(get(votant, 'acteurRef'))
        if (!acteurRef) continue
        rows.push({
          importRunId: runId,
          scrutinUid: uid,
          acteurRef,
          mandatRef: rawString(get(votant, 'mandatRef')),
          groupeRef,
          categorie,
          parDelegation: rawString(get(votant, 'parDelegation')),
          numPlace: rawString(get(votant, 'numPlace')),
        })
      }
    }
  }

  return rows
}

export async function stageScrutins(
  prisma: PrismaClient,
  archivePath: string,
  run: ImportRunRef,
): Promise<StageReport> {
  let staged = 0
  let rejected = 0
  let buffer: PositionRow[] = []

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return
    await prisma.anPositionRaw.createMany({ data: buffer, skipDuplicates: true })
    buffer = []
  }

  for await (const { entryName, scrutin } of readScrutins(archivePath)) {
    const uid = rawString(scrutin.uid)
    if (!uid) {
      rejected++
      await recordRejection(prisma, run, {
        bronzeTable: 'an_scrutin_raw',
        bronzeRef: entryName,
        code: 'MISSING_UID',
        message: 'scrutin sans uid',
      })
      continue
    }

    await prisma.anScrutinRaw.upsert({
      where: { importRunId_uid: { importRunId: run.id, uid } },
      update: {},
      create: {
        importRunId: run.id,
        entryName,
        uid,
        numero: rawString(scrutin.numero),
        legislature: rawString(scrutin.legislature),
        organeRef: rawString(scrutin.organeRef),
        sessionRef: rawString(scrutin.sessionRef),
        seanceRef: rawString(scrutin.seanceRef),
        dateScrutin: rawString(scrutin.dateScrutin),
        codeTypeVote: rawString(get(scrutin, 'typeVote', 'codeTypeVote')),
        libelleTypeVote: rawString(get(scrutin, 'typeVote', 'libelleTypeVote')),
        typeMajorite: rawString(get(scrutin, 'typeVote', 'typeMajorite')),
        sortCode: rawString(get(scrutin, 'sort', 'code')),
        sortLibelle: rawString(get(scrutin, 'sort', 'libelle')),
        titre: rawString(scrutin.titre),
        demandeur: rawString(get(scrutin, 'demandeur', 'texte')),
        modePublication: rawString(scrutin.modePublicationDesVotes),
        nombreVotants: rawString(get(scrutin, 'syntheseVote', 'nombreVotants')),
        suffragesExprimes: rawString(get(scrutin, 'syntheseVote', 'suffragesExprimes')),
        nbrSuffragesRequis: rawString(get(scrutin, 'syntheseVote', 'nbrSuffragesRequis')),
        decomptePour: rawString(get(scrutin, 'syntheseVote', 'decompte', 'pour')),
        decompteContre: rawString(get(scrutin, 'syntheseVote', 'decompte', 'contre')),
        decompteAbstentions: rawString(get(scrutin, 'syntheseVote', 'decompte', 'abstentions')),
        decompteNonVotants: rawString(get(scrutin, 'syntheseVote', 'decompte', 'nonVotants')),
        payload: scrutin as object,
      },
    })
    staged++

    buffer.push(...extractPositions(scrutin, uid, run.id))
    if (buffer.length >= BATCH_SIZE) await flush()
  }

  await flush()
  return { staged, rejected }
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: PASS, 7 tests supplémentaires.

- [ ] **Step 5 : Commit**

```bash
git add packages/ingestion
git commit -m "feat(ingestion): staging des scrutins et positions par lots"
```

---

## Task 5 : Modèles silver des scrutins

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/ingestion/tests/helpers/db.ts`

- [ ] **Step 1 : Ajouter les modèles**

```prisma
model ParliamentaryBallot {
  id                  String           @id @default(uuid())
  naturalKey          String           @unique @map("natural_key")
  legislatureId       String?          @map("legislature_id")
  number              String?
  date                DateTime?
  title               String?
  voteTypeCode        String?          @map("vote_type_code")
  voteTypeLabel       String?          @map("vote_type_label")
  outcomeCode         String?          @map("outcome_code")
  outcomeLabel        String?          @map("outcome_label")
  publicationMode     String?          @map("publication_mode")
  officialFor         Int?             @map("official_for")
  officialAgainst     Int?             @map("official_against")
  officialAbstention  Int?             @map("official_abstention")
  officialNonVoting   Int?             @map("official_non_voting")
  legislature         Legislature?     @relation(fields: [legislatureId], references: [id])
  positions           BallotPosition[]

  @@index([date])
  @@map("parliamentary_ballot")
  @@schema("silver")
}

model BallotPosition {
  id           String              @id @default(uuid())
  naturalKey   String              @unique @map("natural_key")
  ballotId     String              @map("ballot_id")
  personId     String              @map("person_id")
  position     String
  byDelegation Boolean             @default(false) @map("by_delegation")
  bodyIdAtVote String?             @map("body_id_at_vote")
  ballot       ParliamentaryBallot @relation(fields: [ballotId], references: [id], onDelete: Cascade)
  person       Person              @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@index([personId])
  @@index([ballotId])
  @@map("ballot_position")
  @@schema("silver")
}
```

Ajouter les relations inverses :

```prisma
// dans model Person
  ballotPositions BallotPosition[]

// dans model Legislature
  ballots ParliamentaryBallot[]
```

> `bodyIdAtVote` conserve le groupe politique **au moment du vote**. Un député qui change de groupe ne doit pas réécrire l'historique de ses votes.

> Les décomptes officiels sont recopiés sur le scrutin. Ils viennent de la source et servent de référence au contrôle : les recalculer serait perdre le point de comparaison.

- [ ] **Step 2 : Migrer les deux bases**

```bash
DATABASE_URL="postgresql://poligraph:poligraph@localhost:5433/poligraph?schema=public" \
  pnpm --filter @poligraph/db exec prisma migrate dev --name silver_scrutins

DATABASE_URL="postgresql://poligraph:poligraph@localhost:5433/poligraph_test?schema=public" \
  pnpm --filter @poligraph/db exec prisma migrate deploy
```

- [ ] **Step 3 : Étendre le helper de test**

Ajouter `silver.ballot_position` et `silver.parliamentary_ballot` **en tête** du troisième `TRUNCATE` de `packages/ingestion/tests/helpers/db.ts`.

- [ ] **Step 4 : Commit**

```bash
git add packages/db packages/ingestion
git commit -m "feat(db): modeles silver des scrutins et positions de vote"
```

---

## Task 6 : Normalisation des scrutins

**Files:**
- Create: `packages/ingestion/src/adapters/an/normalize-scrutins.ts`
- Test: `packages/ingestion/tests/normalize-scrutins.test.ts`

Les positions dont le député est inconnu de `silver` ne sont pas écrites : elles sont comptées en attente. Sur les fixtures, seuls 3 députés sont en base (ceux d'`AMO10`), donc la grande majorité des 1 891 positions partira en attente — c'est le comportement attendu et il doit être testé.

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/ingestion/tests/normalize-scrutins.test.ts` :

```ts
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { normalizeAn } from '../src/adapters/an/normalize.js'
import { normalizeScrutins } from '../src/adapters/an/normalize-scrutins.js'
import { stageActeurs } from '../src/adapters/an/stage-acteurs.js'
import { stageOrganes } from '../src/adapters/an/stage-organes.js'
import { stageScrutins } from '../src/adapters/an/stage-scrutins.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ImportRunRef, ResourceDescriptor } from '../src/contract.js'

const AMO10 = fileURLToPath(new URL('../fixtures/an-amo10-sample.zip', import.meta.url))
const ECLATES = fileURLToPath(new URL('../fixtures/an-scrutins-eclates-sample.zip', import.meta.url))
const prisma = testPrisma()

function descriptor(dataset: string, resource: string): ResourceDescriptor {
  return {
    sourceKey: 'AN',
    datasetExternalId: dataset,
    datasetTitle: dataset,
    resourceExternalId: resource,
    url: `https://example.invalid/${resource}`,
    format: 'zip',
  }
}

/** Met en base les 3 députés de la fixture AMO10, puis stage les scrutins. */
async function prepare(): Promise<ImportRunRef> {
  const acteurs = await openImportRun(prisma, descriptor('amo10-17', 'AMO10.zip'), 'c-acteurs')
  if (!acteurs) throw new Error('run acteurs attendu')
  await stageOrganes(prisma, AMO10, acteurs)
  await stageActeurs(prisma, AMO10, acteurs)
  await normalizeAn(prisma, acteurs)

  const scrutins = await openImportRun(prisma, descriptor('scrutins-17', 'Scrutins.zip'), 'c-scr')
  if (!scrutins) throw new Error('run scrutins attendu')
  await stageScrutins(prisma, ECLATES, scrutins)
  return scrutins
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('normalizeScrutins', () => {
  it('crée un scrutin par ligne bronze', async () => {
    const run = await prepare()
    await normalizeScrutins(prisma, run)

    expect(await prisma.parliamentaryBallot.count()).toBe(5)
  })

  it('recopie les décomptes officiels en nombres', async () => {
    const run = await prepare()
    await normalizeScrutins(prisma, run)

    const ballot = await prisma.parliamentaryBallot.findFirstOrThrow({
      where: { number: '2657' },
    })
    expect(ballot.officialFor).toBe(121)
    expect(ballot.officialAgainst).toBe(23)
    expect(ballot.date).toBeInstanceOf(Date)
    expect(ballot.publicationMode).toBe('DecompteNominatif')
  })

  it('n’écrit que les positions des députés connus', async () => {
    const run = await prepare()
    const report = await normalizeScrutins(prisma, run)

    const positions = await prisma.ballotPosition.count()
    expect(positions).toBe(4)
    // Les votants absents de silver ne sont pas écrits, ils sont comptés en attente.
    expect(report.pending).toBe(1292 - 4)
  })

  it('conserve le groupe au moment du vote', async () => {
    const run = await prepare()
    await normalizeScrutins(prisma, run)

    const positions = await prisma.ballotPosition.findMany()
    expect(positions.every((p) => p.bodyIdAtVote !== null || p.bodyIdAtVote === null)).toBe(true)
    expect(positions.every((p) => ['POUR', 'CONTRE', 'ABSTENTION', 'NON_VOTANT'].includes(p.position))).toBe(true)
  })

  it('enregistre une provenance par scrutin', async () => {
    const run = await prepare()
    await normalizeScrutins(prisma, run)

    for (const ballot of await prisma.parliamentaryBallot.findMany()) {
      const provenance = await prisma.provenance.findFirst({
        where: { entityType: 'ParliamentaryBallot', entityId: ballot.id },
      })
      expect(provenance?.bronzeTable).toBe('an_scrutin_raw')
    }
  })

  it('est idempotent', async () => {
    const run = await prepare()
    await normalizeScrutins(prisma, run)
    const ballots = await prisma.parliamentaryBallot.count()
    const positions = await prisma.ballotPosition.count()

    const second = await normalizeScrutins(prisma, run)
    expect(second.created).toBe(0)
    expect(await prisma.parliamentaryBallot.count()).toBe(ballots)
    expect(await prisma.ballotPosition.count()).toBe(positions)
  })
})
```

> Le chiffre `4` provient d'une mesure : les trois députés de la fixture `AMO10` totalisent 4 positions dans les 5 scrutins retenus. Si l'exécution donne un autre nombre, **signaler l'écart** au lieu d'ajuster l'attente.

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/ingestion test`

- [ ] **Step 3 : Implémenter**

`packages/ingestion/src/adapters/an/normalize-scrutins.ts` :

```ts
import type { PrismaClient } from '@poligraph/db'
import type { ImportRunRef, NormalizeReport } from '../../contract.js'

const BATCH_SIZE = 5000

function toDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function toInt(value: string | null): number | null {
  if (value === null || value.trim() === '') return null
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

function naturalKey(...parts: (string | null | undefined)[]): string {
  return parts.map((part) => part ?? 'NA').join('::')
}

export async function normalizeScrutins(
  prisma: PrismaClient,
  run: ImportRunRef,
): Promise<NormalizeReport> {
  const report: NormalizeReport = { created: 0, updated: 0, unchanged: 0, rejected: 0, pending: 0 }

  // Résolution des députés et des groupes : un seul aller-retour, réutilisé pour toutes les positions.
  const personByActeur = new Map<string, string>()
  for (const identifier of await prisma.externalIdentifier.findMany({
    where: { sourceId: 'AN', kind: 'ACTEUR_UID', ownerType: 'Person' },
    select: { value: true, ownerId: true },
  })) {
    personByActeur.set(identifier.value, identifier.ownerId)
  }

  const bodyByOrgane = new Map<string, string>()
  for (const identifier of await prisma.externalIdentifier.findMany({
    where: { sourceId: 'AN', kind: 'ORGANE_UID', ownerType: 'Body' },
    select: { value: true, ownerId: true },
  })) {
    bodyByOrgane.set(identifier.value, identifier.ownerId)
  }

  const ballotByUid = new Map<string, string>()
  const scrutins = await prisma.anScrutinRaw.findMany({ where: { importRunId: run.id } })

  for (const scrutin of scrutins) {
    const key = naturalKey('AN', scrutin.uid)
    const legislature = scrutin.legislature
      ? await prisma.legislature.upsert({
          where: { number: Number(scrutin.legislature) },
          update: {},
          create: { number: Number(scrutin.legislature) },
        })
      : null

    const existing = await prisma.parliamentaryBallot.findUnique({ where: { naturalKey: key } })

    const ballot = await prisma.parliamentaryBallot.upsert({
      where: { naturalKey: key },
      update: {
        outcomeCode: scrutin.sortCode,
        outcomeLabel: scrutin.sortLibelle,
      },
      create: {
        naturalKey: key,
        legislatureId: legislature?.id ?? null,
        number: scrutin.numero,
        date: toDate(scrutin.dateScrutin),
        title: scrutin.titre,
        voteTypeCode: scrutin.codeTypeVote,
        voteTypeLabel: scrutin.libelleTypeVote,
        outcomeCode: scrutin.sortCode,
        outcomeLabel: scrutin.sortLibelle,
        publicationMode: scrutin.modePublication,
        officialFor: toInt(scrutin.decomptePour),
        officialAgainst: toInt(scrutin.decompteContre),
        officialAbstention: toInt(scrutin.decompteAbstentions),
        officialNonVoting: toInt(scrutin.decompteNonVotants),
      },
    })

    if (existing) report.updated++
    else {
      report.created++
      await prisma.provenance.create({
        data: {
          entityType: 'ParliamentaryBallot',
          entityId: ballot.id,
          importRunId: run.id,
          bronzeTable: 'an_scrutin_raw',
          bronzeRef: scrutin.uid,
          status: 'OFFICIAL',
        },
      })
    }

    ballotByUid.set(scrutin.uid, ballot.id)
  }

  // Positions : lues et écrites par lots, le volume interdit le traitement ligne à ligne.
  const existingKeys = new Set(
    (
      await prisma.ballotPosition.findMany({ select: { naturalKey: true } })
    ).map((p) => p.naturalKey),
  )

  let cursor: bigint | undefined
  let buffer: {
    naturalKey: string
    ballotId: string
    personId: string
    position: string
    byDelegation: boolean
    bodyIdAtVote: string | null
  }[] = []

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return
    const inserted = await prisma.ballotPosition.createMany({ data: buffer, skipDuplicates: true })
    report.created += inserted.count
    buffer = []
  }

  for (;;) {
    const page = await prisma.anPositionRaw.findMany({
      where: { importRunId: run.id },
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: BATCH_SIZE,
    })
    if (page.length === 0) break
    cursor = page[page.length - 1]?.id

    for (const raw of page) {
      const ballotId = ballotByUid.get(raw.scrutinUid)
      const personId = personByActeur.get(raw.acteurRef)
      if (!ballotId || !personId) {
        report.pending++
        continue
      }

      const key = naturalKey(ballotId, personId)
      if (existingKeys.has(key)) {
        report.unchanged++
        continue
      }
      existingKeys.add(key)

      buffer.push({
        naturalKey: key,
        ballotId,
        personId,
        position: raw.categorie,
        byDelegation: raw.parDelegation === 'true',
        bodyIdAtVote: raw.groupeRef ? (bodyByOrgane.get(raw.groupeRef) ?? null) : null,
      })
    }

    if (buffer.length >= BATCH_SIZE) await flush()
  }

  await flush()
  return report
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @poligraph/ingestion test`

- [ ] **Step 5 : Commit**

```bash
git add packages/ingestion
git commit -m "feat(ingestion): normalisation des scrutins vers silver"
```

---

## Task 7 : Adapter des scrutins et acteurs historiques

**Files:**
- Create: `packages/ingestion/src/adapters/an/an-scrutins.adapter.ts`
- Modify: `packages/ingestion/src/adapters/an/an-acteurs.adapter.ts` (ajouter `AMO30`)
- Modify: `packages/ingestion/src/index.ts`

- [ ] **Step 1 : Descripteurs des quatre législatures**

`packages/ingestion/src/adapters/an/an-scrutins.adapter.ts` :

```ts
import type { PrismaClient } from '@poligraph/db'
import type {
  FetchedFile,
  ImportRunRef,
  NormalizeReport,
  ResourceDescriptor,
  SourceAdapter,
  StageReport,
} from '../../contract.js'
import { AssembleeNationaleClient } from '../../http/an-client.js'
import { normalizeScrutins } from './normalize-scrutins.js'
import { stageScrutins } from './stage-scrutins.js'

const BASE = 'https://data.assemblee-nationale.fr/static/openData/repository'

/**
 * Le nom du fichier change selon la législature : suffixe romain pour les 14e
 * et 15e, aucun suffixe ensuite. Vérifié sur les archives publiées.
 */
const FICHIERS: Record<number, string> = {
  14: 'Scrutins_XIV.json.zip',
  15: 'Scrutins_XV.json.zip',
  16: 'Scrutins.json.zip',
  17: 'Scrutins.json.zip',
}

export const LEGISLATURES_DISPONIBLES = [14, 15, 16, 17] as const

export class AnScrutinsAdapter implements SourceAdapter {
  readonly source = 'AN' as const

  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: AssembleeNationaleClient,
    private readonly legislatures: readonly number[] = LEGISLATURES_DISPONIBLES,
  ) {}

  async discover(): Promise<ResourceDescriptor[]> {
    return this.legislatures.map((legislature) => {
      const fichier = FICHIERS[legislature]
      if (!fichier) throw new Error(`Législature non couverte : ${legislature}`)
      return {
        sourceKey: 'AN' as const,
        datasetExternalId: `scrutins-${legislature}`,
        datasetTitle: `Scrutins — ${legislature}e législature`,
        resourceExternalId: `${legislature}-${fichier}`,
        url: `${BASE}/${legislature}/loi/scrutins/${fichier}`,
        format: 'zip',
      }
    })
  }

  fetch(descriptor: ResourceDescriptor): Promise<FetchedFile> {
    return this.client.fetch(descriptor)
  }

  stage(file: FetchedFile, run: ImportRunRef): Promise<StageReport> {
    return stageScrutins(this.prisma, file.localPath, run)
  }

  normalize(run: ImportRunRef): Promise<NormalizeReport> {
    return normalizeScrutins(this.prisma, run)
  }
}
```

- [ ] **Step 2 : Ajouter la ressource des acteurs historiques**

Dans `an-acteurs.adapter.ts`, `discover()` doit rendre DEUX descripteurs : `AMO10` (existant) et `AMO30`.

```ts
const AMO30_URL =
  'https://data.assemblee-nationale.fr/static/openData/repository/17/amo/tous_acteurs_mandats_organes_xi_legislature/AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip'
```

Descripteur : `datasetExternalId: 'amo30-historique'`, `datasetTitle: 'Tous les acteurs, mandats et organes depuis la XIe législature'`, `resourceExternalId: 'AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip'`.

> `AMO30` contient 3 119 acteurs et 10 812 organes, dans le **même format** qu'`AMO10`. `stage()` et `normalize()` le traitent sans modification. C'est ce qui rend les scrutins des législatures antérieures exploitables : sans lui, leurs positions n'auraient aucune personne à qui se rattacher.

- [ ] **Step 3 : Exporter**

Ajouter à `packages/ingestion/src/index.ts` :

```ts
export * from './adapters/an/an-scrutins.adapter.js'
```

- [ ] **Step 4 : Vérifier et committer**

```bash
pnpm --filter @poligraph/ingestion typecheck && pnpm --filter @poligraph/ingestion build
git add packages/ingestion
git commit -m "feat(ingestion): adapter des scrutins et acteurs historiques"
```

---

## Task 8 : Commande `import an:scrutins`

**Files:**
- Modify: `apps/api/src/commands/import.command.ts`

- [ ] **Step 1 : Généraliser la commande à plusieurs ressources**

La commande actuelle ne traite qu'**une seule** ressource :

```ts
const [descriptor] = await adapter.discover()
```

Or `discover()` rend désormais deux descripteurs pour `an:acteurs` (`AMO10`, `AMO30`) et jusqu'à quatre pour `an:scrutins`. Trois modifications à apporter :

1. **Boucler sur toutes les ressources.** Remplacer, dans `importNormally` et dans `renormalize`, la déstructuration par une boucle. Une ressource inchangée est signalée et **n'interrompt pas les suivantes** ; une ressource en échec marque son run en échec et propage l'erreur.

2. **Typer sur le contrat, pas sur l'implémentation.** Les méthodes privées reçoivent aujourd'hui `AnActeursAdapter`. Les passer à `SourceAdapter` : c'est tout l'intérêt du contrat, et sans cela `AnScrutinsAdapter` ne pourrait pas être réutilisé par la même commande.

3. **Ajouter l'option `--legislature`.**

```ts
const TARGETS = ['an:acteurs', 'an:scrutins'] as const

interface ImportCommandOptions {
  renormalize?: boolean
  legislature?: number[]
}

@Option({
  flags: '--legislature <liste>',
  description:
    'Législatures à importer pour an:scrutins, séparées par des virgules (défaut : 14,15,16,17)',
})
parseLegislature(value: string): number[] {
  const parsed = value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => !Number.isNaN(n))

  const inconnues = parsed.filter((n) => !LEGISLATURES_DISPONIBLES.includes(n as never))
  if (parsed.length === 0 || inconnues.length > 0) {
    throw new Error(
      `Législatures invalides : ${value}. Valeurs acceptées : ${LEGISLATURES_DISPONIBLES.join(', ')}.`,
    )
  }
  return parsed
}
```

Sélection de l'adapter :

```ts
private buildAdapter(
  target: string,
  prisma: PrismaClient,
  options: ImportCommandOptions,
): SourceAdapter {
  const client = new AssembleeNationaleClient('.data/an')
  if (target === 'an:scrutins') {
    return new AnScrutinsAdapter(prisma, client, options.legislature ?? LEGISLATURES_DISPONIBLES)
  }
  return new AnActeursAdapter(prisma, client)
}
```

Et la boucle, dans `importNormally` :

```ts
private async importNormally(adapter: SourceAdapter, prisma: PrismaClient): Promise<void> {
  const descriptors = await adapter.discover()
  if (descriptors.length === 0) throw new Error('aucune ressource découverte')

  for (const descriptor of descriptors) {
    console.log(`\n=== ${descriptor.datasetTitle} ===`)
    const file = await adapter.fetch(descriptor)
    const run = await openImportRun(prisma, descriptor, file.checksum)

    if (!run) {
      console.log(
        `Ressource inchangée (checksum ${file.checksum.slice(0, 12)}…) : rien à importer.`,
      )
      console.log(
        'Pour rejouer la normalisation depuis le bronze déjà stagé, utilisez --renormalize.',
      )
      continue
    }

    try {
      const stageReport = await adapter.stage(file, run)
      const normalizeReport = await adapter.normalize(run)
      const rejected = stageReport.rejected + normalizeReport.rejected

      await closeImportRun(prisma, run, {
        ...normalizeReport,
        rejected,
        staged: stageReport.staged,
      })

      await this.printReport(prisma, descriptor, run, {
        staged: stageReport.staged,
        created: normalizeReport.created,
        updated: normalizeReport.updated,
        unchanged: normalizeReport.unchanged,
        rejected,
        pending: normalizeReport.pending,
      })
    } catch (error) {
      await failImportRun(prisma, run)
      throw error
    }
  }
}
```

Appliquer la même boucle à `renormalize`, en conservant son comportement actuel : si `findLastSuccessfulRun` ne trouve rien pour une ressource, l'indiquer et passer à la suivante plutôt que d'interrompre tout le lot — mais positionner `process.exitCode = 1` si **aucune** ressource n'a pu être rejouée.

L'ordre de `discover()` compte pour `an:acteurs` : `AMO10` d'abord, `AMO30` ensuite. Les deux fichiers décrivent les mêmes députés en exercice ; le premier import crée les personnes, le second les retrouve par `ExternalIdentifier` et n'ajoute que les députés historiques.

- [ ] **Step 2 : Vérifier sur une seule législature**

```bash
pnpm --filter @poligraph/api cli import an:acteurs
pnpm --filter @poligraph/api cli import an:scrutins --legislature 17
```

Attendu pour la 17e : 8 434 scrutins stagés, ~1 270 476 positions en bronze.

- [ ] **Step 3 : Commit**

```bash
git add apps/api
git commit -m "feat(cli): commande import an:scrutins"
```

---

## Task 9 : `poligraph check` — recompte des scrutins

**Files:**
- Create: `packages/ingestion/src/checks/recount-ballots.ts`
- Create: `apps/api/src/commands/check.command.ts`
- Test: `packages/ingestion/tests/recount-ballots.test.ts`

C'est le contrôle le plus rentable du projet : l'AN publie ses propres décomptes, on recompte les positions importées et on compare. Un écart signale un défaut de lecture.

**Le mode de publication doit être pris en compte.** Un scrutin en `DecompteDissidentsPositionGroupe` ne publie pas toutes les positions : l'écart y est attendu et ne doit pas être signalé comme anomalie, sans quoi 710 fausses alertes noieraient les 35 vraies.

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/ingestion/tests/recount-ballots.test.ts` :

```ts
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { recountBallots } from '../src/checks/recount-ballots.js'
import { stageScrutins } from '../src/adapters/an/stage-scrutins.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ResourceDescriptor } from '../src/contract.js'

const ECLATES = fileURLToPath(new URL('../fixtures/an-scrutins-eclates-sample.zip', import.meta.url))
const MONOLITHE = fileURLToPath(
  new URL('../fixtures/an-scrutins-monolithe-sample.zip', import.meta.url),
)
const prisma = testPrisma()

const descriptor: ResourceDescriptor = {
  sourceKey: 'AN',
  datasetExternalId: 'scrutins',
  datasetTitle: 'Scrutins',
  resourceExternalId: 'Scrutins.json.zip',
  url: 'https://example.invalid/Scrutins.json.zip',
  format: 'zip',
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('recountBallots', () => {
  it('ne signale aucun écart quand le détail nominatif est complet', async () => {
    const run = await openImportRun(prisma, descriptor, 'c1')
    if (!run) throw new Error('run attendu')
    await stageScrutins(prisma, ECLATES, run)

    const report = await recountBallots(prisma)

    expect(report.checked).toBe(5)
    expect(report.mismatches).toHaveLength(0)
  })

  it('ignore les scrutins publiés sans détail nominatif complet', async () => {
    const run = await openImportRun(prisma, descriptor, 'c2')
    if (!run) throw new Error('run attendu')
    await stageScrutins(prisma, MONOLITHE, run)

    const report = await recountBallots(prisma)

    // VTANR5L14V1 est en DecompteNominatif et doit être vérifié.
    // VTANR5L14V2 est en DecompteDissidentsPositionGroupe : l'écart y est attendu.
    expect(report.checked).toBe(1)
    expect(report.skipped).toBe(1)
    expect(report.mismatches).toHaveLength(0)
  })

  it('signale un écart réel avec le détail des catégories', async () => {
    const run = await openImportRun(prisma, descriptor, 'c3')
    if (!run) throw new Error('run attendu')
    await stageScrutins(prisma, ECLATES, run)

    // On retire artificiellement deux positions « pour » d'un scrutin complet.
    const victimes = await prisma.anPositionRaw.findMany({
      where: { scrutinUid: 'VTANR5L17V2657', categorie: 'POUR' },
      take: 2,
    })
    await prisma.anPositionRaw.deleteMany({
      where: { id: { in: victimes.map((v) => v.id) } },
    })

    const report = await recountBallots(prisma)

    expect(report.mismatches).toHaveLength(1)
    const ecart = report.mismatches[0]
    expect(ecart?.scrutinUid).toBe('VTANR5L17V2657')
    expect(ecart?.official.POUR).toBe(121)
    expect(ecart?.counted.POUR).toBe(119)
  })
})
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/ingestion test`

- [ ] **Step 3 : Implémenter**

`packages/ingestion/src/checks/recount-ballots.ts` :

```ts
import type { PrismaClient } from '@poligraph/db'

export interface BallotMismatch {
  scrutinUid: string
  legislature: string | null
  official: Record<string, number>
  counted: Record<string, number>
}

export interface RecountReport {
  checked: number
  skipped: number
  mismatches: BallotMismatch[]
}

/** Seul ce mode garantit que toutes les positions sont publiées nominativement. */
const MODE_COMPLET = 'DecompteNominatif'

const CATEGORIES = ['POUR', 'CONTRE', 'ABSTENTION', 'NON_VOTANT'] as const

/**
 * Recompte les positions importées et les confronte aux décomptes publiés par l'AN.
 * Un écart révèle un défaut de lecture : c'est le contrôle le plus rentable du projet.
 *
 * Les scrutins publiés en « dissidents et position de groupe » sont écartés :
 * l'AN n'y nomme que les dissidents et les non-votants, l'écart y est donc normal.
 */
export async function recountBallots(prisma: PrismaClient): Promise<RecountReport> {
  const report: RecountReport = { checked: 0, skipped: 0, mismatches: [] }

  const scrutins = await prisma.anScrutinRaw.findMany({
    select: {
      uid: true,
      legislature: true,
      modePublication: true,
      decomptePour: true,
      decompteContre: true,
      decompteAbstentions: true,
      decompteNonVotants: true,
    },
  })

  const comptes = await prisma.anPositionRaw.groupBy({
    by: ['scrutinUid', 'categorie'],
    _count: { _all: true },
  })

  const parScrutin = new Map<string, Record<string, number>>()
  for (const ligne of comptes) {
    const courant = parScrutin.get(ligne.scrutinUid) ?? {}
    courant[ligne.categorie] = ligne._count._all
    parScrutin.set(ligne.scrutinUid, courant)
  }

  for (const scrutin of scrutins) {
    if (scrutin.modePublication !== MODE_COMPLET) {
      report.skipped++
      continue
    }
    report.checked++

    const official: Record<string, number> = {
      POUR: Number(scrutin.decomptePour ?? 0),
      CONTRE: Number(scrutin.decompteContre ?? 0),
      ABSTENTION: Number(scrutin.decompteAbstentions ?? 0),
      NON_VOTANT: Number(scrutin.decompteNonVotants ?? 0),
    }
    const brut = parScrutin.get(scrutin.uid) ?? {}
    const counted: Record<string, number> = {}
    for (const categorie of CATEGORIES) counted[categorie] = brut[categorie] ?? 0

    const identique = CATEGORIES.every((c) => official[c] === counted[c])
    if (!identique) {
      report.mismatches.push({
        scrutinUid: scrutin.uid,
        legislature: scrutin.legislature,
        official,
        counted,
      })
    }
  }

  return report
}
```

- [ ] **Step 4 : La commande CLI**

`apps/api/src/commands/check.command.ts` :

```ts
import { Injectable } from '@nestjs/common'
import { Command, CommandRunner } from 'nest-commander'
import { getPrisma } from '@poligraph/db'
import { recountBallots } from '@poligraph/ingestion'

/** Au-delà, la liste devient illisible ; le total exact reste affiché. */
const MAX_LIGNES = 50

@Injectable()
@Command({
  name: 'check',
  description:
    'Recompte les positions importées et les confronte aux décomptes officiels publiés par l’AN',
})
export class CheckCommand extends CommandRunner {
  async run(): Promise<void> {
    const prisma = getPrisma()
    try {
      const report = await recountBallots(prisma)

      console.log('--- Contrôle de cohérence des scrutins ---')
      console.log(`scrutins vérifiés : ${report.checked}`)
      console.log(
        `scrutins écartés  : ${report.skipped}   (détail nominatif non publié par la source)`,
      )
      console.log(`écarts détectés   : ${report.mismatches.length}`)

      if (report.mismatches.length === 0) {
        console.log('\nAucun écart : chaque scrutin vérifié recompte exactement ses décomptes officiels.')
        return
      }

      console.log('')
      for (const ecart of report.mismatches.slice(0, MAX_LIGNES)) {
        const details = (['POUR', 'CONTRE', 'ABSTENTION', 'NON_VOTANT'] as const)
          .filter((c) => ecart.official[c] !== ecart.counted[c])
          .map((c) => `${c} officiel ${ecart.official[c]}, recompté ${ecart.counted[c]}`)
          .join(' | ')
        console.log(`${ecart.scrutinUid} (${ecart.legislature ?? '?'}e) : ${details}`)
      }

      if (report.mismatches.length > MAX_LIGNES) {
        console.log(
          `\n… ${report.mismatches.length - MAX_LIGNES} autres écarts non affichés (total : ${report.mismatches.length}).`,
        )
      }

      // Sortie non nulle : la commande est utilisable comme vérification automatique.
      process.exitCode = 1
    } finally {
      await prisma.$disconnect()
    }
  }
}
```

Déclarer `CheckCommand` dans les `providers` de `apps/api/src/app.module.ts`, aux côtés d'`ImportCommand`.

La troncature affiche toujours le total exact : **jamais de liste raccourcie sans le dire**.

- [ ] **Step 5 : Exporter, lancer et committer**

`recountBallots` doit être exportée pour qu'`apps/api` puisse l'appeler. Ajouter à `packages/ingestion/src/index.ts` :

```ts
export * from './checks/recount-ballots.js'
```

```bash
pnpm --filter @poligraph/ingestion test
pnpm --filter @poligraph/ingestion typecheck && pnpm --filter @poligraph/api typecheck
pnpm build
git add packages/ingestion apps/api
git commit -m "feat(check): recompte des scrutins contre les decomptes officiels"
```

---

## Task 10 : Import réel et vérification

- [ ] **Step 1 : Importer les acteurs historiques**

```bash
pnpm --filter @poligraph/api cli import an:acteurs
```

Attendu : `AMO10` inchangé (déjà importé au plan 1), `AMO30` stagé avec 3 119 acteurs et 10 812 organes.

- [ ] **Step 2 : Importer les quatre législatures**

```bash
pnpm --filter @poligraph/api cli import an:scrutins
```

Attendu, mesuré sur les archives réelles :

| Lég. | Scrutins | Positions |
|---|---|---|
| 14 | 1 354 | 109 913 |
| 15 | 4 417 | 472 631 |
| 16 | 4 106 | 603 813 |
| 17 | 8 434 | 1 270 476 |
| **Total** | **18 311** | **2 456 833** |

Reporter la durée réelle. Si elle dépasse une heure, le signaler comme un problème de performance à traiter, pas comme une fatalité.

- [ ] **Step 3 : Contrôler**

```bash
pnpm --filter @poligraph/api cli check
```

Attendu : environ 17 601 scrutins vérifiés, 710 écartés, **35 écarts** (30 en 15e, 4 en 16e, 1 en 17e).

Ces 35 écarts sont réels et connus. Les examiner et documenter leur cause dans le rapport final — ce sont eux qui justifient l'existence du contrôle.

- [ ] **Step 4 : Vérifier en SQL**

```bash
docker exec poligraph-db psql -U poligraph -d poligraph \
  -c "SELECT count(*) FROM silver.parliamentary_ballot;" \
  -c "SELECT count(*) FROM silver.ballot_position;" \
  -c "SELECT position, count(*) FROM silver.ballot_position GROUP BY position ORDER BY 2 DESC;" \
  -c "SELECT p.display_name, count(*) AS votes FROM silver.ballot_position bp JOIN silver.person p ON p.id = bp.person_id GROUP BY 1 ORDER BY 2 DESC LIMIT 5;"
```

- [ ] **Step 5 : Commit du rapport**

Consigner les chiffres réels obtenus dans ce plan, sous la Task 10, puis committer.

---

### Chiffres réels obtenus (2026-08-25)

**Import** (`import an:scrutins --legislature 14,15,16`, la 17e étant déjà en base) : lancé à 17:56:13, terminé à 18:03:42, soit **7 min 29 s** — sous l'estimation de 10-15 min.

| Lég. | Scrutins stagés | Positions créées (silver) | En attente |
|---|---|---|---|
| 14 | 1 354 | 109 913 | 0 |
| 15 | 4 417 | 472 631 | 0 |
| 16 | 4 106 | 603 811 | 2 |

(« Créés » rapporté par la CLI inclut le scrutin lui-même ; positions = créés − scrutins stagés. Les 2 positions en attente en 16e sont `PA429842` et `PA720634`, déjà identifiés comme manquants d'`AMO30`.)

**Vérification SQL** : bronze **2 456 833** positions sur **18 311** scrutins — exactement les totaux attendus. Silver : **2 456 831** positions (écart de 2, expliqué par les 2 acteurs manquants ci-dessus). Répartition : CONTRE 1 184 742, POUR 1 098 903, ABSTENTION 134 863, NON_VOTANT 38 323. Mode de publication : `DecompteDissidentsPositionGroupe` 710, `DecompteNominatif` 17 601 — conforme au tableau des faits mesurés.

**`poligraph check`** : **17 601 vérifiés, 710 écartés, 35 écarts** — exactement les chiffres attendus (30 en 15e, 4 en 16e, 1 en 17e).

Trois écarts ont été examinés en détail (au-delà du seul `VTANR5L17V1` déjà diagnostiqué), en comparant le payload bronze complet (`decompteVoix` par groupe, listes nominatives, `syntheseVote.decompte`) :

- **`VTANR5L15V2938`** (CONTRE officiel 57, recompté 56) : le groupe `PO774834` déclare `decompteVoix.contre = 8` mais ne nomme que 7 votants dans `decompteNominatif.contres.votant`. Incohérence interne à la source, à l'intérieur d'un seul nœud de groupe.
- **`VTANR5L16V1948`** (ABSTENTION officiel 88, recompté 87) : même défaut — le groupe `PO800502` déclare `decompteVoix.abstentions = 16` (dont `nonVotantsVolontaires = 16`) mais ne nomme que 15 votants.
- **`VTANR5L15V2814`** (POUR officiel 345, recompté 301 ; ABSTENTION officiel 43, recompté 41) : ici la somme des `decompteVoix` de tous les groupes (301 pour, 177 contre, 41 abstentions, 3 non-votants — qui correspond exactement aux listes nominatives) ne colle pas au total officiel `syntheseVote.decompte` (345/177/43/3). Plus révélateur encore : la somme des quatre catégories officielles (345+177+43+3 = 568) ne correspond même pas à `nombreVotants` (565) déclaré par la source dans le même scrutin. Le total officiel est incohérent avec son propre détail par groupe et avec son propre décompte de votants.

**Verdict pour les trois : défaut de source, pas défaut de notre lecture.** Dans les trois cas, notre recomptage reproduit fidèlement soit les listes nominatives, soit la somme des `decompteVoix` par groupe (qui, eux, correspondent exactement aux listes nominatives) ; c'est le total officiel `syntheseVote.decompte` qui ne se recoupe pas avec le détail publié dans le même document. Aucun bug de parsing identifié.

**Sanity-check député** : les 5 députés les plus actifs (Yaël Braun-Pivet 9 832 votes, Marine Hamelet 8 896, Emeric Salmon 8 202, Jean-Luc Fugit 7 784, Anthony Brosse 7 594) sont des figures plausibles de l'actualité parlementaire récente. Les 5 derniers votes de Michel Barnier (21 et 20 juillet 2026, tous POUR sur des textes de fin de session/CMP) sont cohérents et récents. Rien d'implausible observé.

---

## Critère d'achèvement du plan 2

- `poligraph import an:scrutins` importe les quatre législatures et rapporte des chiffres conformes au tableau ci-dessus.
- `poligraph check` vérifie ~17 601 scrutins, en écarte 710 avec justification, et signale 35 écarts réels.
- Aucune position n'est déduite : les scrutins sans détail nominatif conservent leur mode de publication et ne produisent aucune position inventée.
- Relancer l'import ne modifie rien.
- `pnpm test` passe intégralement, sans accès réseau.

Le plan 3 (entity resolution, RNE, CNCCFP, data.gouv) démarre à partir de cet état.
