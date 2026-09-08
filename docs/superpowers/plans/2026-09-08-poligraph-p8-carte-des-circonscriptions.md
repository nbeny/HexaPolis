# Carte des circonscriptions — plan d'implémentation

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE — utiliser
> superpowers:subagent-driven-development (recommandé) ou
> superpowers:executing-plans pour exécuter ce plan tâche par tâche. Les
> étapes sont des cases à cocher (`- [ ]`).

**But :** montrer où siège chaque député, sans faire disparaître les 18 que la
source ne géolocalise pas.

**Architecture :** les contours arrivent par le pipeline comme n'importe quelle
autre source — téléchargement à checksum, ligne bronze par entité, provenance
en silver — puis un script émet un asset GeoJSON que le front sert
directement. La géométrie ne transite jamais par GraphQL. La page `/carte` est
un composant client Leaflet ; c'est le second du projet, après l'historique de
vote.

**Pile :** Prisma 6, NestJS 11, Next.js 15, Leaflet, vitest 2, pnpm 10.

**Spec :** `docs/superpowers/specs/2026-09-08-poligraph-pagination-et-carte-design.md`, §4.

**Prérequis, déjà livrés par le plan p7 :** CORS sur liste d'origines
explicite, `NEXT_PUBLIC_POLIGRAPH_API_URL`, `graphql-fetch-client.ts`, et le
préflight `OPTIONS` vérifié.

---

## Écart assumé par rapport à la spec

La spec §4.4 prescrivait du **TopoJSON**. Mesure faite sur le fichier réel
avant d'écrire ce plan :

| Forme | Brut | Sur le réseau (gzip) |
| --- | --- | --- |
| GeoJSON source | 5,4 Mo | **1,55 Mo** |
| Arrondi à 4 décimales (~11 m) | 5,4 Mo | 1,55 Mo — *aucun gain, la source est déjà à cette précision* |
| Arrondi à 3 décimales (~111 m) | 4,8 Mo | 1,10 Mo |

Le TopoJSON descendrait sans doute vers 400 Ko, au prix de **deux
dépendances** (`topojson-server` à l'ingestion, `topojson-client` dans le
navigateur) et d'une conversion côté client. Pour un fichier chargé une fois
et mis en cache par le navigateur, 1,55 Mo ne les justifie pas. Next compresse
les fichiers de `public/` par défaut.

**On émet donc du GeoJSON à la précision de la source.** Si l'usage montre que
c'est trop lourd, ajouter TopoJSON plus tard reste un changement contenu :
l'asset est produit par un script isolé et consommé à un seul endroit.

---

## Attention, quatre pièges de ce dépôt

1. **`turbo.exe` est bloqué** par Smart App Control (`spawn UNKNOWN`). Utiliser
   `pnpm --filter <paquet> exec vitest run`, ou les variantes `test:seq` /
   `build:seq` / `typecheck:seq` à la racine. Jamais `pnpm test`.
2. **`apps/api/schema.gql` est réécrit** par NestJS à chaque démarrage du
   module. Ce plan ne touche pas aux résolveurs : s'il bouge, c'est un signal
   d'alerte.
3. **Ne jamais sonder un paquet de `node_modules` en écrivant dedans.** pnpm
   matérialise par hardlink depuis un store partagé par toute la machine ;
   écrire à travers le hardlink corrompt le store, invisible à `git status`.
   Un incident de ce type a déjà eu lieu ici. Copie détachée
   (`cp --remove-destination`) ou `pnpm patch`, et vérification **contre le
   store**.
4. **La base de test est partagée.** `packages/ingestion` désactive
   `fileParallelism` pour cette raison. Après tout redémarrage du conteneur,
   attendre `pg_isready`.

---

## Structure des fichiers

| Fichier | Responsabilité | Action |
| --- | --- | --- |
| `packages/db/prisma/schema.prisma` | modèle bronze `GeoCirconscriptionRaw` | Modifier |
| `packages/db/prisma/migrations/…_geo_contours/` | la migration | Créer |
| `packages/ingestion/src/adapters/geo/codes.ts` | correspondance code interne ↔ code GeoJSON | Créer |
| `packages/ingestion/src/adapters/geo/geo.adapter.ts` | descripteur, téléchargement | Créer |
| `packages/ingestion/src/adapters/geo/stage-geo.ts` | une ligne bronze par entité | Créer |
| `packages/ingestion/src/adapters/geo/normalize-geo.ts` | provenance de la géométrie sur les territoires | Créer |
| `packages/ingestion/scripts/emit-geo.ts` | écrit l'asset dans `apps/web/public/geo/` | Créer |
| `apps/web/public/geo/circonscriptions.json` | l'asset servi | Généré, versionné |
| `apps/web/src/lib/carte-couleurs.ts` | couleur d'une zone, fonctions pures | Créer |
| `apps/web/src/components/carte.tsx` | composant client Leaflet | Créer |
| `apps/web/src/app/carte/page.tsx` | la page, rendue serveur, qui monte la carte | Créer |
| `apps/web/src/app/layout.tsx` | lien « Carte » dans la barre | Modifier |

---

## Tâche 1 : la table bronze et sa migration

**Fichiers :**
- Modifier : `packages/db/prisma/schema.prisma`
- Créer : une migration Prisma

- [ ] **Étape 1 : déclarer le modèle**

Ajouter à `packages/db/prisma/schema.prisma`, à côté des autres modèles bronze
(`RneEluRaw` sert de modèle de style) :

```prisma
model GeoCirconscriptionRaw {
  id                  BigInt  @id @default(autoincrement())
  importRunId         String  @map("import_run_id")
  ligne               Int
  codeCirconscription String? @map("code_circonscription")
  codeDepartement     String? @map("code_departement")
  nomCirconscription  String? @map("nom_circonscription")
  nomDepartement      String? @map("nom_departement")
  /// Géométrie GeoJSON telle que publiée, sans simplification ni reprojection.
  geometry            Json
  payload             Json

  @@unique([importRunId, ligne])
  @@index([codeCirconscription])
  @@map("geo_circonscription_raw")
  @@schema("bronze")
}
```

- [ ] **Étape 2 : générer la migration**

```sh
pnpm --filter @poligraph/db exec prisma migrate dev --name geo_contours
```

Attendu : une migration créée sous `packages/db/prisma/migrations/`, et
`Database schema is up to date` ensuite.

Si Prisma se plaint de `DATABASE_URL`, passer par `pnpm db:migrate` depuis la
racine, qui charge le `.env` via `scripts/with-env.mjs`.

- [ ] **Étape 3 : vérifier**

```sh
pnpm db:status
docker exec poligraph-db psql -U poligraph -d poligraph -c "\d bronze.geo_circonscription_raw"
```

Attendu : la table existe avec les huit colonnes.

- [ ] **Étape 4 : committer**

```sh
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): table bronze pour les contours de circonscriptions"
```

Terminer par :
```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015XXpzVNPLoQwKUGRewV655
```

---

## Tâche 2 : la correspondance des codes

C'est le cœur du sujet, et la seule partie réellement piégeuse. Elle se fait
en TDD pur, sans base ni réseau.

**Fichiers :**
- Créer : `packages/ingestion/src/adapters/geo/codes.ts`
- Test : `packages/ingestion/tests/geo-codes.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `packages/ingestion/tests/geo-codes.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { codeGeoDepuisCirconscription } from '../src/adapters/geo/codes.js'

describe('codeGeoDepuisCirconscription', () => {
  it('métropole : département sur deux caractères, rang sur deux', () => {
    expect(codeGeoDepuisCirconscription('01-4')).toBe('0104')
    expect(codeGeoDepuisCirconscription('75-6')).toBe('7506')
    expect(codeGeoDepuisCirconscription('93-10')).toBe('9310')
  })

  it('Corse : le code de département reste littéral', () => {
    expect(codeGeoDepuisCirconscription('2A-1')).toBe('2A01')
    expect(codeGeoDepuisCirconscription('2B-2')).toBe('2B02')
  })

  it('outre-mer : le GeoJSON emploie les codes INSEE historiques à lettre', () => {
    expect(codeGeoDepuisCirconscription('971-1')).toBe('ZA01')
    expect(codeGeoDepuisCirconscription('972-4')).toBe('ZB04')
    expect(codeGeoDepuisCirconscription('973-2')).toBe('ZC02')
    expect(codeGeoDepuisCirconscription('974-7')).toBe('ZD07')
    expect(codeGeoDepuisCirconscription('975-1')).toBe('ZS01')
    expect(codeGeoDepuisCirconscription('976-2')).toBe('ZM02')
  })

  it('rend null pour les territoires que la source ne cartographie pas', () => {
    // Français de l'étranger : aucun territoire cartographiable, par nature.
    expect(codeGeoDepuisCirconscription('099-1')).toBeNull()
    expect(codeGeoDepuisCirconscription('099-11')).toBeNull()
    // Collectivités absentes du fichier publié.
    expect(codeGeoDepuisCirconscription('977-1')).toBeNull()
    expect(codeGeoDepuisCirconscription('986-1')).toBeNull()
    expect(codeGeoDepuisCirconscription('987-3')).toBeNull()
    expect(codeGeoDepuisCirconscription('988-2')).toBeNull()
  })

  it('rend null sur une forme qu’il ne sait pas lire, plutôt que de deviner', () => {
    expect(codeGeoDepuisCirconscription('')).toBeNull()
    expect(codeGeoDepuisCirconscription('75')).toBeNull()
    expect(codeGeoDepuisCirconscription('75-')).toBeNull()
    expect(codeGeoDepuisCirconscription('pas-un-code')).toBeNull()
  })
})
```

- [ ] **Étape 2 : lancer, constater l'échec**

```sh
pnpm --filter @poligraph/ingestion exec vitest run tests/geo-codes.test.ts
```

Attendu : ÉCHEC — le module `../src/adapters/geo/codes.js` n'existe pas.

- [ ] **Étape 3 : implémenter**

Créer `packages/ingestion/src/adapters/geo/codes.ts` :

```ts
/**
 * Traduit un code de circonscription interne (`silver.territory.code`, de la
 * forme `93-10`) vers le code employé par le GeoJSON des contours
 * (`codeCirconscription`, de la forme `9310`).
 *
 * La correspondance n'est pas une simple concaténation : le fichier publié
 * emploie pour l'outre-mer les codes INSEE historiques à lettre, hérités
 * d'une nomenclature antérieure aux codes à trois chiffres. Elle est donc
 * écrite en clair et testée code par code, plutôt que dérivée d'une règle
 * qu'on aurait devinée.
 *
 * Rend `null` quand la source ne cartographie pas le territoire — c'est un
 * fait à afficher, pas une erreur à masquer : voir la liste des 18 députés
 * concernés dans la spec §4.3.
 */
const OUTRE_MER: Record<string, string> = {
  '971': 'ZA', // Guadeloupe
  '972': 'ZB', // Martinique
  '973': 'ZC', // Guyane
  '974': 'ZD', // La Réunion
  '975': 'ZS', // Saint-Pierre-et-Miquelon
  '976': 'ZM', // Mayotte
}

/**
 * Territoires que le fichier publié ne couvre pas. Énumérés plutôt que
 * déduits : « absent du GeoJSON » et « code que nous ne savons pas traduire »
 * sont deux choses différentes, et seule la première est un fait sur la
 * source.
 */
const SANS_CONTOUR = new Set([
  '099', // Français de l'étranger — aucun territoire cartographiable
  '977', // Saint-Martin / Saint-Barthélemy
  '986', // Wallis-et-Futuna
  '987', // Polynésie française
  '988', // Nouvelle-Calédonie
])

export function codeGeoDepuisCirconscription(code: string): string | null {
  const separateur = code.indexOf('-')
  if (separateur <= 0) return null

  const departement = code.slice(0, separateur)
  const rang = code.slice(separateur + 1)
  if (rang === '' || !/^\d+$/.test(rang)) return null

  if (SANS_CONTOUR.has(departement)) return null

  const prefixe = OUTRE_MER[departement] ?? departement
  // Les codes métropolitains à trois chiffres n'existent pas ; ceux de la
  // Corse (`2A`, `2B`) font déjà deux caractères. Le `padStart` ne sert donc
  // qu'aux départements à un chiffre, qui n'apparaissent pas dans nos données
  // mais que rien n'interdit de recevoir.
  if (prefixe.length > 2) return null

  return `${prefixe.padStart(2, '0')}${rang.padStart(2, '0')}`
}
```

- [ ] **Étape 4 : relancer**

```sh
pnpm --filter @poligraph/ingestion exec vitest run tests/geo-codes.test.ts
```

Attendu : SUCCÈS, 5 tests.

- [ ] **Étape 5 : committer**

```sh
git add packages/ingestion/src/adapters/geo/codes.ts packages/ingestion/tests/geo-codes.test.ts
git commit -m "feat(ingestion): correspondance des codes de circonscription vers le GeoJSON"
```

Terminer par les deux lignes d'attribution.

---

## Tâche 3 : l'adaptateur et le staging bronze

**Fichiers :**
- Créer : `packages/ingestion/src/adapters/geo/geo.adapter.ts`, `stage-geo.ts`
- Modifier : `packages/ingestion/src/index.ts` (exports)
- Test : `packages/ingestion/tests/stage-geo.test.ts`
- Fixture : `packages/ingestion/fixtures/geo-circonscriptions.json`

- [ ] **Étape 1 : construire une fixture réduite**

Ne pas committer 5,4 Mo de fixture. Écrire un petit GeoJSON à la main, avec
six entités choisies pour couvrir les cas du tableau de la tâche 2 :

`packages/ingestion/fixtures/geo-circonscriptions.json`

```json
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature",
      "properties": { "codeDepartement": "01", "nomDepartement": "Ain", "codeCirconscription": "0104", "nomCirconscription": "4ème circonscription" },
      "geometry": { "type": "Polygon", "coordinates": [[[5.0, 46.0], [5.1, 46.0], [5.1, 46.1], [5.0, 46.0]]] } },
    { "type": "Feature",
      "properties": { "codeDepartement": "2A", "nomDepartement": "Corse-du-Sud", "codeCirconscription": "2A01", "nomCirconscription": "1ère circonscription" },
      "geometry": { "type": "Polygon", "coordinates": [[[8.7, 41.9], [8.8, 41.9], [8.8, 42.0], [8.7, 41.9]]] } },
    { "type": "Feature",
      "properties": { "codeDepartement": "ZD", "nomDepartement": "La Réunion", "codeCirconscription": "ZD07", "nomCirconscription": "7ème circonscription" },
      "geometry": { "type": "Polygon", "coordinates": [[[55.4, -21.0], [55.5, -21.0], [55.5, -20.9], [55.4, -21.0]]] } },
    { "type": "Feature",
      "properties": { "codeDepartement": "93", "nomDepartement": "Seine-Saint-Denis", "codeCirconscription": "9310", "nomCirconscription": "10ème circonscription" },
      "geometry": { "type": "Polygon", "coordinates": [[[2.4, 48.9], [2.5, 48.9], [2.5, 49.0], [2.4, 48.9]]] } },
    { "type": "Feature",
      "properties": { "codeDepartement": "75", "nomDepartement": "Paris", "codeCirconscription": "7506", "nomCirconscription": "6ème circonscription" },
      "geometry": { "type": "MultiPolygon", "coordinates": [[[[2.3, 48.85], [2.35, 48.85], [2.35, 48.87], [2.3, 48.85]]]] } },
    { "type": "Feature",
      "properties": { "codeDepartement": "99", "nomDepartement": "Inconnu", "codeCirconscription": "", "nomCirconscription": "" },
      "geometry": { "type": "Polygon", "coordinates": [[[0.0, 0.0], [0.1, 0.0], [0.1, 0.1], [0.0, 0.0]]] } }
  ]
}
```

La sixième entité, au code vide, existe pour vérifier que le staging la charge
quand même : bronze est fidèle à ce qui a été publié, y compris aux lignes que
la normalisation rejettera. C'est la règle que suivent déjà `stage-cnccfp` et
`stage-resultats`.

- [ ] **Étape 2 : écrire le test qui échoue**

Créer `packages/ingestion/tests/stage-geo.test.ts`, sur le modèle exact de
`packages/ingestion/tests/stage-rne.test.ts` (lire ce fichier d'abord pour en
reprendre les helpers de base de test et la forme du `beforeAll`) :

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { stageGeo } from '../src/adapters/geo/stage-geo.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/geo-circonscriptions.json', import.meta.url))

describe('stageGeo', () => {
  it('insère une ligne bronze par entité, y compris celle au code vide', async () => {
    const rapport = await stageGeo(prisma, FIXTURE, run)
    expect(rapport.staged).toBe(6)
    const lignes = await prisma.geoCirconscriptionRaw.count({ where: { importRunId: run.id } })
    expect(lignes).toBe(6)
  })

  it('numérote les lignes à partir de 1, utilisées comme référence bronze', async () => {
    const lignes = await prisma.geoCirconscriptionRaw.findMany({
      where: { importRunId: run.id },
      orderBy: { ligne: 'asc' },
    })
    expect(lignes.map((l) => l.ligne)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('conserve les codes tels que publiés, sans traduction', async () => {
    const ligne = await prisma.geoCirconscriptionRaw.findFirst({
      where: { importRunId: run.id, codeCirconscription: 'ZD07' },
    })
    expect(ligne?.codeDepartement).toBe('ZD')
    expect(ligne?.nomDepartement).toBe('La Réunion')
  })

  it('conserve la géométrie sans la simplifier ni la reprojeter', async () => {
    const ligne = await prisma.geoCirconscriptionRaw.findFirst({
      where: { importRunId: run.id, codeCirconscription: '7506' },
    })
    expect((ligne?.geometry as any).type).toBe('MultiPolygon')
    expect((ligne?.geometry as any).coordinates[0][0][0]).toEqual([2.3, 48.85])
  })

  it('est rejouable dans le même run sans créer de doublon', async () => {
    await stageGeo(prisma, FIXTURE, run)
    const lignes = await prisma.geoCirconscriptionRaw.count({ where: { importRunId: run.id } })
    expect(lignes).toBe(6)
  })
})
```

- [ ] **Étape 3 : lancer, constater l'échec**

```sh
pnpm --filter @poligraph/ingestion exec vitest run tests/stage-geo.test.ts
```

Attendu : ÉCHEC — `stage-geo.js` n'existe pas.

- [ ] **Étape 4 : implémenter le staging**

Créer `packages/ingestion/src/adapters/geo/stage-geo.ts` :

```ts
import { readFile } from 'node:fs/promises'
import type { PrismaClient } from '@poligraph/db'
import type { ImportRunRef, StageReport } from '../../contract.js'

interface GeoFeature {
  properties?: Record<string, unknown>
  geometry?: unknown
}

/**
 * Charge les contours tels quels en bronze : codes inchangés, géométrie non
 * simplifiée, aucune traduction. C'est la normalisation qui interprète.
 *
 * Le fichier ne publie aucun identifiant d'entité stable ; le rang dans la
 * collection (1-indexé) tient lieu de référence bronze, comme la ligne pour
 * le RNE et la CNCCFP.
 *
 * Le fichier entier est lu en mémoire — 5,4 Mo, contre un flux JSON qui
 * demanderait une dépendance de plus pour un gain nul à cette taille.
 */
export async function stageGeo(
  prisma: PrismaClient,
  path: string,
  run: ImportRunRef,
): Promise<StageReport> {
  const collection = JSON.parse(await readFile(path, 'utf-8')) as { features?: GeoFeature[] }
  const features = collection.features ?? []

  let staged = 0
  let ligne = 0

  for (const feature of features) {
    ligne++
    const p = feature.properties ?? {}
    await prisma.geoCirconscriptionRaw.upsert({
      where: { importRunId_ligne: { importRunId: run.id, ligne } },
      update: {},
      create: {
        importRunId: run.id,
        ligne,
        codeCirconscription: (p.codeCirconscription as string) || null,
        codeDepartement: (p.codeDepartement as string) || null,
        nomCirconscription: (p.nomCirconscription as string) || null,
        nomDepartement: (p.nomDepartement as string) || null,
        geometry: feature.geometry as never,
        payload: p as never,
      },
    })
    staged++
  }

  return { staged, rejected: 0 }
}
```

- [ ] **Étape 5 : implémenter l'adaptateur**

Créer `packages/ingestion/src/adapters/geo/geo.adapter.ts`, sur le modèle de
`rne.adapter.ts` :

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
import { SourceFileClient } from '../../http/source-file-client.js'
import { normalizeGeo } from './normalize-geo.js'
import { stageGeo } from './stage-geo.js'

/**
 * « Contours géographiques des circonscriptions législatives », data.gouv.fr,
 * Licence Ouverte 2.0, publié le 13/06/2024. Version « simplifiée p20 »,
 * 5,4 Mo, 559 entités pour 577 sièges — les 18 manquants sont un fait sur la
 * source, détaillé dans la spec §4.3 et affiché sous la carte.
 */
const CONTOURS_CIRCONSCRIPTIONS_URL =
  'https://www.data.gouv.fr/api/1/datasets/r/8b681b69-739c-47eb-a96b-06e8e2d8dc08'

export class GeoAdapter implements SourceAdapter {
  readonly source = 'DATA_GOUV' as const

  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: SourceFileClient,
  ) {}

  async discover(): Promise<ResourceDescriptor[]> {
    return [
      {
        sourceKey: 'DATA_GOUV',
        datasetExternalId: 'contours-circonscriptions-legislatives',
        datasetTitle: 'Contours géographiques des circonscriptions législatives',
        resourceExternalId: 'circonscriptions-legislatives-p20.geojson',
        url: CONTOURS_CIRCONSCRIPTIONS_URL,
        format: 'geojson',
      },
    ]
  }

  fetch(descriptor: ResourceDescriptor): Promise<FetchedFile> {
    return this.client.fetch(descriptor)
  }

  stage(file: FetchedFile, run: ImportRunRef): Promise<StageReport> {
    return stageGeo(this.prisma, file.localPath, run)
  }

  normalize(run: ImportRunRef): Promise<NormalizeReport> {
    return normalizeGeo(this.prisma, run)
  }
}
```

Exporter `GeoAdapter` depuis `packages/ingestion/src/index.ts`, à côté des
autres adaptateurs, et le brancher là où les quatre autres le sont — lire
`apps/api/src/commands/import.command.ts` pour trouver l'endroit exact et
suivre la même forme.

- [ ] **Étape 6 : relancer et committer**

```sh
pnpm --filter @poligraph/ingestion exec vitest run tests/stage-geo.test.ts
```

Attendu : SUCCÈS, 5 tests.

```sh
git add packages/ingestion/src/adapters/geo packages/ingestion/fixtures/geo-circonscriptions.json \
        packages/ingestion/tests/stage-geo.test.ts packages/ingestion/src/index.ts \
        apps/api/src/commands/import.command.ts
git commit -m "feat(ingestion): adaptateur des contours de circonscriptions"
```

Terminer par les deux lignes d'attribution.

---

## Tâche 4 : la normalisation et les 18 sans contour

C'est la tâche qui porte l'exigence du projet : ne pas faire disparaître ce
que la source ne dit pas.

**Fichiers :**
- Créer : `packages/ingestion/src/adapters/geo/normalize-geo.ts`
- Test : `packages/ingestion/tests/normalize-geo.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `packages/ingestion/tests/normalize-geo.test.ts`. Comme les autres tests
de normalisation, il tourne contre la base de test — lire
`packages/ingestion/tests/stage-rne.test.ts` pour les helpers.

```ts
describe('normalizeGeo', () => {
  it('rattache une provenance de géométrie à chaque territoire couvert', async () => {
    const rapport = await normalizeGeo(prisma, run)
    expect(rapport.created).toBeGreaterThan(0)

    const provenance = await prisma.provenance.findFirst({
      where: { entityType: 'Territory', field: 'geometry', bronzeTable: 'geo_circonscription_raw' },
    })
    expect(provenance).not.toBeNull()
  })

  it('ne rattache rien aux territoires que la source ne cartographie pas', async () => {
    // La fixture ne contient aucune entité pour `099-*` : la normalisation ne
    // doit donc inventer aucune provenance pour les Français de l'étranger.
    const territoire = await prisma.territory.findFirst({ where: { code: '099-1' } })
    if (territoire) {
      const provenance = await prisma.provenance.count({
        where: { entityType: 'Territory', entityId: territoire.id, field: 'geometry' },
      })
      expect(provenance).toBe(0)
    }
  })

  it('compte les entités bronze qu’il n’a pas su rattacher plutôt que de les taire', async () => {
    // La sixième entité de la fixture a un code vide : elle ne correspond à
    // aucun territoire et doit ressortir dans `rejected`, pas disparaître.
    const rapport = await normalizeGeo(prisma, run)
    expect(rapport.rejected).toBeGreaterThanOrEqual(1)
  })

  it('est rejouable sans dupliquer les provenances', async () => {
    await normalizeGeo(prisma, run)
    const avant = await prisma.provenance.count({ where: { field: 'geometry' } })
    await normalizeGeo(prisma, run)
    const apres = await prisma.provenance.count({ where: { field: 'geometry' } })
    expect(apres).toBe(avant)
  })
})
```

- [ ] **Étape 2 : lancer, constater l'échec**

```sh
pnpm --filter @poligraph/ingestion exec vitest run tests/normalize-geo.test.ts
```

Attendu : ÉCHEC — `normalize-geo.js` n'existe pas.

- [ ] **Étape 3 : implémenter**

Créer `packages/ingestion/src/adapters/geo/normalize-geo.ts`. La forme
attendue, à écrire en suivant le style de `normalize-rne.ts` :

- lire les lignes bronze du run
- pour chaque `silver.territory` de type `CIRCONSCRIPTION`, calculer son code
  GeoJSON avec `codeGeoDepuisCirconscription`
- quand la traduction rend un code et qu'une ligne bronze le porte, écrire une
  `provenance` `{ entityType: 'Territory', entityId, field: 'geometry',
  bronzeTable: 'geo_circonscription_raw', bronzeRef: String(ligne) }`, en
  upsert pour rester rejouable
- quand la traduction rend `null`, ne rien écrire : c'est un territoire que la
  source ne cartographie pas, et l'absence de provenance **est** l'information
- compter dans `rejected` les lignes bronze qu'aucun territoire ne réclame
  (code vide, ou code inconnu de nos territoires)

**La géométrie n'est pas recopiée en silver.** Elle reste en bronze et part
dans l'asset. Silver ne porte que le lien de provenance — c'est ce qui permet
de répondre « d'où vient ce contour » sans transporter des mégaoctets dans
GraphQL.

- [ ] **Étape 4 : relancer**

```sh
pnpm --filter @poligraph/ingestion exec vitest run tests/normalize-geo.test.ts
```

Attendu : SUCCÈS, 4 tests.

- [ ] **Étape 5 : l'import réel, et le test qui verrouille les 18**

Lancer l'import de la source géo sur la base de développement, par la CLI :

```sh
pnpm --filter @poligraph/api run cli import --source DATA_GOUV
```

(Lire `apps/api/src/commands/import.command.ts` pour la forme exacte de la
commande et de ses options.)

Puis mesurer la couverture réelle :

```sh
docker exec poligraph-db psql -U poligraph -d poligraph -P pager=off -c "
select
  (select count(*) from gold.deputy_card) as deputes,
  count(distinct d.person_id) as avec_contour
from gold.deputy_card d
join silver.territory t on t.code = d.constituency_code and t.type = 'CIRCONSCRIPTION'
join silver.provenance p on p.entity_id = t.id and p.field = 'geometry';"
```

Attendu : **559 sur 577**. Consigner le chiffre obtenu dans ce plan.

Écrire ensuite le test qui verrouille la liste, dans
`packages/ingestion/tests/geo-codes.test.ts` :

```ts
it('nomme les 18 députés que la source ne cartographie pas', () => {
  // Ce test échoue si un territoire gagne ou perd un contour. C'est
  // volontaire : la liste affichée sous la carte doit rester exacte, et une
  // dérive silencieuse ferait disparaître des députés de l'interface.
  const sansContour = [
    ['099', 11, 'Français de l’étranger'],
    ['977', 1, 'Saint-Martin / Saint-Barthélemy'],
    ['986', 1, 'Wallis-et-Futuna'],
    ['987', 3, 'Polynésie française'],
    ['988', 2, 'Nouvelle-Calédonie'],
  ] as const
  expect(sansContour.reduce((total, [, n]) => total + n, 0)).toBe(18)
  for (const [departement] of sansContour) {
    expect(codeGeoDepuisCirconscription(`${departement}-1`)).toBeNull()
  }
})
```

- [ ] **Étape 6 : committer**

```sh
git add packages/ingestion/src/adapters/geo/normalize-geo.ts \
        packages/ingestion/tests/normalize-geo.test.ts packages/ingestion/tests/geo-codes.test.ts \
        docs/superpowers/plans/2026-09-08-poligraph-p8-carte-des-circonscriptions.md
git commit -m "feat(ingestion): provenance des contours, et les 18 territoires sans géométrie"
```

Terminer par les deux lignes d'attribution.

---

## Tâche 5 : l'émission de l'asset

**Fichiers :**
- Créer : `packages/ingestion/scripts/emit-geo.ts`
- Modifier : `package.json` racine (un script `geo:emit`)
- Généré : `apps/web/public/geo/circonscriptions.json`

- [ ] **Étape 1 : écrire le script**

Créer `packages/ingestion/scripts/emit-geo.ts`. Il lit les lignes bronze du
dernier run géo et écrit un `FeatureCollection` dans
`apps/web/public/geo/circonscriptions.json`.

Deux exigences :

- **N'émettre que les propriétés utiles à la carte** — `codeCirconscription`,
  `codeDepartement`, `nomDepartement` — et non le `payload` entier. Le front
  n'a pas besoin du reste, et chaque propriété inutile est du poids sur le
  réseau de chaque visiteur.
- **Écrire du JSON compact** (`JSON.stringify(x)` sans indentation). Mesure
  faite : 5,4 Mo bruts, **1,55 Mo une fois gzippés par Next**. C'est la forme
  retenue ; voir « Écart assumé » en tête de plan pour la raison du refus de
  TopoJSON.

Ajouter à `package.json` racine :

```json
    "geo:emit": "node scripts/with-env.mjs pnpm --filter @poligraph/ingestion exec tsx scripts/emit-geo.ts",
```

- [ ] **Étape 2 : émettre et mesurer**

```sh
pnpm geo:emit
ls -lh apps/web/public/geo/circonscriptions.json
node -e "const g=require('./apps/web/public/geo/circonscriptions.json'); console.log(g.features.length, 'entités')"
```

Attendu : **559 entités**. Consigner la taille obtenue dans ce plan.

- [ ] **Étape 3 : committer l'asset**

L'asset est dérivé, mais il est versionné : c'est la seule chose que le front
sert, et un `pnpm install` ne doit pas exiger un import complet pour que la
carte s'affiche.

```sh
git add packages/ingestion/scripts/emit-geo.ts package.json apps/web/public/geo/circonscriptions.json \
        docs/superpowers/plans/2026-09-08-poligraph-p8-carte-des-circonscriptions.md
git commit -m "feat(ingestion): émission de l'asset GeoJSON servi par le front"
```

Terminer par les deux lignes d'attribution.

---

## Tâche 6 : la page `/carte`

**Fichiers :**
- Créer : `apps/web/src/lib/carte-couleurs.ts`, `apps/web/src/components/carte.tsx`, `apps/web/src/app/carte/page.tsx`
- Modifier : `apps/web/src/app/layout.tsx`, `apps/web/package.json`
- Test : `apps/web/tests/carte-couleurs.test.ts`

- [ ] **Étape 1 : installer Leaflet**

```sh
pnpm --filter @poligraph/web add leaflet
pnpm --filter @poligraph/web add -D @types/leaflet
```

`react-leaflet` n'est **pas** nécessaire : la carte se monte dans un `useEffect`
sur un conteneur, ce qui évite une dépendance de plus et le couplage de
versions entre React et son adaptateur.

- [ ] **Étape 2 : écrire les tests des fonctions pures**

Créer `apps/web/tests/carte-couleurs.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { couleurDeGroupe, groupeMajoritaire } from '@/lib/carte-couleurs'

describe('couleurDeGroupe', () => {
  it('reprend la couleur publiée par l’Assemblée quand elle existe', () => {
    expect(couleurDeGroupe('#123456')).toBe('#123456')
  })

  it('rend une teinte neutre plutôt que d’en inventer une quand elle manque', () => {
    expect(couleurDeGroupe(null)).toBe('#d6d3d1')
    expect(couleurDeGroupe(undefined)).toBe('#d6d3d1')
  })
})

describe('groupeMajoritaire', () => {
  it('rend le groupe le plus représenté du département', () => {
    expect(groupeMajoritaire([{ id: 'a' }, { id: 'a' }, { id: 'b' }])).toBe('a')
  })

  it('rend null sur une égalité plutôt que de trancher arbitrairement', () => {
    expect(groupeMajoritaire([{ id: 'a' }, { id: 'b' }])).toBeNull()
  })

  it('rend null quand le département n’a aucun député rattaché', () => {
    expect(groupeMajoritaire([])).toBeNull()
  })
})
```

L'égalité rendant `null` est un choix : colorier un département par un groupe
tiré au sort parmi deux à égalité afficherait une information fausse.

- [ ] **Étape 3 : lancer, constater l'échec, implémenter**

```sh
pnpm --filter @poligraph/web exec vitest run tests/carte-couleurs.test.ts
```

Attendu : ÉCHEC, puis SUCCÈS après implémentation de
`apps/web/src/lib/carte-couleurs.ts`.

- [ ] **Étape 4 : la page et le composant**

`apps/web/src/app/carte/page.tsx` est rendue **par le serveur** : elle charge
la liste des députés via `graphqlFetch` (le client serveur existant), calcule
la correspondance circonscription → député, et passe le tout au composant
client. Elle rend aussi, en HTML statique :

- le titre et l'explication de ce que montre la carte
- **la liste nommée des 18 députés sans contour**, avec un lien vers chaque
  fiche, sous un titre explicite
- la ligne de provenance de la source géographique, au même format que les
  autres sections du site

Ces trois éléments sont dans le HTML initial, donc lisibles sans JavaScript.
C'est la leçon de la tâche 5 du plan p7 : le contenu qui peut être rendu par
le serveur doit l'être.

`apps/web/src/components/carte.tsx` porte `'use client'` et :

- charge `/geo/circonscriptions.json` par `fetch`
- monte Leaflet dans un `useEffect`, avec les tuiles OSM et leur attribution
- colorie chaque circonscription par le groupe de son député
- au-dessus d'un seuil de zoom **nommé et unique** (`SEUIL_CIRCONSCRIPTIONS`),
  affiche les frontières internes et la couleur propre à chaque
  circonscription ; en dessous, masque ces frontières et colorie par le groupe
  majoritaire du département
- infobulle au survol : nom du député, groupe, circonscription
- clic : navigation vers la fiche
- **un `<noscript>` et un état d'erreur nommé**, comme `vote-history.tsx` :
  un « Chargement de la carte… » ne doit jamais être un état terminal

- [ ] **Étape 5 : le lien dans la barre de navigation**

Dans `apps/web/src/app/layout.tsx`, après le lien « Députés » :

```tsx
            <Link href="/carte" className="text-sm text-stone-600 hover:text-stone-900">
              Carte
            </Link>
```

- [ ] **Étape 6 : vérifier sur la stack réelle**

```sh
curl -s http://127.0.0.1:30000/carte -o /dev/null -w "%{http_code}\n"
curl -s http://127.0.0.1:30000/deputes | grep -c 'href="/carte"'
curl -s -o /dev/null -w "%{size_download} octets\n" http://127.0.0.1:30000/geo/circonscriptions.json
```

Attendu : `200`, `1`, et la taille de l'asset.

Vérifier aussi, dans le HTML servi, que les 18 députés sans contour sont
nommés et que la ligne de provenance est présente — **sans JavaScript**, donc
directement dans la réponse `curl`.

- [ ] **Étape 7 : committer**

```sh
git add apps/web/src/lib/carte-couleurs.ts apps/web/src/components/carte.tsx \
        apps/web/src/app/carte/page.tsx apps/web/src/app/layout.tsx \
        apps/web/package.json apps/web/tests/carte-couleurs.test.ts pnpm-lock.yaml
git commit -m "feat(web): carte des circonscriptions, et les 18 députés qu'elle ne peut pas situer"
```

Terminer par les deux lignes d'attribution.

---

## Vérification finale

- [ ] `pnpm typecheck:seq` et `pnpm build:seq` à la racine.
- [ ] `pnpm test:seq` intégralement. Rappel : base de test partagée,
      `fileParallelism` désactivé dans `packages/ingestion`, attendre
      `pg_isready` après tout redémarrage du conteneur.
- [ ] Sur la stack réelle, ouvrir `/carte` dans un navigateur : vérifier que
      les circonscriptions apparaissent, que le survol nomme le bon député, et
      que le clic mène à sa fiche.
- [ ] Vérifier que le zoom bascule bien entre les deux niveaux, et que le
      seuil est une constante unique et non une valeur dispersée.
- [ ] Vérifier qu'aucune page ne rend `undefined`, `null` ou `NaN` dans le
      texte visible, hors charge utile RSC des balises `<script>`.
- [ ] Vérifier que la page reste honnête sans JavaScript : la liste des 18 et
      la provenance doivent être lisibles, et rien ne doit prétendre charger
      indéfiniment.
- [ ] Consigner dans ce plan les chiffres réels observés — couverture, taille
      de l'asset — et committer.
