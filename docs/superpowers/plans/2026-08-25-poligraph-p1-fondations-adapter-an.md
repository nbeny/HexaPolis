# PoliGraph — Plan 1 : Fondations et adapter Assemblée nationale (acteurs, mandats, organes)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disposer d'une base PostgreSQL contenant les 577 députés de la 17e législature, leurs mandats, leurs groupes politiques, leurs commissions et leurs circonscriptions, importés depuis l'open data de l'Assemblée nationale via une CLI idempotente et traçable.

**Architecture:** Monorepo pnpm. Le fichier `AMO10.json.zip` est téléchargé, archivé par checksum, déversé tel quel dans trois tables `bronze` à plat, puis normalisé vers le schéma `silver` (`Person`, `Mandate`, `Body`, `Territory`). Chaque fait écrit en `silver` porte un enregistrement de provenance pointant vers sa ligne `bronze`. La logique métier vit dans `packages/domain`, sans dépendance à Prisma ni à une source.

**Tech Stack:** TypeScript 5.7, Node 22, pnpm 9, Turborepo, Vitest, PostgreSQL 16, Prisma 6 (`multiSchema`), NestJS 11 + nest-commander.

**Spec de référence:** `docs/superpowers/specs/2026-08-25-poligraph-fiche-depute-design.md`

**Avant tout `pnpm --filter … test`** : `@poligraph/ingestion` importe `@poligraph/domain` et `@poligraph/db` par leur `dist/`. Lancer `pnpm build` d'abord, ou passer par `pnpm test` (Turborepo enchaîne les builds via `dependsOn: ["^build"]`).

---

## Écart assumé par rapport à la spec

La spec prévoit un `bronze` « typé par ressource ». Un acteur AN est un JSON profondément imbriqué : le mettre à plat en une seule table est impossible. Le plan le déstructure donc en **trois tables `bronze` à plat** (`an_acteur_raw`, `an_mandat_raw`, `an_organe_raw`), toutes colonnes en `TEXT`, plus une colonne `payload JSONB` conservant le fragment source intégral.

Ce déstructurage est un travail de `parse`, qui appartient à `stage` selon la spec §6.1. Aucune valeur n'est interprétée, convertie ni corrigée à ce stade : les dates restent des chaînes, les nombres aussi. Le typage réel a lieu en `silver`.

---

## Structure des fichiers

```
.
├── package.json                    # workspace racine, scripts turbo
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── docker-compose.yml              # PostgreSQL 16
├── .gitignore                      # ajoute .data/, node_modules, dist
├── packages/
│   ├── domain/                     # AUCUNE dépendance à Prisma ni au réseau
│   │   ├── src/
│   │   │   ├── xml-json.ts         # asArray, nilToNull, textOf
│   │   │   ├── person-name.ts      # normalizeNameForMatching, buildDisplayName
│   │   │   ├── an-codes.ts         # mapping typeOrgane/codeType → types PoliGraph
│   │   │   └── index.ts
│   │   └── tests/
│   ├── db/
│   │   ├── prisma/schema.prisma    # schémas bronze, silver, gold
│   │   └── src/index.ts            # export du client Prisma
│   └── ingestion/
│       ├── src/
│       │   ├── contract.ts         # SourceAdapter et types associés
│       │   ├── zip.ts              # lecture d'entrées JSON d'une archive
│       │   ├── http/an-client.ts   # téléchargement + checksum + cache .data
│       │   ├── run/import-run.ts   # ouverture/clôture d'un import, rejets
│       │   └── adapters/an/
│       │       ├── an-acteurs.adapter.ts
│       │       ├── stage-acteurs.ts
│       │       ├── stage-organes.ts
│       │       └── normalize.ts
│       ├── tests/
│       └── fixtures/               # extraits réels, commités
└── apps/
    └── api/
        ├── src/main.ts             # CommandFactory
        └── src/commands/import.command.ts
```

`apps/web` n'existe pas dans ce plan : il arrive au plan 5.

---

## Task 1 : Squelette du monorepo

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`

- [ ] **Step 1 : Créer les fichiers racine**

`package.json` :

```json
{
  "name": "hexapolis",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.32.1",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "db:up": "docker compose up -d",
    "db:migrate": "pnpm --filter @poligraph/db exec prisma migrate dev"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8",
    "@types/node": "^22.10.0"
  }
}
```

`pnpm-workspace.yaml` :

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`turbo.json` :

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] }
  }
}
```

`tsconfig.base.json` :

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`.gitignore` :

```
node_modules/
dist/
.turbo/
.data/
.env
*.log
```

- [ ] **Step 2 : Installer**

Run: `pnpm install`
Expected: installation réussie, `pnpm-lock.yaml` créé.

- [ ] **Step 3 : Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .gitignore pnpm-lock.yaml
git commit -m "chore: squelette monorepo pnpm + turborepo"
```

---

## Task 2 : PostgreSQL et schémas bronze/silver/gold

**Files:**
- Create: `docker-compose.yml`, `packages/db/package.json`, `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`, `packages/db/tsconfig.json`, `.env.example`

- [ ] **Step 1 : docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16
    container_name: poligraph-db
    environment:
      POSTGRES_USER: poligraph
      POSTGRES_PASSWORD: poligraph
      POSTGRES_DB: poligraph
    ports:
      - "5433:5432"
    volumes:
      - poligraph-pgdata:/var/lib/postgresql/data
      - ./docker/init-test-db.sql:/docker-entrypoint-initdb.d/init-test-db.sql
volumes:
  poligraph-pgdata:
```

`docker/init-test-db.sql` :

```sql
CREATE DATABASE poligraph_test OWNER poligraph;
```

`.env.example` :

```
DATABASE_URL="postgresql://poligraph:poligraph@localhost:5433/poligraph?schema=public"
DATABASE_URL_TEST="postgresql://poligraph:poligraph@localhost:5433/poligraph_test?schema=public"
```

- [ ] **Step 2 : packages/db**

`packages/db/package.json` :

```json
{
  "name": "@poligraph/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "prisma generate && tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "echo 'no tests'"
  },
  "dependencies": { "@prisma/client": "^6.1.0" },
  "devDependencies": { "prisma": "^6.1.0" }
}
```

`packages/db/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/db/prisma/schema.prisma` — schéma initial, uniquement la provenance :

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["bronze", "silver", "gold"]
}

model Source {
  id        String    @id
  label     String
  homepage  String?
  datasets  Dataset[]

  @@map("source")
  @@schema("silver")
}

model Dataset {
  id         String            @id @default(uuid())
  sourceId   String            @map("source_id")
  externalId String            @map("external_id")
  title      String
  source     Source            @relation(fields: [sourceId], references: [id])
  resources  DatasetResource[]

  @@unique([sourceId, externalId])
  @@map("dataset")
  @@schema("silver")
}

model DatasetResource {
  id         String      @id @default(uuid())
  datasetId  String      @map("dataset_id")
  externalId String      @map("external_id")
  url        String
  format     String
  dataset    Dataset     @relation(fields: [datasetId], references: [id])
  runs       ImportRun[]

  @@unique([datasetId, externalId])
  @@map("dataset_resource")
  @@schema("silver")
}

model ImportRun {
  id          String             @id @default(uuid())
  resourceId  String             @map("resource_id")
  checksum    String
  startedAt   DateTime           @default(now()) @map("started_at")
  finishedAt  DateTime?          @map("finished_at")
  status      ImportRunStatus    @default(RUNNING)
  staged      Int                @default(0)
  created     Int                @default(0)
  updated     Int                @default(0)
  unchanged   Int                @default(0)
  rejected    Int                @default(0)
  pending     Int                @default(0)
  resource    DatasetResource    @relation(fields: [resourceId], references: [id])
  rejections  ImportRejection[]

  @@map("import_run")
  @@schema("silver")
}

enum ImportRunStatus {
  RUNNING
  SUCCEEDED
  FAILED
  SKIPPED_UNCHANGED

  @@schema("silver")
}

model ImportRejection {
  id           String    @id @default(uuid())
  importRunId  String    @map("import_run_id")
  bronzeTable  String    @map("bronze_table")
  bronzeRef    String?   @map("bronze_ref")
  code         String
  message      String
  run          ImportRun @relation(fields: [importRunId], references: [id])

  @@index([importRunId])
  @@map("import_rejection")
  @@schema("silver")
}
```

`packages/db/src/index.ts` :

```ts
import { PrismaClient } from '@prisma/client'

export * from '@prisma/client'

let client: PrismaClient | undefined

export function getPrisma(): PrismaClient {
  client ??= new PrismaClient()
  return client
}
```

- [ ] **Step 3 : Démarrer la base et migrer**

```bash
cp .env.example .env
pnpm db:up
pnpm --filter @poligraph/db exec prisma migrate dev --name init_provenance
```

Expected: migration appliquée, les schémas `bronze`, `silver`, `gold` sont créés.

- [ ] **Step 4 : Vérifier les schémas**

```bash
docker exec poligraph-db psql -U poligraph -d poligraph -c "\dn"
```

Expected: la liste contient `bronze`, `gold`, `silver`.

- [ ] **Step 5 : Commit**

```bash
git add docker-compose.yml docker/ .env.example packages/db
git commit -m "feat(db): postgres, prisma multi-schemas et modele de provenance"
```

---

## Task 3 : Helpers de conversion XML→JSON

Les fichiers de l'AN sont des XML convertis en JSON. Deux conséquences systématiques : un tableau à un seul élément devient un objet, et une valeur nulle devient `{"@xsi:nil": "true"}`. Sans ces helpers, chaque parser réintroduirait le même bug.

**Files:**
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/vitest.config.ts`, `packages/domain/src/xml-json.ts`, `packages/domain/src/index.ts`
- Test: `packages/domain/tests/xml-json.test.ts`

- [ ] **Step 1 : Créer le package**

`packages/domain/package.json` :

```json
{
  "name": "@poligraph/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": { "vitest": "^2.1.8" }
}
```

`packages/domain/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/domain/vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
})
```

- [ ] **Step 2 : Écrire le test qui échoue**

`packages/domain/tests/xml-json.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { asArray, nilToNull, textOf } from '../src/xml-json.js'

describe('asArray', () => {
  it('enveloppe un objet unique dans un tableau', () => {
    expect(asArray({ uid: 'PM1' })).toEqual([{ uid: 'PM1' }])
  })

  it('laisse un tableau inchangé', () => {
    expect(asArray([{ uid: 'PM1' }, { uid: 'PM2' }])).toHaveLength(2)
  })

  it('renvoie un tableau vide pour null et undefined', () => {
    expect(asArray(null)).toEqual([])
    expect(asArray(undefined)).toEqual([])
  })
})

describe('nilToNull', () => {
  it('convertit une valeur xsi:nil en null', () => {
    expect(nilToNull({ '@xsi:nil': 'true' })).toBeNull()
  })

  it('laisse une chaîne inchangée', () => {
    expect(nilToNull('2025-09-28')).toBe('2025-09-28')
  })

  it('laisse un objet ordinaire inchangé', () => {
    expect(nilToNull({ codeQualite: 'membre' })).toEqual({ codeQualite: 'membre' })
  })
})

describe('textOf', () => {
  it("extrait le contenu textuel d'un noeud typé", () => {
    expect(textOf({ '@xsi:type': 'IdActeur_type', '#text': 'PA368' })).toBe('PA368')
  })

  it('renvoie une chaîne telle quelle', () => {
    expect(textOf('PA368')).toBe('PA368')
  })

  it('renvoie null pour une valeur absente', () => {
    expect(textOf(null)).toBeNull()
  })
})
```

- [ ] **Step 3 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/domain test`
Expected: FAIL — `Failed to resolve import "../src/xml-json.js"`.

- [ ] **Step 4 : Implémenter**

`packages/domain/src/xml-json.ts` :

```ts
export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

export function nilToNull<T>(value: T): T | null {
  if (value !== null && typeof value === 'object' && '@xsi:nil' in (value as object)) {
    return null
  }
  return value ?? null
}

export function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && '#text' in (value as object)) {
    const text = (value as { '#text': unknown })['#text']
    return typeof text === 'string' ? text : null
  }
  return null
}
```

`packages/domain/src/index.ts` :

```ts
export * from './xml-json.js'
```

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @poligraph/domain test`
Expected: PASS, 9 tests.

- [ ] **Step 6 : Commit**

```bash
git add packages/domain
git commit -m "feat(domain): helpers de conversion XML vers JSON"
```

---

## Task 4 : Normalisation des noms de personnes

**Files:**
- Create: `packages/domain/src/person-name.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/person-name.test.ts`

`normalizeNameForMatching` sert **uniquement à comparer**. La forme d'origine n'est jamais remplacée.

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/domain/tests/person-name.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { buildDisplayName, normalizeNameForMatching } from '../src/person-name.js'

describe('normalizeNameForMatching', () => {
  it('rend identiques les variantes de casse et d’ordre', () => {
    const a = normalizeNameForMatching('Emmanuel', 'Macron')
    const b = normalizeNameForMatching('EMMANUEL', 'MACRON')
    expect(a).toBe(b)
  })

  it('supprime les accents', () => {
    expect(normalizeNameForMatching('Stéphane', 'Peu')).toBe(
      normalizeNameForMatching('Stephane', 'Peu'),
    )
  })

  it('normalise les particules et les apostrophes', () => {
    expect(normalizeNameForMatching('Charles', "d'Ornano")).toBe(
      normalizeNameForMatching('Charles', 'D Ornano'),
    )
  })

  it('traite le trait d’union comme un espace', () => {
    expect(normalizeNameForMatching('Jean-Luc', 'Mélenchon')).toBe(
      normalizeNameForMatching('Jean Luc', 'Melenchon'),
    )
  })

  it('produit une forme prénom puis nom', () => {
    expect(normalizeNameForMatching('Michel', 'Barnier')).toBe('michel|barnier')
  })

  it('ne confond pas deux personnes différentes', () => {
    expect(normalizeNameForMatching('Jean', 'Martin')).not.toBe(
      normalizeNameForMatching('Martin', 'Jean'),
    )
  })
})

describe('buildDisplayName', () => {
  it('assemble civilité, prénom et nom', () => {
    expect(buildDisplayName({ civ: 'M.', prenom: 'Michel', nom: 'Barnier' })).toBe(
      'Michel Barnier',
    )
  })

  it('tolère une civilité absente', () => {
    expect(buildDisplayName({ civ: null, prenom: 'Michel', nom: 'Barnier' })).toBe(
      'Michel Barnier',
    )
  })
})
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/domain test`
Expected: FAIL — module `../src/person-name.js` introuvable.

- [ ] **Step 3 : Implémenter**

`packages/domain/src/person-name.ts` :

```ts
export interface NameParts {
  civ: string | null
  prenom: string
  nom: string
}

function normalizeToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeNameForMatching(prenom: string, nom: string): string {
  return `${normalizeToken(prenom)}|${normalizeToken(nom)}`
}

export function buildDisplayName(parts: NameParts): string {
  return `${parts.prenom} ${parts.nom}`.replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 4 : Exporter**

`packages/domain/src/index.ts` :

```ts
export * from './xml-json.js'
export * from './person-name.js'
```

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @poligraph/domain test`
Expected: PASS, 17 tests au total.

- [ ] **Step 6 : Commit**

```bash
git add packages/domain
git commit -m "feat(domain): normalisation des noms pour rapprochement"
```

---

## Task 5 : Correspondance des codes AN vers les types PoliGraph

**Files:**
- Create: `packages/domain/src/an-codes.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/an-codes.test.ts`

Codes relevés dans `AMO10` du 2026-08-25 : `codeType` d'organe = `CIRCONSCRIPTION` (6555), `ORGEXTPARL` (152), `GA` (150), `GE` (69), `MINISTERE` (36), `MISINFO` (35), `PARPOL` (26), `GP` (12), `COMPER` (8), `ASSEMBLEE` (1), `SENAT` (1), et une vingtaine d'autres. `typeOrgane` de mandat = `ASSEMBLEE`, `GP`, `COMPER`, `COMNL`, `PARPOL`.

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/domain/tests/an-codes.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { bodyTypeFromOrganeCode, mandateTypeFromTypeOrgane } from '../src/an-codes.js'

describe('bodyTypeFromOrganeCode', () => {
  it('reconnaît un groupe parlementaire', () => {
    expect(bodyTypeFromOrganeCode('GP')).toBe('PARLIAMENTARY_GROUP')
  })

  it('reconnaît une commission permanente', () => {
    expect(bodyTypeFromOrganeCode('COMPER')).toBe('COMMITTEE')
  })

  it('reconnaît une commission non législative', () => {
    expect(bodyTypeFromOrganeCode('COMNL')).toBe('COMMITTEE')
  })

  it('reconnaît une délégation', () => {
    expect(bodyTypeFromOrganeCode('DELEG')).toBe('DELEGATION')
  })

  it('renvoie null pour une circonscription, qui est un territoire et non un organe', () => {
    expect(bodyTypeFromOrganeCode('CIRCONSCRIPTION')).toBeNull()
  })

  it('renvoie null pour un code inconnu plutôt que de lever une exception', () => {
    expect(bodyTypeFromOrganeCode('CODE_QUI_NEXISTE_PAS')).toBeNull()
  })
})

describe('mandateTypeFromTypeOrgane', () => {
  it('reconnaît le mandat parlementaire', () => {
    expect(mandateTypeFromTypeOrgane('ASSEMBLEE')).toBe('PARLIAMENTARY')
  })

  it('classe le rattachement à un parti à part', () => {
    expect(mandateTypeFromTypeOrgane('PARPOL')).toBe('PARTY_AFFILIATION')
  })

  it('classe groupe et commissions comme appartenance à un organe', () => {
    expect(mandateTypeFromTypeOrgane('GP')).toBe('BODY_MEMBERSHIP')
    expect(mandateTypeFromTypeOrgane('COMPER')).toBe('BODY_MEMBERSHIP')
  })

  it('renvoie null pour un code inconnu', () => {
    expect(mandateTypeFromTypeOrgane('XXX')).toBeNull()
  })
})
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/domain test`
Expected: FAIL — module `../src/an-codes.js` introuvable.

- [ ] **Step 3 : Implémenter**

`packages/domain/src/an-codes.ts` :

```ts
export type BodyType = 'PARLIAMENTARY_GROUP' | 'COMMITTEE' | 'DELEGATION'
export type MandateKind = 'PARLIAMENTARY' | 'PARTY_AFFILIATION' | 'BODY_MEMBERSHIP'

const BODY_TYPES: Record<string, BodyType> = {
  GP: 'PARLIAMENTARY_GROUP',
  COMPER: 'COMMITTEE',
  COMNL: 'COMMITTEE',
  COMSPSENAT: 'COMMITTEE',
  CMP: 'COMMITTEE',
  DELEG: 'DELEGATION',
  DELEGBUREAU: 'DELEGATION',
  MISINFO: 'DELEGATION',
  MISINFOCOM: 'DELEGATION',
  MISINFOPRE: 'DELEGATION',
}

const MANDATE_KINDS: Record<string, MandateKind> = {
  ASSEMBLEE: 'PARLIAMENTARY',
  PARPOL: 'PARTY_AFFILIATION',
  GP: 'BODY_MEMBERSHIP',
  COMPER: 'BODY_MEMBERSHIP',
  COMNL: 'BODY_MEMBERSHIP',
}

export function bodyTypeFromOrganeCode(code: string): BodyType | null {
  return BODY_TYPES[code] ?? null
}

export function mandateTypeFromTypeOrgane(code: string): MandateKind | null {
  return MANDATE_KINDS[code] ?? null
}
```

- [ ] **Step 4 : Exporter**

`packages/domain/src/index.ts` :

```ts
export * from './xml-json.js'
export * from './person-name.js'
export * from './an-codes.js'
```

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @poligraph/domain test`
Expected: PASS, 27 tests au total.

- [ ] **Step 6 : Commit**

```bash
git add packages/domain
git commit -m "feat(domain): correspondance des codes d'organes AN"
```

---

## Task 6 : Tables bronze de l'Assemblée nationale

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1 : Ajouter les modèles bronze**

Ajouter à la fin de `packages/db/prisma/schema.prisma` :

```prisma
model AnActeurRaw {
  id           BigInt  @id @default(autoincrement())
  importRunId  String  @map("import_run_id")
  entryName    String  @map("entry_name")
  uid          String
  civ          String?
  prenom       String?
  nom          String?
  alpha        String?
  trigramme    String?
  dateNais     String? @map("date_nais")
  villeNais    String? @map("ville_nais")
  depNais      String? @map("dep_nais")
  paysNais     String? @map("pays_nais")
  dateDeces    String? @map("date_deces")
  profession   String?
  uriHatvp     String? @map("uri_hatvp")
  payload      Json

  @@unique([importRunId, uid])
  @@index([uid])
  @@map("an_acteur_raw")
  @@schema("bronze")
}

model AnMandatRaw {
  id                 BigInt  @id @default(autoincrement())
  importRunId        String  @map("import_run_id")
  uid                String
  acteurRef          String  @map("acteur_ref")
  legislature        String?
  typeOrgane         String  @map("type_organe")
  dateDebut          String? @map("date_debut")
  dateFin            String? @map("date_fin")
  codeQualite        String? @map("code_qualite")
  organeRef          String? @map("organe_ref")
  numCirco           String? @map("num_circo")
  numDepartement     String? @map("num_departement")
  region             String?
  departement        String?
  causeMandat        String? @map("cause_mandat")
  refCirconscription String? @map("ref_circonscription")
  causeFin           String? @map("cause_fin")
  payload            Json

  @@unique([importRunId, uid])
  @@index([acteurRef])
  @@map("an_mandat_raw")
  @@schema("bronze")
}

model AnOrganeRaw {
  id              BigInt  @id @default(autoincrement())
  importRunId     String  @map("import_run_id")
  uid             String
  codeType        String  @map("code_type")
  libelle         String?
  libelleAbrege   String? @map("libelle_abrege")
  libelleAbrev    String? @map("libelle_abrev")
  dateDebut       String? @map("date_debut")
  dateFin         String? @map("date_fin")
  legislature     String?
  numero          String?
  regionLibelle   String? @map("region_libelle")
  departementCode String? @map("departement_code")
  couleurAssociee String? @map("couleur_associee")
  payload         Json

  @@unique([importRunId, uid])
  @@index([codeType])
  @@map("an_organe_raw")
  @@schema("bronze")
}
```

- [ ] **Step 2 : Migrer**

Run: `pnpm --filter @poligraph/db exec prisma migrate dev --name bronze_an`
Expected: migration appliquée sans erreur.

- [ ] **Step 3 : Vérifier**

```bash
docker exec poligraph-db psql -U poligraph -d poligraph -c "\dt bronze.*"
```

Expected: `an_acteur_raw`, `an_mandat_raw`, `an_organe_raw`.

- [ ] **Step 4 : Commit**

```bash
git add packages/db
git commit -m "feat(db): tables bronze pour l'Assemblee nationale"
```

---

## Task 7 : Contrat SourceAdapter

**Files:**
- Create: `packages/ingestion/package.json`, `packages/ingestion/tsconfig.json`, `packages/ingestion/vitest.config.ts`, `packages/ingestion/src/contract.ts`, `packages/ingestion/src/index.ts`

Ce contrat est le seul point de couplage entre le cœur et les sources. Il n'a pas de test dédié : c'est une déclaration de types, vérifiée par le typecheck et par les adapters qui l'implémentent.

- [ ] **Step 1 : Créer le package**

`packages/ingestion/package.json` :

```json
{
  "name": "@poligraph/ingestion",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@poligraph/db": "workspace:*",
    "@poligraph/domain": "workspace:*",
    "yauzl-promise": "^4.0.0"
  },
  "devDependencies": { "vitest": "^2.1.8" }
}
```

`packages/ingestion/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/ingestion/vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
})
```

- [ ] **Step 2 : Écrire le contrat**

`packages/ingestion/src/contract.ts` :

```ts
export type SourceKey = 'AN' | 'DATA_GOUV' | 'CNCCFP' | 'RNE'

export interface ResourceDescriptor {
  sourceKey: SourceKey
  datasetExternalId: string
  datasetTitle: string
  resourceExternalId: string
  url: string
  format: string
}

export interface FetchedFile {
  descriptor: ResourceDescriptor
  localPath: string
  checksum: string
  bytes: number
}

export interface ImportRunRef {
  id: string
  resourceId: string
  checksum: string
}

export interface StageReport {
  staged: number
  rejected: number
}

export interface NormalizeReport {
  created: number
  updated: number
  unchanged: number
  rejected: number
  pending: number
}

export interface SourceAdapter {
  readonly source: SourceKey
  discover(): Promise<ResourceDescriptor[]>
  fetch(descriptor: ResourceDescriptor): Promise<FetchedFile>
  stage(file: FetchedFile, run: ImportRunRef): Promise<StageReport>
  normalize(run: ImportRunRef): Promise<NormalizeReport>
}
```

`packages/ingestion/src/index.ts` :

```ts
export * from './contract.js'
```

- [ ] **Step 3 : Vérifier la compilation**

Run: `pnpm install && pnpm --filter @poligraph/ingestion typecheck`
Expected: aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add packages/ingestion pnpm-lock.yaml
git commit -m "feat(ingestion): contrat SourceAdapter"
```

---

## Task 8 : Fixture réelle et lecture d'archive ZIP

Aucun test ne doit toucher le réseau. On fabrique une archive de test à partir de données réelles, réduite à quelques entrées.

**Files:**
- Create: `packages/ingestion/fixtures/an-amo10-sample.zip`, `packages/ingestion/scripts/build-fixture.mjs`, `packages/ingestion/src/zip.ts`
- Test: `packages/ingestion/tests/zip.test.ts`

- [ ] **Step 1 : Script de fabrication de la fixture**

`packages/ingestion/scripts/build-fixture.mjs` — à lancer une fois, avec l'archive réelle téléchargée :

```js
// Usage: node scripts/build-fixture.mjs <AMO10.json.zip> <sortie.zip>
import { createWriteStream } from 'node:fs'
import { open } from 'yauzl-promise'
import archiver from 'archiver'

const [, , input, output] = process.argv
const KEEP_ACTEURS = 3
const KEEP_ORGANES = 8

const zip = await open(input)
const archive = archiver('zip', { zlib: { level: 9 } })
archive.pipe(createWriteStream(output))

let acteurs = 0
let organes = 0
for await (const entry of zip) {
  const isActeur = entry.filename.startsWith('json/acteur/')
  const isOrgane = entry.filename.startsWith('json/organe/')
  if (isActeur && acteurs >= KEEP_ACTEURS) continue
  if (isOrgane && organes >= KEEP_ORGANES) continue
  if (!isActeur && !isOrgane) continue
  const stream = await entry.openReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  archive.append(Buffer.concat(chunks), { name: entry.filename })
  if (isActeur) acteurs++
  if (isOrgane) organes++
}
await zip.close()
await archive.finalize()
console.log(`fixture: ${acteurs} acteurs, ${organes} organes`)
```

Lancer :

```bash
pnpm --filter @poligraph/ingestion add -D archiver
curl -sSL -o /tmp/AMO10.json.zip "https://data.assemblee-nationale.fr/static/openData/repository/17/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip"
node packages/ingestion/scripts/build-fixture.mjs /tmp/AMO10.json.zip packages/ingestion/fixtures/an-amo10-sample.zip
```

Expected: `fixture: 3 acteurs, 8 organes`.

- [ ] **Step 2 : Écrire le test qui échoue**

`packages/ingestion/tests/zip.test.ts` :

```ts
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readJsonEntries } from '../src/zip.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/an-amo10-sample.zip', import.meta.url))

describe('readJsonEntries', () => {
  it('itère uniquement les entrées du préfixe demandé', async () => {
    const names: string[] = []
    for await (const entry of readJsonEntries(FIXTURE, 'json/acteur/')) {
      names.push(entry.name)
    }
    expect(names).toHaveLength(3)
    expect(names.every((n) => n.startsWith('json/acteur/'))).toBe(true)
  })

  it('décode le JSON en UTF-8', async () => {
    for await (const entry of readJsonEntries(FIXTURE, 'json/acteur/')) {
      expect(entry.json).toHaveProperty('acteur')
      return
    }
    throw new Error('aucune entrée lue')
  })
})
```

- [ ] **Step 3 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: FAIL — module `../src/zip.js` introuvable.

- [ ] **Step 4 : Implémenter**

`packages/ingestion/src/zip.ts` :

```ts
import { open } from 'yauzl-promise'

export interface JsonEntry {
  name: string
  json: unknown
}

export async function* readJsonEntries(
  archivePath: string,
  prefix: string,
): AsyncGenerator<JsonEntry> {
  const zip = await open(archivePath)
  try {
    for await (const entry of zip) {
      if (!entry.filename.startsWith(prefix)) continue
      const stream = await entry.openReadStream()
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(chunk as Buffer)
      yield { name: entry.filename, json: JSON.parse(Buffer.concat(chunks).toString('utf-8')) }
    }
  } finally {
    await zip.close()
  }
}
```

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: PASS, 2 tests.

- [ ] **Step 6 : Commit**

```bash
git add packages/ingestion
git commit -m "feat(ingestion): lecture des entrees JSON d'une archive ZIP"
```

---

## Task 9 : Client HTTP de l'Assemblée nationale

**Files:**
- Create: `packages/ingestion/src/http/an-client.ts`
- Test: `packages/ingestion/tests/an-client.test.ts`

Le test lance un serveur HTTP local : on teste le comportement du client (checksum, cache, absence de re-téléchargement), pas la disponibilité de l'AN.

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/ingestion/tests/an-client.test.ts` :

```ts
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AssembleeNationaleClient } from '../src/http/an-client.js'
import type { ResourceDescriptor } from '../src/contract.js'

let server: Server
let baseUrl: string
let cacheDir: string
let hits = 0

beforeAll(async () => {
  hits = 0
  server = createServer((_req, res) => {
    hits++
    res.writeHead(200, { 'content-type': 'application/zip' })
    res.end(Buffer.from('contenu-de-test'))
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('adresse invalide')
  baseUrl = `http://127.0.0.1:${address.port}`
  cacheDir = await mkdtemp(join(tmpdir(), 'poligraph-'))
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(cacheDir, { recursive: true, force: true })
})

function descriptor(): ResourceDescriptor {
  return {
    sourceKey: 'AN',
    datasetExternalId: 'amo10-17',
    datasetTitle: 'Députés actifs, mandats et organes',
    resourceExternalId: 'AMO10.json.zip',
    url: `${baseUrl}/AMO10.json.zip`,
    format: 'zip',
  }
}

describe('AssembleeNationaleClient', () => {
  it('télécharge et calcule un checksum sha256 stable', async () => {
    const client = new AssembleeNationaleClient(cacheDir)
    const file = await client.fetch(descriptor())
    expect(file.checksum).toHaveLength(64)
    expect(file.bytes).toBe(15)
  })

  it('ne retélécharge pas un fichier déjà en cache', async () => {
    const client = new AssembleeNationaleClient(cacheDir)
    const before = hits
    await client.fetch(descriptor())
    expect(hits).toBe(before)
  })
})
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: FAIL — module `../src/http/an-client.js` introuvable.

- [ ] **Step 3 : Implémenter**

`packages/ingestion/src/http/an-client.ts` :

```ts
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FetchedFile, ResourceDescriptor } from '../contract.js'

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export class AssembleeNationaleClient {
  constructor(private readonly cacheDir: string) {}

  async fetch(descriptor: ResourceDescriptor): Promise<FetchedFile> {
    await mkdir(this.cacheDir, { recursive: true })
    const pointer = join(this.cacheDir, `${descriptor.resourceExternalId}.checksum`)

    const cached = await this.readCached(pointer)
    if (cached) return { descriptor, ...cached }

    const response = await fetch(descriptor.url)
    if (!response.ok) {
      throw new Error(`Téléchargement échoué (${response.status}) : ${descriptor.url}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    const checksum = sha256(buffer)
    const localPath = join(this.cacheDir, `${checksum}.bin`)

    await writeFile(localPath, buffer)
    await writeFile(pointer, checksum, 'utf-8')

    return { descriptor, localPath, checksum, bytes: buffer.byteLength }
  }

  private async readCached(
    pointer: string,
  ): Promise<{ localPath: string; checksum: string; bytes: number } | null> {
    try {
      const checksum = (await readFile(pointer, 'utf-8')).trim()
      const localPath = join(this.cacheDir, `${checksum}.bin`)
      const info = await stat(localPath)
      return { localPath, checksum, bytes: info.size }
    } catch {
      return null
    }
  }
}
```

> Le cache est indexé par ressource et non par URL : relancer un import après republication du fichier par l'AN exige de supprimer le pointeur `.checksum`. La détection de republication automatique est hors périmètre du plan 1 — l'option `--force` de la CLI (Task 15) couvre le besoin.

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: PASS, 4 tests.

- [ ] **Step 5 : Commit**

```bash
git add packages/ingestion
git commit -m "feat(ingestion): client HTTP AN avec cache par checksum"
```

---

## Task 10 : Ouverture et clôture d'un import

**Files:**
- Create: `packages/ingestion/src/run/import-run.ts`, `packages/ingestion/tests/helpers/db.ts`
- Test: `packages/ingestion/tests/import-run.test.ts`

- [ ] **Step 1 : Helper de base de test**

`packages/ingestion/tests/helpers/db.ts` :

```ts
import { PrismaClient } from '@poligraph/db'

export function testPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL_TEST
  if (!url) throw new Error('DATABASE_URL_TEST doit être défini pour les tests d’intégration')
  return new PrismaClient({ datasources: { db: { url } } })
}

/**
 * Vide toutes les tables métier. Utilisé par chaque suite d'intégration :
 * il n'y a qu'un seul endroit à mettre à jour quand une table est ajoutée.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE bronze.an_acteur_raw, bronze.an_mandat_raw, bronze.an_organe_raw RESTART IDENTITY CASCADE',
  )
  await prisma.$executeRawUnsafe(
    'TRUNCATE silver.import_rejection, silver.import_run, silver.dataset_resource, silver.dataset, silver.source RESTART IDENTITY CASCADE',
  )
  await prisma.$executeRawUnsafe(
    'TRUNCATE silver.provenance, silver.mandate, silver.body_membership, silver.body, silver.territory, silver.legislature, silver.institution, silver.external_identifier, silver.person_name_variant, silver.person RESTART IDENTITY CASCADE',
  )
}
```

> Les tables `silver` métier sont créées à la Task 13. Jusque-là, la troisième instruction échoue : ajouter cette ligne au helper **au moment de la Task 13**, pas avant.

Préparer la base de test — la variable d'environnement doit être positionnée pour la commande, sans dépendance supplémentaire :

PowerShell :

```powershell
$env:DATABASE_URL = $env:DATABASE_URL_TEST
pnpm --filter @poligraph/db exec prisma migrate deploy
```

bash :

```bash
DATABASE_URL="$DATABASE_URL_TEST" pnpm --filter @poligraph/db exec prisma migrate deploy
```

- [ ] **Step 2 : Écrire le test qui échoue**

`packages/ingestion/tests/import-run.test.ts` :

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { openImportRun, closeImportRun, recordRejection } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ResourceDescriptor } from '../src/contract.js'

const prisma = testPrisma()

const descriptor: ResourceDescriptor = {
  sourceKey: 'AN',
  datasetExternalId: 'amo10-17',
  datasetTitle: 'Députés actifs, mandats et organes',
  resourceExternalId: 'AMO10.json.zip',
  url: 'https://example.invalid/AMO10.json.zip',
  format: 'zip',
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('openImportRun', () => {
  it('crée source, dataset, ressource et run au premier appel', async () => {
    const run = await openImportRun(prisma, descriptor, 'abc123')
    expect(run).not.toBeNull()
    expect(await prisma.source.count()).toBe(1)
    expect(await prisma.dataset.count()).toBe(1)
    expect(await prisma.datasetResource.count()).toBe(1)
  })

  it('renvoie null si le checksum est inchangé depuis un run réussi', async () => {
    const first = await openImportRun(prisma, descriptor, 'abc123')
    if (!first) throw new Error('premier run attendu')
    await closeImportRun(prisma, first, { created: 1, updated: 0, unchanged: 0, rejected: 0, pending: 0 })

    const second = await openImportRun(prisma, descriptor, 'abc123')
    expect(second).toBeNull()
  })

  it('ouvre un nouveau run si le checksum change', async () => {
    const first = await openImportRun(prisma, descriptor, 'abc123')
    if (!first) throw new Error('premier run attendu')
    await closeImportRun(prisma, first, { created: 1, updated: 0, unchanged: 0, rejected: 0, pending: 0 })

    const second = await openImportRun(prisma, descriptor, 'def456')
    expect(second).not.toBeNull()
  })

  it('ne réutilise pas un run précédent resté en échec', async () => {
    const first = await openImportRun(prisma, descriptor, 'abc123')
    if (!first) throw new Error('premier run attendu')
    await prisma.importRun.update({ where: { id: first.id }, data: { status: 'FAILED' } })

    const second = await openImportRun(prisma, descriptor, 'abc123')
    expect(second).not.toBeNull()
  })
})

describe('recordRejection', () => {
  it('trace une ligne rejetée sans lever d’exception', async () => {
    const run = await openImportRun(prisma, descriptor, 'abc123')
    if (!run) throw new Error('run attendu')
    await recordRejection(prisma, run, {
      bronzeTable: 'an_acteur_raw',
      bronzeRef: 'json/acteur/PA1.json',
      code: 'MISSING_UID',
      message: 'uid absent',
    })
    expect(await prisma.importRejection.count()).toBe(1)
  })
})
```

- [ ] **Step 3 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: FAIL — module `../src/run/import-run.js` introuvable.

- [ ] **Step 4 : Implémenter**

`packages/ingestion/src/run/import-run.ts` :

```ts
import type { PrismaClient } from '@poligraph/db'
import type { ImportRunRef, NormalizeReport, ResourceDescriptor } from '../contract.js'

const SOURCE_LABELS: Record<string, string> = {
  AN: 'Assemblée nationale',
  DATA_GOUV: 'data.gouv.fr',
  CNCCFP: 'CNCCFP',
  RNE: 'Répertoire national des élus',
}

export async function openImportRun(
  prisma: PrismaClient,
  descriptor: ResourceDescriptor,
  checksum: string,
): Promise<ImportRunRef | null> {
  const source = await prisma.source.upsert({
    where: { id: descriptor.sourceKey },
    update: {},
    create: {
      id: descriptor.sourceKey,
      label: SOURCE_LABELS[descriptor.sourceKey] ?? descriptor.sourceKey,
    },
  })

  const dataset = await prisma.dataset.upsert({
    where: {
      sourceId_externalId: { sourceId: source.id, externalId: descriptor.datasetExternalId },
    },
    update: { title: descriptor.datasetTitle },
    create: {
      sourceId: source.id,
      externalId: descriptor.datasetExternalId,
      title: descriptor.datasetTitle,
    },
  })

  const resource = await prisma.datasetResource.upsert({
    where: {
      datasetId_externalId: {
        datasetId: dataset.id,
        externalId: descriptor.resourceExternalId,
      },
    },
    update: { url: descriptor.url, format: descriptor.format },
    create: {
      datasetId: dataset.id,
      externalId: descriptor.resourceExternalId,
      url: descriptor.url,
      format: descriptor.format,
    },
  })

  const already = await prisma.importRun.findFirst({
    where: { resourceId: resource.id, checksum, status: 'SUCCEEDED' },
  })
  if (already) return null

  const run = await prisma.importRun.create({
    data: { resourceId: resource.id, checksum },
  })
  return { id: run.id, resourceId: resource.id, checksum }
}

export async function closeImportRun(
  prisma: PrismaClient,
  run: ImportRunRef,
  report: NormalizeReport & { staged?: number },
): Promise<void> {
  await prisma.importRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      status: 'SUCCEEDED',
      staged: report.staged ?? 0,
      created: report.created,
      updated: report.updated,
      unchanged: report.unchanged,
      rejected: report.rejected,
      pending: report.pending,
    },
  })
}

export async function failImportRun(prisma: PrismaClient, run: ImportRunRef): Promise<void> {
  await prisma.importRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), status: 'FAILED' },
  })
}

export async function recordRejection(
  prisma: PrismaClient,
  run: ImportRunRef,
  rejection: { bronzeTable: string; bronzeRef?: string; code: string; message: string },
): Promise<void> {
  await prisma.importRejection.create({
    data: {
      importRunId: run.id,
      bronzeTable: rejection.bronzeTable,
      bronzeRef: rejection.bronzeRef ?? null,
      code: rejection.code,
      message: rejection.message,
    },
  })
}
```

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: PASS, 9 tests.

- [ ] **Step 6 : Commit**

```bash
git add packages/ingestion
git commit -m "feat(ingestion): cycle de vie d'un import et tracage des rejets"
```

---

## Task 11 : Staging des organes vers bronze

**Files:**
- Create: `packages/ingestion/src/adapters/an/stage-organes.ts`
- Test: `packages/ingestion/tests/stage-organes.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/ingestion/tests/stage-organes.test.ts` :

```ts
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { stageOrganes } from '../src/adapters/an/stage-organes.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ResourceDescriptor } from '../src/contract.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/an-amo10-sample.zip', import.meta.url))
const prisma = testPrisma()

const descriptor: ResourceDescriptor = {
  sourceKey: 'AN',
  datasetExternalId: 'amo10-17',
  datasetTitle: 'Députés actifs, mandats et organes',
  resourceExternalId: 'AMO10.json.zip',
  url: 'https://example.invalid/AMO10.json.zip',
  format: 'zip',
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('stageOrganes', () => {
  it('insère une ligne bronze par organe de la fixture', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-organes')
    if (!run) throw new Error('run attendu')

    const report = await stageOrganes(prisma, FIXTURE, run)

    expect(report.staged).toBe(8)
    expect(report.rejected).toBe(0)
    expect(await prisma.anOrganeRaw.count()).toBe(8)
  })

  it('conserve le codeType et le libellé tels que publiés', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-organes')
    if (!run) throw new Error('run attendu')
    await stageOrganes(prisma, FIXTURE, run)

    const rows = await prisma.anOrganeRaw.findMany()
    expect(rows.every((r) => r.codeType.length > 0)).toBe(true)
    expect(rows.every((r) => r.uid.startsWith('PO'))).toBe(true)
  })

  it('est rejouable sans doublon dans le même run', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-organes')
    if (!run) throw new Error('run attendu')
    await stageOrganes(prisma, FIXTURE, run)
    await stageOrganes(prisma, FIXTURE, run)

    expect(await prisma.anOrganeRaw.count()).toBe(8)
  })
})
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: FAIL — module `../src/adapters/an/stage-organes.js` introuvable.

- [ ] **Step 3 : Implémenter**

`packages/ingestion/src/adapters/an/stage-organes.ts` :

```ts
import type { PrismaClient } from '@poligraph/db'
import { nilToNull } from '@poligraph/domain'
import type { ImportRunRef, StageReport } from '../../contract.js'
import { recordRejection } from '../../run/import-run.js'
import { readJsonEntries } from '../../zip.js'

interface OrganeNode {
  uid?: string
  codeType?: string
  libelle?: string
  libelleAbrege?: string
  libelleAbrev?: string
  viMoDe?: { dateDebut?: unknown; dateFin?: unknown }
  legislature?: unknown
  numero?: unknown
  couleurAssociee?: unknown
  lieu?: {
    region?: { libelle?: unknown }
    departement?: { code?: unknown }
  }
}

function str(value: unknown): string | null {
  const cleaned = nilToNull(value)
  return typeof cleaned === 'string' ? cleaned : null
}

export async function stageOrganes(
  prisma: PrismaClient,
  archivePath: string,
  run: ImportRunRef,
): Promise<StageReport> {
  let staged = 0
  let rejected = 0

  for await (const entry of readJsonEntries(archivePath, 'json/organe/')) {
    const organe = (entry.json as { organe?: OrganeNode }).organe
    if (!organe?.uid || !organe.codeType) {
      rejected++
      await recordRejection(prisma, run, {
        bronzeTable: 'an_organe_raw',
        bronzeRef: entry.name,
        code: 'MISSING_UID_OR_TYPE',
        message: 'organe sans uid ou sans codeType',
      })
      continue
    }

    await prisma.anOrganeRaw.upsert({
      where: { importRunId_uid: { importRunId: run.id, uid: organe.uid } },
      update: {},
      create: {
        importRunId: run.id,
        uid: organe.uid,
        codeType: organe.codeType,
        libelle: str(organe.libelle),
        libelleAbrege: str(organe.libelleAbrege),
        libelleAbrev: str(organe.libelleAbrev),
        dateDebut: str(organe.viMoDe?.dateDebut),
        dateFin: str(organe.viMoDe?.dateFin),
        legislature: str(organe.legislature),
        numero: str(organe.numero),
        regionLibelle: str(organe.lieu?.region?.libelle),
        departementCode: str(organe.lieu?.departement?.code),
        couleurAssociee: str(organe.couleurAssociee),
        payload: organe as object,
      },
    })
    staged++
  }

  return { staged, rejected }
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: PASS, 12 tests.

- [ ] **Step 5 : Commit**

```bash
git add packages/ingestion
git commit -m "feat(ingestion): staging des organes AN vers bronze"
```

---

## Task 12 : Staging des acteurs et de leurs mandats vers bronze

Un fichier acteur porte à la fois l'état civil et les mandats. Le staging alimente donc deux tables.

**Files:**
- Create: `packages/ingestion/src/adapters/an/stage-acteurs.ts`
- Test: `packages/ingestion/tests/stage-acteurs.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/ingestion/tests/stage-acteurs.test.ts` :

```ts
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { stageActeurs } from '../src/adapters/an/stage-acteurs.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ResourceDescriptor } from '../src/contract.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/an-amo10-sample.zip', import.meta.url))
const prisma = testPrisma()

const descriptor: ResourceDescriptor = {
  sourceKey: 'AN',
  datasetExternalId: 'amo10-17',
  datasetTitle: 'Députés actifs, mandats et organes',
  resourceExternalId: 'AMO10.json.zip',
  url: 'https://example.invalid/AMO10.json.zip',
  format: 'zip',
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('stageActeurs', () => {
  it('insère une ligne bronze par acteur', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-acteurs')
    if (!run) throw new Error('run attendu')

    await stageActeurs(prisma, FIXTURE, run)

    expect(await prisma.anActeurRaw.count()).toBe(3)
  })

  it('extrait l’uid depuis le noeud typé', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-acteurs')
    if (!run) throw new Error('run attendu')
    await stageActeurs(prisma, FIXTURE, run)

    const rows = await prisma.anActeurRaw.findMany()
    expect(rows.every((r) => r.uid.startsWith('PA'))).toBe(true)
  })

  it('conserve les dates sous forme de chaînes, sans conversion', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-acteurs')
    if (!run) throw new Error('run attendu')
    await stageActeurs(prisma, FIXTURE, run)

    const withBirth = await prisma.anActeurRaw.findFirst({ where: { dateNais: { not: null } } })
    expect(withBirth?.dateNais).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('éclate les mandats de chaque acteur dans an_mandat_raw', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-acteurs')
    if (!run) throw new Error('run attendu')
    await stageActeurs(prisma, FIXTURE, run)

    const mandats = await prisma.anMandatRaw.count()
    expect(mandats).toBeGreaterThan(0)

    const parlementaire = await prisma.anMandatRaw.findFirst({
      where: { typeOrgane: 'ASSEMBLEE' },
    })
    expect(parlementaire?.acteurRef).toMatch(/^PA/)
  })

  it('rattache chaque mandat à un acteur effectivement staged', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-acteurs')
    if (!run) throw new Error('run attendu')
    await stageActeurs(prisma, FIXTURE, run)

    const acteurUids = new Set(
      (await prisma.anActeurRaw.findMany({ select: { uid: true } })).map((a) => a.uid),
    )
    const mandats = await prisma.anMandatRaw.findMany({ select: { acteurRef: true } })

    expect(mandats.length).toBeGreaterThan(0)
    expect(mandats.every((m) => acteurUids.has(m.acteurRef))).toBe(true)
  })

  it('extrait autant de mandats que le payload de l’acteur en contient', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-acteurs')
    if (!run) throw new Error('run attendu')
    await stageActeurs(prisma, FIXTURE, run)

    const acteurs = await prisma.anActeurRaw.findMany()
    const expected = acteurs.reduce((total, acteur) => {
      const payload = acteur.payload as { mandats?: { mandat?: unknown } }
      const mandats = payload.mandats?.mandat
      const count = mandats === null || mandats === undefined
        ? 0
        : Array.isArray(mandats)
          ? mandats.length
          : 1
      return total + count
    }, 0)

    expect(await prisma.anMandatRaw.count()).toBe(expected)
  })
})
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: FAIL — module `../src/adapters/an/stage-acteurs.js` introuvable.

- [ ] **Step 3 : Implémenter**

`packages/ingestion/src/adapters/an/stage-acteurs.ts` :

```ts
import type { PrismaClient } from '@poligraph/db'
import { asArray, nilToNull, textOf } from '@poligraph/domain'
import type { ImportRunRef, StageReport } from '../../contract.js'
import { recordRejection } from '../../run/import-run.js'
import { readJsonEntries } from '../../zip.js'

interface MandatNode {
  uid?: string
  acteurRef?: string
  legislature?: unknown
  typeOrgane?: string
  dateDebut?: unknown
  dateFin?: unknown
  infosQualite?: { codeQualite?: unknown }
  organes?: { organeRef?: unknown }
  election?: {
    lieu?: {
      region?: unknown
      departement?: unknown
      numDepartement?: unknown
      numCirco?: unknown
    }
    causeMandat?: unknown
    refCirconscription?: unknown
  }
  mandature?: { causeFin?: unknown }
}

interface ActeurNode {
  uid?: unknown
  etatCivil?: {
    ident?: {
      civ?: unknown
      prenom?: unknown
      nom?: unknown
      alpha?: unknown
      trigramme?: unknown
    }
    infoNaissance?: {
      dateNais?: unknown
      villeNais?: unknown
      depNais?: unknown
      paysNais?: unknown
    }
    dateDeces?: unknown
  }
  profession?: { libelleCourant?: unknown }
  uri_hatvp?: unknown
  mandats?: { mandat?: MandatNode | MandatNode[] | null }
}

function str(value: unknown): string | null {
  const cleaned = nilToNull(value)
  return typeof cleaned === 'string' ? cleaned : null
}

export async function stageActeurs(
  prisma: PrismaClient,
  archivePath: string,
  run: ImportRunRef,
): Promise<StageReport> {
  let staged = 0
  let rejected = 0

  for await (const entry of readJsonEntries(archivePath, 'json/acteur/')) {
    const acteur = (entry.json as { acteur?: ActeurNode }).acteur
    const uid = textOf(acteur?.uid)

    if (!acteur || !uid) {
      rejected++
      await recordRejection(prisma, run, {
        bronzeTable: 'an_acteur_raw',
        bronzeRef: entry.name,
        code: 'MISSING_UID',
        message: 'acteur sans uid exploitable',
      })
      continue
    }

    const ident = acteur.etatCivil?.ident
    const naissance = acteur.etatCivil?.infoNaissance

    await prisma.anActeurRaw.upsert({
      where: { importRunId_uid: { importRunId: run.id, uid } },
      update: {},
      create: {
        importRunId: run.id,
        entryName: entry.name,
        uid,
        civ: str(ident?.civ),
        prenom: str(ident?.prenom),
        nom: str(ident?.nom),
        alpha: str(ident?.alpha),
        trigramme: str(ident?.trigramme),
        dateNais: str(naissance?.dateNais),
        villeNais: str(naissance?.villeNais),
        depNais: str(naissance?.depNais),
        paysNais: str(naissance?.paysNais),
        dateDeces: str(acteur.etatCivil?.dateDeces),
        profession: str(acteur.profession?.libelleCourant),
        uriHatvp: str(acteur.uri_hatvp),
        payload: acteur as object,
      },
    })
    staged++

    for (const mandat of asArray(acteur.mandats?.mandat)) {
      if (!mandat.uid || !mandat.typeOrgane) {
        rejected++
        await recordRejection(prisma, run, {
          bronzeTable: 'an_mandat_raw',
          bronzeRef: entry.name,
          code: 'MISSING_MANDAT_FIELDS',
          message: `mandat sans uid ou typeOrgane pour ${uid}`,
        })
        continue
      }

      await prisma.anMandatRaw.upsert({
        where: { importRunId_uid: { importRunId: run.id, uid: mandat.uid } },
        update: {},
        create: {
          importRunId: run.id,
          uid: mandat.uid,
          acteurRef: mandat.acteurRef ?? uid,
          legislature: str(mandat.legislature),
          typeOrgane: mandat.typeOrgane,
          dateDebut: str(mandat.dateDebut),
          dateFin: str(mandat.dateFin),
          codeQualite: str(mandat.infosQualite?.codeQualite),
          organeRef: str(mandat.organes?.organeRef),
          numCirco: str(mandat.election?.lieu?.numCirco),
          numDepartement: str(mandat.election?.lieu?.numDepartement),
          region: str(mandat.election?.lieu?.region),
          departement: str(mandat.election?.lieu?.departement),
          causeMandat: str(mandat.election?.causeMandat),
          refCirconscription: str(mandat.election?.refCirconscription),
          causeFin: str(mandat.mandature?.causeFin),
          payload: mandat as object,
        },
      })
    }
  }

  return { staged, rejected }
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: PASS, 18 tests.

- [ ] **Step 5 : Commit**

```bash
git add packages/ingestion
git commit -m "feat(ingestion): staging des acteurs et mandats AN vers bronze"
```

---

## Task 13 : Modèles silver et provenance des faits

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1 : Ajouter les modèles silver**

Ajouter à `packages/db/prisma/schema.prisma` :

```prisma
model Person {
  id             String               @id @default(uuid())
  displayName    String               @map("display_name")
  firstName      String               @map("first_name")
  lastName       String               @map("last_name")
  matchKey       String               @map("match_key")
  civility       String?
  birthDate      DateTime?            @map("birth_date")
  birthPlace     String?              @map("birth_place")
  deathDate      DateTime?            @map("death_date")
  profession     String?
  nameVariants   PersonNameVariant[]
  mandates       Mandate[]
  memberships    BodyMembership[]

  @@index([matchKey])
  @@map("person")
  @@schema("silver")
}

model PersonNameVariant {
  id        String @id @default(uuid())
  personId  String @map("person_id")
  form      String
  sourceId  String @map("source_id")
  person    Person @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@unique([personId, form, sourceId])
  @@map("person_name_variant")
  @@schema("silver")
}

model ExternalIdentifier {
  id        String @id @default(uuid())
  ownerType String @map("owner_type")
  ownerId   String @map("owner_id")
  sourceId  String @map("source_id")
  kind      String
  value     String

  @@unique([sourceId, kind, value])
  @@index([ownerType, ownerId])
  @@map("external_identifier")
  @@schema("silver")
}

model Institution {
  id        String    @id @default(uuid())
  code      String    @unique
  label     String
  mandates  Mandate[]

  @@map("institution")
  @@schema("silver")
}

model Legislature {
  id        String    @id @default(uuid())
  number    Int       @unique
  startDate DateTime? @map("start_date")
  endDate   DateTime? @map("end_date")
  mandates  Mandate[]
  bodies    Body[]

  @@map("legislature")
  @@schema("silver")
}

model Territory {
  id             String      @id @default(uuid())
  type           String
  code           String
  label          String
  parentId       String?     @map("parent_id")
  parent         Territory?  @relation("TerritoryParent", fields: [parentId], references: [id])
  children       Territory[] @relation("TerritoryParent")
  mandates       Mandate[]

  @@unique([type, code])
  @@map("territory")
  @@schema("silver")
}

model Body {
  id            String           @id @default(uuid())
  type          String
  label         String
  shortLabel    String?          @map("short_label")
  legislatureId String?          @map("legislature_id")
  startDate     DateTime?        @map("start_date")
  endDate       DateTime?        @map("end_date")
  color         String?
  legislature   Legislature?     @relation(fields: [legislatureId], references: [id])
  memberships   BodyMembership[]

  @@map("body")
  @@schema("silver")
}

model BodyMembership {
  id         String    @id @default(uuid())
  naturalKey String    @unique @map("natural_key")
  personId   String    @map("person_id")
  bodyId     String    @map("body_id")
  quality    String?
  startDate  DateTime? @map("start_date")
  endDate    DateTime? @map("end_date")
  person     Person    @relation(fields: [personId], references: [id], onDelete: Cascade)
  body       Body      @relation(fields: [bodyId], references: [id], onDelete: Cascade)

  @@map("body_membership")
  @@schema("silver")
}

model Mandate {
  id             String       @id @default(uuid())
  naturalKey     String       @unique @map("natural_key")
  personId       String       @map("person_id")
  institutionId  String       @map("institution_id")
  legislatureId  String?      @map("legislature_id")
  territoryId    String?      @map("territory_id")
  kind           String
  startDate      DateTime?    @map("start_date")
  endDate        DateTime?    @map("end_date")
  endCause       String?      @map("end_cause")
  person         Person       @relation(fields: [personId], references: [id], onDelete: Cascade)
  institution    Institution  @relation(fields: [institutionId], references: [id])
  legislature    Legislature? @relation(fields: [legislatureId], references: [id])
  territory      Territory?   @relation(fields: [territoryId], references: [id])

  @@map("mandate")
  @@schema("silver")
}

model Provenance {
  id          String   @id @default(uuid())
  entityType  String   @map("entity_type")
  entityId    String   @map("entity_id")
  field       String?
  importRunId String   @map("import_run_id")
  bronzeTable String   @map("bronze_table")
  bronzeRef   String   @map("bronze_ref")
  status      String   @default("OFFICIAL")

  @@index([entityType, entityId])
  @@map("provenance")
  @@schema("silver")
}
```

- [ ] **Step 2 : Migrer la base de développement puis la base de test**

```bash
pnpm --filter @poligraph/db exec prisma migrate dev --name silver_identity_mandates
```

Puis, en PowerShell :

```powershell
$env:DATABASE_URL = $env:DATABASE_URL_TEST
pnpm --filter @poligraph/db exec prisma migrate deploy
```

ou, en bash :

```bash
DATABASE_URL="$DATABASE_URL_TEST" pnpm --filter @poligraph/db exec prisma migrate deploy
```

Expected: les deux bases portent la même migration.

- [ ] **Step 2b : Compléter le helper de test**

Ajouter la troisième instruction `TRUNCATE` de `packages/ingestion/tests/helpers/db.ts` annoncée à la Task 10 — les tables `silver` métier existent désormais.

- [ ] **Step 3 : Vérifier**

```bash
docker exec poligraph-db psql -U poligraph -d poligraph -c "\dt silver.*"
```

Expected: `person`, `person_name_variant`, `external_identifier`, `institution`, `legislature`, `territory`, `body`, `body_membership`, `mandate`, `provenance`, plus les tables de provenance d'import.

- [ ] **Step 4 : Commit**

```bash
git add packages/db
git commit -m "feat(db): modeles silver identite, mandats, organes et provenance"
```

---

## Task 14 : Normalisation bronze vers silver

**Files:**
- Create: `packages/ingestion/src/adapters/an/normalize.ts`
- Test: `packages/ingestion/tests/normalize.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/ingestion/tests/normalize.test.ts` :

```ts
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { normalizeAn } from '../src/adapters/an/normalize.js'
import { stageActeurs } from '../src/adapters/an/stage-acteurs.js'
import { stageOrganes } from '../src/adapters/an/stage-organes.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ImportRunRef, ResourceDescriptor } from '../src/contract.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/an-amo10-sample.zip', import.meta.url))
const prisma = testPrisma()

const descriptor: ResourceDescriptor = {
  sourceKey: 'AN',
  datasetExternalId: 'amo10-17',
  datasetTitle: 'Députés actifs, mandats et organes',
  resourceExternalId: 'AMO10.json.zip',
  url: 'https://example.invalid/AMO10.json.zip',
  format: 'zip',
}

async function stageFixture(checksum: string): Promise<ImportRunRef> {
  const run = await openImportRun(prisma, descriptor, checksum)
  if (!run) throw new Error('run attendu')
  await stageOrganes(prisma, FIXTURE, run)
  await stageActeurs(prisma, FIXTURE, run)
  return run
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('normalizeAn', () => {
  it('crée une Person par acteur staged', async () => {
    const run = await stageFixture('c1')
    const report = await normalizeAn(prisma, run)

    expect(report.created).toBeGreaterThan(0)
    expect(await prisma.person.count()).toBe(3)
  })

  it('attache un ExternalIdentifier AN à chaque personne', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    const identifiers = await prisma.externalIdentifier.findMany({
      where: { sourceId: 'AN', kind: 'ACTEUR_UID' },
    })
    expect(identifiers).toHaveLength(3)
    expect(identifiers.every((i) => i.value.startsWith('PA'))).toBe(true)
  })

  it('crée les groupes politiques comme Body de type PARLIAMENTARY_GROUP', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    const groups = await prisma.body.findMany({ where: { type: 'PARLIAMENTARY_GROUP' } })
    expect(groups.length).toBeGreaterThanOrEqual(0)
  })

  it('ne crée pas de Body pour une circonscription', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    const bodies = await prisma.body.findMany()
    expect(bodies.every((b) => b.type !== 'CIRCONSCRIPTION')).toBe(true)
  })

  it('enregistre une provenance pour chaque personne créée', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    const persons = await prisma.person.findMany()
    for (const person of persons) {
      const provenance = await prisma.provenance.findFirst({
        where: { entityType: 'Person', entityId: person.id },
      })
      expect(provenance?.bronzeTable).toBe('an_acteur_raw')
    }
  })

  it('est idempotent : renormaliser ne crée aucune personne supplémentaire', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)
    const second = await normalizeAn(prisma, run)

    expect(second.created).toBe(0)
    expect(await prisma.person.count()).toBe(3)
  })

  it('convertit en Date toute date de naissance présente en bronze', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    const raws = await prisma.anActeurRaw.findMany({ where: { dateNais: { not: null } } })
    expect(raws.length).toBeGreaterThan(0)

    for (const raw of raws) {
      const identifier = await prisma.externalIdentifier.findUnique({
        where: { sourceId_kind_value: { sourceId: 'AN', kind: 'ACTEUR_UID', value: raw.uid } },
      })
      if (!identifier) throw new Error(`identifiant manquant pour ${raw.uid}`)

      const person = await prisma.person.findUnique({ where: { id: identifier.ownerId } })
      expect(person?.birthDate).toBeInstanceOf(Date)
      expect(person?.birthDate?.toISOString().slice(0, 10)).toBe(raw.dateNais)
    }
  })
})
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: FAIL — module `../src/adapters/an/normalize.js` introuvable.

- [ ] **Step 3 : Implémenter**

`packages/ingestion/src/adapters/an/normalize.ts` :

```ts
import type { PrismaClient } from '@poligraph/db'
import {
  bodyTypeFromOrganeCode,
  buildDisplayName,
  mandateTypeFromTypeOrgane,
  normalizeNameForMatching,
} from '@poligraph/domain'
import type { ImportRunRef, NormalizeReport } from '../../contract.js'
import { recordRejection } from '../../run/import-run.js'

const AN_INSTITUTION_CODE = 'ASSEMBLEE_NATIONALE'

function toDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Clé naturelle textuelle. Prisma refuse une valeur nulle dans une clé unique
 * composée, or une date de début peut manquer : on la sérialise en « NA ».
 */
function naturalKey(...parts: (string | null | undefined)[]): string {
  return parts.map((part) => part ?? 'NA').join('::')
}

async function recordProvenance(
  prisma: PrismaClient,
  run: ImportRunRef,
  entityType: string,
  entityId: string,
  bronzeTable: string,
  bronzeRef: string,
): Promise<void> {
  const existing = await prisma.provenance.findFirst({
    where: { entityType, entityId, importRunId: run.id, bronzeRef },
  })
  if (existing) return
  await prisma.provenance.create({
    data: { entityType, entityId, importRunId: run.id, bronzeTable, bronzeRef, status: 'OFFICIAL' },
  })
}

export async function normalizeAn(
  prisma: PrismaClient,
  run: ImportRunRef,
): Promise<NormalizeReport> {
  const report: NormalizeReport = {
    created: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    pending: 0,
  }

  const institution = await prisma.institution.upsert({
    where: { code: AN_INSTITUTION_CODE },
    update: {},
    create: { code: AN_INSTITUTION_CODE, label: 'Assemblée nationale' },
  })

  // --- Organes : Body pour les organes parlementaires, Territory pour les circonscriptions
  const organeToBody = new Map<string, string>()
  const organeToTerritory = new Map<string, string>()

  const organes = await prisma.anOrganeRaw.findMany({ where: { importRunId: run.id } })
  for (const organe of organes) {
    if (organe.codeType === 'CIRCONSCRIPTION') {
      const code = `${organe.departementCode ?? '00'}-${organe.numero ?? '0'}`
      const territory = await prisma.territory.upsert({
        where: { type_code: { type: 'CIRCONSCRIPTION', code } },
        update: { label: organe.libelle ?? code },
        create: { type: 'CIRCONSCRIPTION', code, label: organe.libelle ?? code },
      })
      organeToTerritory.set(organe.uid, territory.id)
      continue
    }

    const bodyType = bodyTypeFromOrganeCode(organe.codeType)
    if (!bodyType) continue

    const existingId = await prisma.externalIdentifier.findUnique({
      where: { sourceId_kind_value: { sourceId: 'AN', kind: 'ORGANE_UID', value: organe.uid } },
    })

    let bodyId = existingId?.ownerId
    if (!bodyId) {
      const legislature = organe.legislature
        ? await prisma.legislature.upsert({
            where: { number: Number(organe.legislature) },
            update: {},
            create: { number: Number(organe.legislature) },
          })
        : null

      const body = await prisma.body.create({
        data: {
          type: bodyType,
          label: organe.libelle ?? organe.uid,
          shortLabel: organe.libelleAbrege ?? organe.libelleAbrev,
          legislatureId: legislature?.id ?? null,
          startDate: toDate(organe.dateDebut),
          endDate: toDate(organe.dateFin),
          color: organe.couleurAssociee,
        },
      })
      bodyId = body.id
      report.created++
      await prisma.externalIdentifier.create({
        data: { ownerType: 'Body', ownerId: body.id, sourceId: 'AN', kind: 'ORGANE_UID', value: organe.uid },
      })
      await recordProvenance(prisma, run, 'Body', body.id, 'an_organe_raw', organe.uid)
    } else {
      report.unchanged++
    }
    organeToBody.set(organe.uid, bodyId)
  }

  // --- Acteurs : Person + identifiant externe
  const acteurToPerson = new Map<string, string>()
  const acteurs = await prisma.anActeurRaw.findMany({ where: { importRunId: run.id } })

  for (const acteur of acteurs) {
    if (!acteur.prenom || !acteur.nom) {
      report.rejected++
      await recordRejection(prisma, run, {
        bronzeTable: 'an_acteur_raw',
        bronzeRef: acteur.uid,
        code: 'MISSING_NAME',
        message: 'prénom ou nom absent',
      })
      continue
    }

    const identifier = await prisma.externalIdentifier.findUnique({
      where: { sourceId_kind_value: { sourceId: 'AN', kind: 'ACTEUR_UID', value: acteur.uid } },
    })

    let personId = identifier?.ownerId
    if (!personId) {
      const person = await prisma.person.create({
        data: {
          displayName: buildDisplayName({ civ: acteur.civ, prenom: acteur.prenom, nom: acteur.nom }),
          firstName: acteur.prenom,
          lastName: acteur.nom,
          matchKey: normalizeNameForMatching(acteur.prenom, acteur.nom),
          civility: acteur.civ,
          birthDate: toDate(acteur.dateNais),
          birthPlace: acteur.villeNais,
          deathDate: toDate(acteur.dateDeces),
          profession: acteur.profession,
        },
      })
      personId = person.id
      report.created++
      await prisma.externalIdentifier.create({
        data: { ownerType: 'Person', ownerId: person.id, sourceId: 'AN', kind: 'ACTEUR_UID', value: acteur.uid },
      })
      await recordProvenance(prisma, run, 'Person', person.id, 'an_acteur_raw', acteur.uid)
    } else {
      report.unchanged++
    }

    await prisma.personNameVariant.upsert({
      where: {
        personId_form_sourceId: {
          personId,
          form: `${acteur.nom} ${acteur.prenom}`,
          sourceId: 'AN',
        },
      },
      update: {},
      create: { personId, form: `${acteur.nom} ${acteur.prenom}`, sourceId: 'AN' },
    })

    acteurToPerson.set(acteur.uid, personId)
  }

  // --- Mandats
  const mandats = await prisma.anMandatRaw.findMany({ where: { importRunId: run.id } })
  for (const mandat of mandats) {
    const personId = acteurToPerson.get(mandat.acteurRef)
    if (!personId) {
      report.pending++
      continue
    }

    const kind = mandateTypeFromTypeOrgane(mandat.typeOrgane)
    if (!kind) continue

    if (kind === 'BODY_MEMBERSHIP') {
      const bodyId = mandat.organeRef ? organeToBody.get(mandat.organeRef) : undefined
      if (!bodyId) {
        report.pending++
        continue
      }
      await prisma.bodyMembership.upsert({
        where: { naturalKey: naturalKey(personId, bodyId, mandat.dateDebut) },
        update: { endDate: toDate(mandat.dateFin), quality: mandat.codeQualite },
        create: {
          naturalKey: naturalKey(personId, bodyId, mandat.dateDebut),
          personId,
          bodyId,
          quality: mandat.codeQualite,
          startDate: toDate(mandat.dateDebut),
          endDate: toDate(mandat.dateFin),
        },
      })
      continue
    }

    const legislature = mandat.legislature
      ? await prisma.legislature.upsert({
          where: { number: Number(mandat.legislature) },
          update: {},
          create: { number: Number(mandat.legislature) },
        })
      : null

    const territoryId = mandat.refCirconscription
      ? (organeToTerritory.get(mandat.refCirconscription) ?? null)
      : null

    const key = naturalKey(personId, institution.id, kind, mandat.dateDebut)
    const created = await prisma.mandate.upsert({
      where: { naturalKey: key },
      update: { endDate: toDate(mandat.dateFin), endCause: mandat.causeFin, territoryId },
      create: {
        naturalKey: key,
        personId,
        institutionId: institution.id,
        legislatureId: legislature?.id ?? null,
        territoryId,
        kind,
        startDate: toDate(mandat.dateDebut),
        endDate: toDate(mandat.dateFin),
        endCause: mandat.causeFin,
      },
    })

    await recordProvenance(prisma, run, 'Mandate', created.id, 'an_mandat_raw', mandat.uid)
  }

  return report
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: PASS, 25 tests.

- [ ] **Step 5 : Commit**

```bash
git add packages/ingestion
git commit -m "feat(ingestion): normalisation AN de bronze vers silver"
```

---

## Task 15 : Adapter AN complet et CLI

**Files:**
- Create: `packages/ingestion/src/adapters/an/an-acteurs.adapter.ts`, `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/commands/import.command.ts`
- Modify: `packages/ingestion/src/index.ts`

- [ ] **Step 1 : Assembler l'adapter**

`packages/ingestion/src/adapters/an/an-acteurs.adapter.ts` :

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
import { normalizeAn } from './normalize.js'
import { stageActeurs } from './stage-acteurs.js'
import { stageOrganes } from './stage-organes.js'

const AMO10_URL =
  'https://data.assemblee-nationale.fr/static/openData/repository/17/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip'

export class AnActeursAdapter implements SourceAdapter {
  readonly source = 'AN' as const

  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: AssembleeNationaleClient,
  ) {}

  async discover(): Promise<ResourceDescriptor[]> {
    return [
      {
        sourceKey: 'AN',
        datasetExternalId: 'amo10-17',
        datasetTitle: 'Députés actifs, mandats actifs et organes — 17e législature',
        resourceExternalId: 'AMO10_deputes_actifs_mandats_actifs_organes.json.zip',
        url: AMO10_URL,
        format: 'zip',
      },
    ]
  }

  fetch(descriptor: ResourceDescriptor): Promise<FetchedFile> {
    return this.client.fetch(descriptor)
  }

  async stage(file: FetchedFile, run: ImportRunRef): Promise<StageReport> {
    const organes = await stageOrganes(this.prisma, file.localPath, run)
    const acteurs = await stageActeurs(this.prisma, file.localPath, run)
    return {
      staged: organes.staged + acteurs.staged,
      rejected: organes.rejected + acteurs.rejected,
    }
  }

  normalize(run: ImportRunRef): Promise<NormalizeReport> {
    return normalizeAn(this.prisma, run)
  }
}
```

`packages/ingestion/src/index.ts` :

```ts
export * from './contract.js'
export * from './zip.js'
export * from './http/an-client.js'
export * from './run/import-run.js'
export * from './adapters/an/an-acteurs.adapter.js'
```

- [ ] **Step 2 : Créer l'application CLI**

`apps/api/package.json` :

```json
{
  "name": "@poligraph/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "poligraph": "./dist/main.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "echo 'no tests'",
    "cli": "tsx src/main.ts"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@poligraph/db": "workspace:*",
    "@poligraph/ingestion": "workspace:*",
    "nest-commander": "^3.15.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": { "tsx": "^4.19.2" }
}
```

`apps/api/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src"]
}
```

`apps/api/src/commands/import.command.ts` :

```ts
import { Command, CommandRunner, Option } from 'nest-commander'
import { getPrisma } from '@poligraph/db'
import {
  AnActeursAdapter,
  AssembleeNationaleClient,
  closeImportRun,
  failImportRun,
  openImportRun,
} from '@poligraph/ingestion'

interface ImportOptions {
  renormalize?: boolean
}

@Command({ name: 'import', arguments: '<target>', description: 'Importe une source de données' })
export class ImportCommand extends CommandRunner {
  @Option({ flags: '--renormalize', description: 'Rejoue la normalisation depuis bronze, sans réseau' })
  parseRenormalize(): boolean {
    return true
  }

  async run(inputs: string[], options: ImportOptions): Promise<void> {
    const target = inputs[0]
    if (target !== 'an:acteurs') {
      console.error(`Cible inconnue : ${target}. Cibles disponibles : an:acteurs`)
      process.exitCode = 1
      return
    }

    const prisma = getPrisma()
    const adapter = new AnActeursAdapter(prisma, new AssembleeNationaleClient('.data/an'))

    const [descriptor] = await adapter.discover()
    if (!descriptor) throw new Error('aucune ressource découverte')

    const file = await adapter.fetch(descriptor)
    const run = await openImportRun(prisma, descriptor, file.checksum)

    if (!run) {
      console.log(`Ressource inchangée (checksum ${file.checksum.slice(0, 12)}…) — import ignoré.`)
      console.log('Utiliser --renormalize pour rejouer la normalisation depuis bronze.')
      await prisma.$disconnect()
      return
    }

    try {
      const staged = options.renormalize
        ? { staged: 0, rejected: 0 }
        : await adapter.stage(file, run)
      const normalized = await adapter.normalize(run)

      await closeImportRun(prisma, run, { ...normalized, staged: staged.staged })

      console.log('--- Rapport d’import ---')
      console.log(`source        : ${descriptor.sourceKey}`)
      console.log(`ressource     : ${descriptor.resourceExternalId}`)
      console.log(`checksum      : ${file.checksum.slice(0, 12)}…`)
      console.log(`stagées       : ${staged.staged}`)
      console.log(`créées        : ${normalized.created}`)
      console.log(`mises à jour  : ${normalized.updated}`)
      console.log(`inchangées    : ${normalized.unchanged}`)
      console.log(`rejetées      : ${staged.rejected + normalized.rejected}`)
      console.log(`en attente    : ${normalized.pending}`)
    } catch (error) {
      await failImportRun(prisma, run)
      throw error
    } finally {
      await prisma.$disconnect()
    }
  }
}
```

`apps/api/src/app.module.ts` :

```ts
import { Module } from '@nestjs/common'
import { ImportCommand } from './commands/import.command.js'

@Module({ providers: [ImportCommand] })
export class AppModule {}
```

`apps/api/src/main.ts` :

```ts
import 'reflect-metadata'
import { CommandFactory } from 'nest-commander'
import { AppModule } from './app.module.js'

await CommandFactory.run(AppModule, ['warn', 'error'])
```

- [ ] **Step 3 : Lancer l'import réel**

```bash
pnpm install
pnpm --filter @poligraph/api cli import an:acteurs
```

Expected: rapport affiché, `stagées` ≈ 7702 (577 acteurs + 7125 organes), `rejetées` = 0.

- [ ] **Step 4 : Vérifier le résultat en SQL**

```bash
docker exec poligraph-db psql -U poligraph -d poligraph -c "SELECT count(*) FROM silver.person;"
docker exec poligraph-db psql -U poligraph -d poligraph -c "SELECT type, count(*) FROM silver.body GROUP BY type;"
docker exec poligraph-db psql -U poligraph -d poligraph -c "SELECT count(*) FROM silver.mandate WHERE kind = 'PARLIAMENTARY';"
```

Expected: 577 personnes ; des `PARLIAMENTARY_GROUP` et des `COMMITTEE` ; au moins 577 mandats parlementaires.

- [ ] **Step 5 : Commit**

```bash
git add packages/ingestion apps/api pnpm-lock.yaml
git commit -m "feat(cli): commande import an:acteurs"
```

---

## Task 16 : Test d'idempotence de bout en bout

**Files:**
- Test: `packages/ingestion/tests/idempotence.test.ts`

C'est le test qui protège la règle centrale du pipeline : rejouer un import ne modifie rien.

- [ ] **Step 1 : Écrire le test**

`packages/ingestion/tests/idempotence.test.ts` :

```ts
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { normalizeAn } from '../src/adapters/an/normalize.js'
import { stageActeurs } from '../src/adapters/an/stage-acteurs.js'
import { stageOrganes } from '../src/adapters/an/stage-organes.js'
import { openImportRun, closeImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ResourceDescriptor } from '../src/contract.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/an-amo10-sample.zip', import.meta.url))
const prisma = testPrisma()

const descriptor: ResourceDescriptor = {
  sourceKey: 'AN',
  datasetExternalId: 'amo10-17',
  datasetTitle: 'Députés actifs, mandats et organes',
  resourceExternalId: 'AMO10.json.zip',
  url: 'https://example.invalid/AMO10.json.zip',
  format: 'zip',
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('idempotence du pipeline', () => {
  it('un second import au même checksum est refusé et ne modifie rien', async () => {
    const first = await openImportRun(prisma, descriptor, 'identique')
    if (!first) throw new Error('premier run attendu')
    await stageOrganes(prisma, FIXTURE, first)
    await stageActeurs(prisma, FIXTURE, first)
    const report = await normalizeAn(prisma, first)
    await closeImportRun(prisma, first, report)

    const personsAfterFirst = await prisma.person.count()
    const mandatesAfterFirst = await prisma.mandate.count()

    const second = await openImportRun(prisma, descriptor, 'identique')
    expect(second).toBeNull()

    expect(await prisma.person.count()).toBe(personsAfterFirst)
    expect(await prisma.mandate.count()).toBe(mandatesAfterFirst)
  })

  it('renormaliser sans restager ne crée aucun doublon', async () => {
    const run = await openImportRun(prisma, descriptor, 'renorm')
    if (!run) throw new Error('run attendu')
    await stageOrganes(prisma, FIXTURE, run)
    await stageActeurs(prisma, FIXTURE, run)
    await normalizeAn(prisma, run)

    const persons = await prisma.person.count()
    const bodies = await prisma.body.count()

    await normalizeAn(prisma, run)

    expect(await prisma.person.count()).toBe(persons)
    expect(await prisma.body.count()).toBe(bodies)
  })
})
```

- [ ] **Step 2 : Lancer le test**

Run: `pnpm --filter @poligraph/ingestion test`
Expected: PASS, 27 tests.

- [ ] **Step 3 : Lancer la suite complète**

Run: `pnpm test`
Expected: tous les packages passent.

- [ ] **Step 4 : Commit**

```bash
git add packages/ingestion
git commit -m "test(ingestion): idempotence du pipeline de bout en bout"
```

---

## Task 17 : Intégration continue

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1 : Écrire le workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: poligraph
          POSTGRES_PASSWORD: poligraph
          POSTGRES_DB: poligraph_test
        ports: ['5433:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgresql://poligraph:poligraph@localhost:5433/poligraph_test?schema=public
      DATABASE_URL_TEST: postgresql://poligraph:poligraph@localhost:5433/poligraph_test?schema=public
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @poligraph/db exec prisma migrate deploy
      - run: pnpm build
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 2 : Vérifier localement l'équivalent**

Run: `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test`
Expected: tout passe.

- [ ] **Step 3 : Commit**

```bash
git add .github
git commit -m "ci: build, typecheck et tests sur postgres"
```

---

## Critère d'achèvement du plan 1

- `pnpm --filter @poligraph/api cli import an:acteurs` produit un rapport chiffré et 0 rejet.
- `silver.person` contient 577 lignes.
- `silver.body` contient les groupes politiques et les commissions permanentes de la 17e législature.
- `silver.mandate` contient au moins un mandat `PARLIAMENTARY` par député, rattaché à une circonscription.
- Chaque `Person` et chaque `Mandate` possède au moins un enregistrement dans `silver.provenance`.
- Relancer la commande affiche « Ressource inchangée » et ne modifie aucune ligne.
- `pnpm test` passe intégralement, sans accès réseau.

Le plan 2 (scrutins 14e–17e et `poligraph check`) démarre à partir de cet état.
