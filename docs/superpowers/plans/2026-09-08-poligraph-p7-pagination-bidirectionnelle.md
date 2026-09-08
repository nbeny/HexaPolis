# Pagination bidirectionnelle — plan d'implémentation

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE — utiliser
> superpowers:subagent-driven-development (recommandé) ou
> superpowers:executing-plans pour exécuter ce plan tâche par tâche. Les
> étapes sont des cases à cocher (`- [ ]`).

**But :** rendre atteignable la donnée paginée que l'interface affiche
aujourd'hui sans permettre d'y accéder — au premier chef les 2 493 positions
de vote invisibles sur les 2 518 d'un député.

**Architecture :** `cursor.ts` encode un offset, pas une clé de tri. Le retour
arrière est donc de l'arithmétique, pas une requête inversée. On ajoute deux
champs à `PageInfo`, un argument `before` aux deux résolveurs paginés, et on
extrait la fabrication des connexions — aujourd'hui recopiée à l'identique
dans `deputy.resolver.ts` — dans une fonction unique. Le front gagne un bouton
« Précédent » sur `/deputes`, et l'historique de vote de la fiche devient un
composant client qui interroge l'API depuis le navigateur.

**Pile :** NestJS 11 (code-first GraphQL), Apollo, Prisma 6, Next.js 15,
vitest 2, pnpm 10.

**Spec :** `docs/superpowers/specs/2026-09-08-poligraph-pagination-et-carte-design.md`

**Portée :** ce plan couvre les §3 (pagination), §5 (accès client) et la
part du §6 qui s'y rapporte. Le §4 — la carte des circonscriptions — fait
l'objet d'un second plan, qui s'appuie sur la tâche 3 de celui-ci.

**Attention, deux pièges de ce dépôt :**

1. `turbo.exe` est bloqué par Smart App Control sur la machine de
   développement. Utiliser les variantes `pnpm test:seq` / `build:seq` /
   `typecheck:seq`, jamais `pnpm test`.
2. `apps/api/schema.gql` est réécrit par NestJS à chaque démarrage du module,
   donc à chaque exécution des tests de `@poligraph/api`. Toute modification
   de résolveur oblige à relancer les tests **puis à committer le
   `schema.gql` régénéré**, sinon `schema-snapshot.test.ts` échoue.

---

## Structure des fichiers

| Fichier | Responsabilité | Action |
| --- | --- | --- |
| `apps/api/src/graphql/common/connection.ts` | `PageInfo`, types d'arêtes, et désormais la fabrication d'une connexion | Modifier |
| `apps/api/src/graphql/common/cursor.ts` | encodage/décodage d'offset, et résolution d'un offset depuis `after`/`before` | Modifier |
| `apps/api/src/graphql/resolvers/deputy.resolver.ts` | résolveurs ; perd ses deux copies de fabrication de connexion | Modifier |
| `apps/api/src/graphql/cors.ts` | origines CORS autorisées, lues dans l'environnement | Créer |
| `apps/api/src/server.ts` | démarrage du serveur ; branche le CORS | Modifier |
| `apps/api/schema.gql` | SDL régénéré | Régénéré |
| `apps/web/src/lib/deputies-params.ts` | paramètres d'URL de la liste | Modifier |
| `apps/web/src/lib/graphql-fetch-client.ts` | jumeau navigateur de `graphql-fetch.ts` | Créer |
| `apps/web/src/components/vote-history.tsx` | historique de vote paginé, composant client | Créer |
| `apps/web/src/components/vote-row.tsx` | rendu d'une position de vote, extrait de `voting-section.tsx` | Créer |
| `apps/web/src/lib/queries.ts` | requêtes GraphQL du front | Modifier |
| `apps/web/src/app/deputes/page.tsx` | liste ; navigation à trois liens | Modifier |
| `apps/web/src/components/sections/voting-section.tsx` | section votes ; délègue la liste au nouveau composant | Modifier |

---

## Tâche 1 : `buildConnection`, et les deux nouveaux champs de `PageInfo`

**Fichiers :**
- Modifier : `apps/api/src/graphql/common/connection.ts`
- Modifier : `apps/api/src/graphql/resolvers/deputy.resolver.ts:88-110` et `:171-191`
- Test : `apps/api/tests/pagination.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter à la fin de `apps/api/tests/pagination.test.ts` :

```ts
const QUERY_PAGE_INFO = `
  query($slug: String!, $first: Int, $after: String) {
    deputy(slug: $slug) {
      ballotPositions(first: $first, after: $after) {
        totalCount
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges { cursor }
      }
    }
  }
`

/** Alice a 4 positions ; `first: 1` donne donc quatre pages d'une ligne. */
async function pageOf(after?: string) {
  const { body } = await testApp.graphql(QUERY_PAGE_INFO, {
    slug: fixture.alice.slug,
    first: 1,
    ...(after !== undefined && { after }),
  })
  expect(body.errors).toBeUndefined()
  return (body.data as any).deputy.ballotPositions
}

describe('PageInfo — les bornes des deux côtés', () => {
  it("n'annonce aucune page précédente sur la première page", async () => {
    const page = await pageOf()
    expect(page.pageInfo.hasPreviousPage).toBe(false)
    expect(page.pageInfo.hasNextPage).toBe(true)
    expect(page.pageInfo.startCursor).toBeTruthy()
  })

  it('annonce une page précédente ET une suivante au milieu', async () => {
    const page2 = await pageOf((await pageOf()).pageInfo.endCursor)
    expect(page2.pageInfo.hasPreviousPage).toBe(true)
    expect(page2.pageInfo.hasNextPage).toBe(true)
  })

  it("annonce une page précédente mais aucune suivante sur la dernière page", async () => {
    let page = await pageOf()
    while (page.pageInfo.hasNextPage) page = await pageOf(page.pageInfo.endCursor)
    expect(page.pageInfo.hasPreviousPage).toBe(true)
    expect(page.pageInfo.hasNextPage).toBe(false)
  })

  it("chaîne les pages : le startCursor d'une page est l'endCursor de la précédente", async () => {
    const page1 = await pageOf()
    const page2 = await pageOf(page1.pageInfo.endCursor)
    expect(page2.pageInfo.startCursor).toBe(page1.pageInfo.endCursor)
  })
})
```

- [ ] **Étape 2 : lancer le test, constater l'échec**

```sh
pnpm --filter @poligraph/api exec vitest run tests/pagination.test.ts
```

Attendu : ÉCHEC. GraphQL rejette la requête avec
`Cannot query field "startCursor" on type "PageInfo"`.

- [ ] **Étape 3 : ajouter les champs et la fabrique**

Dans `apps/api/src/graphql/common/connection.ts`, remplacer la classe
`PageInfo` et ajouter `buildConnection` juste après l'interface `Connection` :

```ts
import { encodeCursor } from './cursor.js'

@ObjectType()
export class PageInfo {
  /** Position AVANT le premier élément de la page. Symétrique de `endCursor`. */
  @Field({ nullable: true })
  startCursor?: string

  @Field({ nullable: true })
  endCursor?: string

  @Field()
  hasNextPage!: boolean

  @Field()
  hasPreviousPage!: boolean
}
```

```ts
/**
 * Fabrique la connexion Relay d'une page déjà lue.
 *
 * Ce calcul était recopié à l'identique dans les deux résolveurs paginés de
 * `deputy.resolver.ts`. Le centraliser n'est pas une coquetterie : c'est la
 * seule façon d'avoir la garantie que `deputies` et `ballotPositions`
 * répondent la même chose sur les bornes, aujourd'hui et après le prochain
 * champ ajouté à `PageInfo`.
 *
 * Le curseur d'une arête vaut `offset + index + 1`, c'est-à-dire la position
 * APRÈS l'élément — d'où `startCursor = encodeCursor(offset)`, qui désigne la
 * position avant le premier, et l'égalité `startCursor(page n+1) ===
 * endCursor(page n)`.
 */
export function buildConnection<TRow, TNode>(
  rows: readonly TRow[],
  offset: number,
  totalCount: number,
  toNode: (row: TRow) => TNode,
): Connection<TNode> {
  const edges = rows.map((row, index) => ({
    cursor: encodeCursor(offset + index + 1),
    node: toNode(row),
  }))

  return {
    edges,
    pageInfo: {
      startCursor: encodeCursor(offset),
      endCursor: edges.at(-1)?.cursor,
      hasNextPage: offset + rows.length < totalCount,
      hasPreviousPage: offset > 0,
    },
    totalCount,
  }
}
```

- [ ] **Étape 4 : faire appeler la fabrique par les deux résolveurs**

Dans `apps/api/src/graphql/resolvers/deputy.resolver.ts`, remplacer l'import :

```ts
import { buildConnection } from '../common/connection.js'
```

Dans `deputies`, remplacer le bloc qui va de `const edges = rows.map(` jusqu'à
la fin du `return` par :

```ts
    return buildConnection(rows, offset, totalCount, cardToDeputy)
```

Dans `ballotPositions`, remplacer le bloc équivalent par :

```ts
    return buildConnection(rows, offset, totalCount, voteToBallotPosition)
```

`encodeCursor` n'est plus utilisé dans ce fichier : le retirer de l'import de
`../common/cursor.js`, qui ne garde que `decodeCursor`.

- [ ] **Étape 5 : relancer, puis régénérer le SDL**

```sh
pnpm --filter @poligraph/api exec vitest run tests/pagination.test.ts
```

Attendu : SUCCÈS, 4 nouveaux tests verts.

Le démarrage du module vient de réécrire `apps/api/schema.gql`. Vérifier que
les deux champs y sont :

```sh
git diff apps/api/schema.gql
```

Attendu : `startCursor: String` et `hasPreviousPage: Boolean!` ajoutés dans
`type PageInfo` (l'ordre est alphabétique, `sortSchema: true`).

```sh
pnpm --filter @poligraph/api exec vitest run
```

Attendu : SUCCÈS sur les 9 fichiers, `schema-snapshot.test.ts` compris.

- [ ] **Étape 6 : committer**

```sh
git add apps/api/src/graphql/common/connection.ts \
        apps/api/src/graphql/resolvers/deputy.resolver.ts \
        apps/api/schema.gql apps/api/tests/pagination.test.ts
git commit -m "feat(api): PageInfo annonce la page précédente et son curseur de début"
```

---

## Tâche 2 : l'argument `before`

**Fichiers :**
- Modifier : `apps/api/src/graphql/common/cursor.ts`
- Modifier : `apps/api/src/graphql/resolvers/deputy.resolver.ts`
- Test : `apps/api/tests/cursor.test.ts` et `apps/api/tests/pagination.test.ts`

- [ ] **Étape 1 : écrire les tests unitaires qui échouent**

Ajouter à la fin de `apps/api/tests/cursor.test.ts` :

```ts
import { resolveOffset } from '../src/graphql/common/cursor.js'

describe('resolveOffset', () => {
  it('part de zéro quand aucun curseur n’est fourni', () => {
    expect(resolveOffset(undefined, undefined, 25)).toBe(0)
  })

  it('avance à la position du curseur `after`', () => {
    expect(resolveOffset(encodeCursor(50), undefined, 25)).toBe(50)
  })

  it('recule d’une page complète depuis `before`', () => {
    expect(resolveOffset(undefined, encodeCursor(50), 25)).toBe(25)
  })

  it('borne le recul à zéro plutôt que de produire un offset négatif', () => {
    expect(resolveOffset(undefined, encodeCursor(10), 25)).toBe(0)
  })

  it('refuse `after` et `before` ensemble : la page demandée serait ambiguë', () => {
    expect(() => resolveOffset(encodeCursor(10), encodeCursor(50), 25)).toThrow(
      /ensemble/,
    )
  })
})
```

- [ ] **Étape 2 : lancer, constater l'échec**

```sh
pnpm --filter @poligraph/api exec vitest run tests/cursor.test.ts
```

Attendu : ÉCHEC à la compilation —
`"resolveOffset" is not exported by src/graphql/common/cursor.ts`.

- [ ] **Étape 3 : implémenter `resolveOffset`**

Ajouter à la fin de `apps/api/src/graphql/common/cursor.ts` :

```ts
/**
 * Traduit une demande de page en offset de départ.
 *
 * Il n'y a délibérément pas d'argument `last` en pendant de `first` : sur des
 * curseurs-offsets, reculer d'une page se calcule à partir de la taille de
 * page déjà demandée. Ajouter `last` doublerait les chemins à tester sans
 * rien exprimer de plus.
 *
 * `before` est borné à zéro. Un curseur forgé pointant avant le début ne rend
 * donc jamais de page vide : il rend la première page, ce qui est la réponse
 * honnête à « la page qui précède le début ».
 */
export function resolveOffset(
  after: string | null | undefined,
  before: string | null | undefined,
  pageSize: number,
): number {
  if (after != null && before != null) {
    throw new Error(
      'Les curseurs `after` et `before` ne peuvent pas être fournis ensemble : la page demandée serait ambiguë.',
    )
  }
  if (after != null) return decodeCursor(after)
  if (before != null) return Math.max(0, decodeCursor(before) - pageSize)
  return 0
}
```

- [ ] **Étape 4 : relancer les tests unitaires**

```sh
pnpm --filter @poligraph/api exec vitest run tests/cursor.test.ts
```

Attendu : SUCCÈS.

- [ ] **Étape 5 : écrire le test d'intégration qui échoue**

Ajouter à la fin de `apps/api/tests/pagination.test.ts` :

```ts
const QUERY_BEFORE = `
  query($slug: String!, $first: Int, $after: String, $before: String) {
    deputy(slug: $slug) {
      ballotPositions(first: $first, after: $after, before: $before) {
        pageInfo { startCursor endCursor hasPreviousPage }
        edges { cursor node { ballotTitle } }
      }
    }
  }
`

describe('Deputy.ballotPositions — retour arrière', () => {
  it('« Précédent » depuis la page 2 rend exactement la page 1', async () => {
    const page1 = await pageOf()
    const page2 = await pageOf(page1.pageInfo.endCursor)

    const { body } = await testApp.graphql(QUERY_BEFORE, {
      slug: fixture.alice.slug,
      first: 1,
      before: page2.pageInfo.startCursor,
    })
    expect(body.errors).toBeUndefined()
    const back = (body.data as any).deputy.ballotPositions

    expect(back.edges.map((e: any) => e.cursor)).toEqual(
      page1.edges.map((e: any) => e.cursor),
    )
    expect(back.pageInfo.hasPreviousPage).toBe(false)
  })

  it('rejette `after` et `before` fournis ensemble', async () => {
    const page1 = await pageOf()
    const { body } = await testApp.graphql(QUERY_BEFORE, {
      slug: fixture.alice.slug,
      first: 1,
      after: page1.pageInfo.endCursor,
      before: page1.pageInfo.endCursor,
    })
    expect(body.errors?.[0]?.message).toMatch(/ensemble/)
  })
})
```

- [ ] **Étape 6 : brancher `before` sur les deux résolveurs**

Dans `apps/api/src/graphql/resolvers/deputy.resolver.ts`, remplacer l'import
de `cursor.js` par :

```ts
import { resolveOffset } from '../common/cursor.js'
```

Dans `deputies`, ajouter l'argument après `after` :

```ts
    @Args('before', { type: () => String, nullable: true }) before: string | null | undefined,
```

et remplacer les deux lignes `const afterValue = …` / `const offset = …` par :

```ts
    const limit = clampPageSize(optionalArg(first))
    const offset = resolveOffset(optionalArg(after), optionalArg(before), limit)
```

Appliquer exactement la même modification à `ballotPositions`.

- [ ] **Étape 7 : relancer toute la suite api et régénérer le SDL**

```sh
pnpm --filter @poligraph/api exec vitest run
```

Attendu : SUCCÈS. `schema.gql` porte désormais `before: String` sur
`deputies` et sur `Deputy.ballotPositions`.

- [ ] **Étape 8 : committer**

```sh
git add apps/api/src/graphql/common/cursor.ts \
        apps/api/src/graphql/resolvers/deputy.resolver.ts \
        apps/api/schema.gql apps/api/tests/cursor.test.ts apps/api/tests/pagination.test.ts
git commit -m "feat(api): argument before sur les deux connexions paginées"
```

---

## Tâche 3 : CORS et accès à l'API depuis le navigateur

**Fichiers :**
- Créer : `apps/api/src/graphql/cors.ts`
- Créer : `apps/api/tests/cors.test.ts`
- Modifier : `apps/api/src/server.ts`
- Modifier : `docker-compose.yml`, `.env.example`

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `apps/api/tests/cors.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { corsOrigins } from '../src/graphql/cors.js'

describe('corsOrigins', () => {
  it("n'autorise aucune origine quand la variable est absente", () => {
    expect(corsOrigins({})).toEqual([])
  })

  it('lit une liste séparée par des virgules et retire les espaces', () => {
    expect(corsOrigins({ CORS_ALLOWED_ORIGINS: 'http://a.test, http://b.test' })).toEqual([
      'http://a.test',
      'http://b.test',
    ])
  })

  it('ignore les entrées vides plutôt que d’autoriser la chaîne vide', () => {
    expect(corsOrigins({ CORS_ALLOWED_ORIGINS: 'http://a.test,,  ' })).toEqual([
      'http://a.test',
    ])
  })

  it("n'accepte jamais le joker, même écrit explicitement", () => {
    expect(() => corsOrigins({ CORS_ALLOWED_ORIGINS: '*' })).toThrow(/joker/)
  })
})
```

- [ ] **Étape 2 : lancer, constater l'échec**

```sh
pnpm --filter @poligraph/api exec vitest run tests/cors.test.ts
```

Attendu : ÉCHEC — le module `../src/graphql/cors.js` n'existe pas.

- [ ] **Étape 3 : implémenter**

Créer `apps/api/src/graphql/cors.ts` :

```ts
/**
 * Origines autorisées à interroger l'API depuis un navigateur.
 *
 * Jusqu'ici l'API n'était jointe que par le réseau interne, par le serveur
 * Next. La carte et l'historique de vote paginé l'appellent depuis le
 * navigateur : il faut donc du CORS, et une liste explicite plutôt qu'un
 * joker. Une API publique en lecture n'a pas besoin d'être appelable depuis
 * n'importe quelle page du web, et `*` interdit de toute façon d'envoyer un
 * jour des cookies.
 *
 * Le défaut est la liste vide — aucune origine — plutôt qu'une valeur
 * permissive : une variable oubliée en production doit casser la carte, pas
 * ouvrir l'API.
 */
export function corsOrigins(env: Record<string, string | undefined>): string[] {
  const raw = env.CORS_ALLOWED_ORIGINS
  if (raw === undefined) return []
  if (raw.includes('*')) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS ne peut pas contenir de joker : lister les origines une par une.',
    )
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '')
}
```

- [ ] **Étape 4 : relancer**

```sh
pnpm --filter @poligraph/api exec vitest run tests/cors.test.ts
```

Attendu : SUCCÈS, 4 tests.

- [ ] **Étape 5 : brancher sur le serveur**

Dans `apps/api/src/server.ts`, ajouter l'import puis l'appel entre
`NestFactory.create` et `app.listen` :

```ts
import { corsOrigins } from './graphql/cors.js'
```

```ts
  const origins = corsOrigins(process.env)
  if (origins.length > 0) app.enableCors({ origin: origins })
```

- [ ] **Étape 6 : déclarer la variable dans la stack**

Dans `.env.example`, ajouter :

```
CORS_ALLOWED_ORIGINS="http://localhost:30000"
NEXT_PUBLIC_POLIGRAPH_API_URL="http://localhost:30001/graphql"
```

Dans `docker-compose.yml`, service `api`, ajouter à `environment` :

```yaml
      CORS_ALLOWED_ORIGINS: http://localhost:30000
```

et au service `web` :

```yaml
      NEXT_PUBLIC_POLIGRAPH_API_URL: http://localhost:30001/graphql
```

`POLIGRAPH_API_URL` reste inchangée : les trois pages serveur continuent de
passer par le réseau interne.

- [ ] **Étape 7 : vérifier sur la stack réelle**

```sh
docker compose up -d --build
curl -s -i -X POST http://127.0.0.1:30001/graphql \
  -H 'content-type: application/json' -H 'origin: http://localhost:30000' \
  -d '{"query":"{ deputies(first:1){ totalCount } }"}' | grep -i access-control-allow-origin
```

Attendu : `access-control-allow-origin: http://localhost:30000`.

- [ ] **Étape 8 : committer**

```sh
git add apps/api/src/graphql/cors.ts apps/api/src/server.ts apps/api/tests/cors.test.ts \
        docker-compose.yml .env.example
git commit -m "feat(api): CORS sur une liste d'origines explicite"
```

---

## Tâche 4 : `/deputes` gagne le retour arrière

**Fichiers :**
- Modifier : `apps/web/src/lib/deputies-params.ts`
- Modifier : `apps/web/src/app/deputes/page.tsx`
- Test : `apps/web/tests/deputies-params.test.ts`

- [ ] **Étape 1 : écrire les tests qui échouent**

Ajouter à `apps/web/tests/deputies-params.test.ts` :

```ts
describe('before', () => {
  it('lit le curseur de retour dans la query string', () => {
    expect(readListParams({ before: 'Y3Vyc2V1cg==' }).before).toBe('Y3Vyc2V1cg==')
  })

  it('rend null quand il est absent', () => {
    expect(readListParams({}).before).toBeNull()
  })

  it('sérialise `before` dans le lien, en conservant les filtres actifs', () => {
    const params = readListParams({ departmentCode: '33', after: 'QUZURVI=' })
    expect(buildListHref(params, { after: null, before: 'QkVGT1JF' })).toBe(
      '/deputes?departmentCode=33&before=QkVGT1JF',
    )
  })

  it("n'émet jamais `after` et `before` ensemble : l'API les refuse", () => {
    const params = readListParams({ after: 'QUZURVI=' })
    const href = buildListHref(params, { before: 'QkVGT1JF' })
    expect(href).not.toContain('after=')
    expect(href).toContain('before=QkVGT1JF')
  })
})
```

- [ ] **Étape 2 : lancer, constater l'échec**

```sh
pnpm --filter @poligraph/web exec vitest run tests/deputies-params.test.ts
```

Attendu : ÉCHEC — `Property 'before' does not exist on type 'DeputyListParams'`.

- [ ] **Étape 3 : implémenter**

Dans `apps/web/src/lib/deputies-params.ts`, ajouter le champ à l'interface :

```ts
  /** Curseur opaque rendu par `pageInfo.startCursor`, pour reculer d'une page. */
  before: string | null
```

Le lire dans `readListParams`, à côté de `after` :

```ts
    before: readOne(searchParams.before),
```

Et dans `buildListHref`, remplacer la sérialisation du curseur par :

```ts
  // `after` et `before` s'excluent : l'API rejette les deux ensemble. Un
  // `before` demandé chasse donc l'`after` hérité des paramètres courants,
  // plutôt que de produire une URL que l'API refusera.
  if (overrides.before != null) {
    query.set('before', overrides.before)
  } else if (merged.after !== null) {
    query.set('after', merged.after)
  } else if (merged.before !== null) {
    query.set('before', merged.before)
  }
```

en retirant la ligne `if (merged.after !== null) query.set('after', merged.after)`.

- [ ] **Étape 4 : relancer**

```sh
pnpm --filter @poligraph/web exec vitest run tests/deputies-params.test.ts
```

Attendu : SUCCÈS.

- [ ] **Étape 5 : ajouter le lien dans la page**

Dans `apps/web/src/app/deputes/page.tsx`, après le calcul de `nextHref`,
ajouter :

```tsx
  const previousHref =
    connection.pageInfo.hasPreviousPage && connection.pageInfo.startCursor !== null
      ? buildListHref(params, { after: null, before: connection.pageInfo.startCursor })
      : null
```

Ajouter `before: params.before` à `listVariables` (la fonction qui bâtit les
variables GraphQL de `loadDeputies`), et `before` à la requête
`DEPUTIES_QUERY` de `apps/web/src/lib/queries.ts` :

```graphql
  query Deputies($legislature: Int, $groupId: ID, $departmentCode: String, $first: Int, $after: String, $before: String) {
    deputies(
      legislature: $legislature
      groupId: $groupId
      departmentCode: $departmentCode
      first: $first
      after: $after
      before: $before
    ) {
```

et demander les nouveaux champs de `pageInfo` :

```graphql
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
```

Remplacer la condition d'affichage de la `<nav>` et son contenu :

```tsx
      {(nextHref || previousHref || firstPageHref) && (
        <nav className="mt-6 flex items-center justify-between text-sm">
          {/*
            Pagination par liens, pas par défilement infini : un lien porte
            son état dans l'URL, se met en favori et survit au bouton retour.
          */}
          <span>
            {previousHref && (
              <Link href={previousHref} className="text-stone-600 underline underline-offset-2">
                ← Page précédente
              </Link>
            )}
          </span>
          <span>
            {firstPageHref && (
              <Link href={firstPageHref} className="text-stone-600 underline underline-offset-2">
                Première page
              </Link>
            )}
          </span>
          <span>
            {nextHref && (
              <Link href={nextHref} className="text-stone-600 underline underline-offset-2">
                Page suivante →
              </Link>
            )}
          </span>
        </nav>
      )}
```

- [ ] **Étape 6 : régénérer les types GraphQL et vérifier**

```sh
pnpm --filter @poligraph/web run codegen
pnpm --filter @poligraph/web run typecheck
pnpm --filter @poligraph/web exec vitest run
```

Attendu : SUCCÈS aux trois.

- [ ] **Étape 7 : vérifier sur la stack réelle**

```sh
curl -s "http://127.0.0.1:30000/deputes" | grep -c "Page suivante"
```

Attendu : `1`. Puis suivre le lien de page suivante dans un navigateur et
vérifier que « ← Page précédente » ramène bien à la première page.

- [ ] **Étape 8 : committer**

```sh
git add apps/web/src/lib/deputies-params.ts apps/web/src/lib/queries.ts \
        apps/web/src/gql/generated.ts apps/web/src/app/deputes/page.tsx \
        apps/web/tests/deputies-params.test.ts
git commit -m "feat(web): retour arrière dans la pagination de la liste"
```

---

## Tâche 5 : l'historique de vote devient parcourable

**Fichiers :**
- Créer : `apps/web/src/lib/graphql-fetch-client.ts`
- Créer : `apps/web/src/components/vote-history.tsx`
- Modifier : `apps/web/src/components/sections/voting-section.tsx`
- Test : `apps/web/tests/graphql-fetch-client.test.ts`, `apps/web/tests/voting-section.test.tsx`

- [ ] **Étape 1 : écrire le test du client navigateur**

Créer `apps/web/tests/graphql-fetch-client.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphqlError, graphqlFetchClient } from '@/lib/graphql-fetch-client'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

describe('graphqlFetchClient', () => {
  it('rend les données quand la réponse est saine', async () => {
    stubFetch(200, { data: { ok: true } })
    await expect(graphqlFetchClient('{ ok }', {})).resolves.toEqual({ ok: true })
  })

  it('lève sur `errors`, même avec un statut 200 — c’est le défaut de GraphQL', async () => {
    stubFetch(200, { data: null, errors: [{ message: 'Curseur invalide' }] })
    await expect(graphqlFetchClient('{ ok }', {})).rejects.toThrow(GraphqlError)
  })

  it('lève sur un statut HTTP en échec', async () => {
    stubFetch(500, {})
    await expect(graphqlFetchClient('{ ok }', {})).rejects.toThrow(GraphqlError)
  })

  it('lève quand la réponse ne porte ni données ni erreurs', async () => {
    stubFetch(200, {})
    await expect(graphqlFetchClient('{ ok }', {})).rejects.toThrow(/mal configurée/)
  })
})
```

- [ ] **Étape 2 : lancer, constater l'échec**

```sh
pnpm --filter @poligraph/web exec vitest run tests/graphql-fetch-client.test.ts
```

Attendu : ÉCHEC — le module `@/lib/graphql-fetch-client` n'existe pas.

- [ ] **Étape 3 : implémenter le client navigateur**

Créer `apps/web/src/lib/graphql-fetch-client.ts` :

```ts
/**
 * Jumeau navigateur de `graphql-fetch.ts`.
 *
 * Deux différences, et deux seulement : l'URL vient de
 * `NEXT_PUBLIC_POLIGRAPH_API_URL` (le nom de service Docker du module serveur
 * n'est évidemment pas résoluble depuis un navigateur), et il n'y a pas
 * d'option `next.revalidate`, qui n'existe que côté serveur.
 *
 * Toute la valeur du module reste la même : GraphQL répond volontiers
 * `200 OK` avec `{ data: null, errors: [...] }`, et lire `body.data` sans
 * regarder `body.errors` transforme une panne en page vide.
 */
const ENDPOINT = process.env.NEXT_PUBLIC_POLIGRAPH_API_URL ?? 'http://127.0.0.1:30001/graphql'

interface GraphQLResponse<T> {
  data?: T | null
  errors?: { message: string; path?: (string | number)[] }[]
}

export class GraphqlError extends Error {}

export async function graphqlFetchClient<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new GraphqlError(
      `L'API PoliGraph a répondu ${response.status} (${ENDPOINT}) : ${await response.text()}`,
    )
  }

  const body = (await response.json()) as GraphQLResponse<T>

  if (body.errors?.length) {
    throw new GraphqlError(`Erreur GraphQL : ${body.errors.map((e) => e.message).join(' · ')}`)
  }

  if (body.data === undefined || body.data === null) {
    throw new GraphqlError(
      `Réponse GraphQL sans données ni erreurs — l'API est probablement mal configurée (${ENDPOINT}).`,
    )
  }

  return body.data
}
```

- [ ] **Étape 4 : relancer**

```sh
pnpm --filter @poligraph/web exec vitest run tests/graphql-fetch-client.test.ts
```

Attendu : SUCCÈS, 4 tests.

- [ ] **Étape 5 : écrire le test du composant**

Ajouter à `apps/web/tests/voting-section.test.tsx` :

```tsx
import { VoteHistory, pageLabel } from '@/components/vote-history'

describe('pageLabel', () => {
  it('décrit la tranche affichée, pas seulement son nombre', () => {
    expect(pageLabel(0, 25, 2518)).toBe('1-25 sur 2 518')
  })

  it('compte depuis la position réelle sur une page du milieu', () => {
    expect(pageLabel(50, 25, 2518)).toBe('51-75 sur 2 518')
  })

  it('ne dépasse jamais le total sur la dernière page', () => {
    expect(pageLabel(2500, 25, 2518)).toBe('2 501-2 518 sur 2 518')
  })

  it('reste lisible quand il n’y a rien à afficher', () => {
    expect(pageLabel(0, 25, 0)).toBe('aucune position de vote')
  })
})
```

- [ ] **Étape 6 : lancer, constater l'échec**

```sh
pnpm --filter @poligraph/web exec vitest run tests/voting-section.test.tsx
```

Attendu : ÉCHEC — `@/components/vote-history` n'existe pas.

- [ ] **Étape 7 : extraire le rendu d'une ligne**

Le rendu d'une position de vote vit aujourd'hui en ligne dans
`voting-section.tsx`, avec trois fonctions locales qui n'en servent qu'à lui :
`ballotUrl`, `formatDate` et `positionLabel`. Le composant client en a besoin ;
les laisser dans un composant serveur les rendrait inatteignables.

Créer `apps/web/src/components/vote-row.tsx` en y **déplaçant sans les
modifier** les trois fonctions depuis `voting-section.tsx`, puis en y ajoutant
le composant de ligne, repris tel quel du `map` existant :

```tsx
import type { VoteHistoryQuery } from '@/gql/generated'

export type VoteNode = NonNullable<
  VoteHistoryQuery['deputy']
>['ballotPositions']['edges'][number]['node']

export function VoteRow({ vote }: { vote: VoteNode }) {
  const url = ballotUrl(vote)
  const date = formatDate(vote.ballotDate)
  return (
    <li className="py-2">
      <p className="text-sm text-stone-900">
        {positionLabel(vote.position)}
        {vote.byDelegation ? ' (par délégation)' : ''}
        {vote.groupShortLabelAtVote
          ? ` — groupe ${vote.groupShortLabelAtVote} au moment du vote`
          : ''}
      </p>
      <p className="text-sm text-stone-600">
        {url ? (
          <a
            className="underline underline-offset-2 hover:text-stone-900"
            href={url}
            rel="noreferrer noopener"
            target="_blank"
          >
            {vote.ballotTitle ?? `Scrutin n° ${vote.ballotNumber}`}
          </a>
        ) : (
          (vote.ballotTitle ?? 'Intitulé du scrutin non publié')
        )}
        {date ? ` — ${date}` : ''}
      </p>
    </li>
  )
}
```

Retirer de `voting-section.tsx` les trois fonctions déplacées et le `map` qui
rendait les lignes.

- [ ] **Étape 8 : implémenter le composant client**

Créer `apps/web/src/components/vote-history.tsx`. C'est le premier composant
client du projet : il commence donc par `'use client'`.

```tsx
'use client'

import { useEffect, useState } from 'react'
import type { VoteHistoryQuery } from '@/gql/generated'
import { VoteRow } from '@/components/vote-row'
import { graphqlFetchClient } from '@/lib/graphql-fetch-client'
import { formatInteger } from '@/lib/format'

/** Même taille de page que la liste des députés : une seule valeur à retenir. */
const PAGE_SIZE = 25

/**
 * Décrit la tranche affichée plutôt que son seul cardinal. « 25 affichés sur
 * 2 518 » ne dit pas *lesquels* : sur une liste qu'on parcourt, la position
 * est l'information utile.
 */
export function pageLabel(offset: number, pageCount: number, totalCount: number): string {
  if (totalCount === 0) return 'aucune position de vote'
  // `formatInteger` rend `string | null` pour absorber les valeurs absentes
  // du domaine. Ici les trois valeurs sont des nombres, jamais nulles : le
  // repli explicite évite qu'une régression de signature fasse afficher
  // « null » à l'écran, ce que ce projet ne se permet nulle part.
  const n = (value: number) => formatInteger(value) ?? String(value)
  const from = offset + 1
  const to = Math.min(offset + pageCount, totalCount)
  return `${n(from)}-${n(to)} sur ${n(totalCount)}`
}
```

Ajouter la requête dans `apps/web/src/lib/queries.ts` — et non dans le
composant : c'est le fichier que `codegen.ts` scrute pour produire
`VoteHistoryQuery`.

```ts
export const VOTES_QUERY = /* GraphQL */ `
  query VoteHistory($slug: String!, $first: Int, $after: String, $before: String) {
    deputy(slug: $slug) {
      ballotPositions(first: $first, after: $after, before: $before) {
        totalCount
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges {
          node {
            id
            ballotDate
            ballotTitle
            ballotNumber
            legislatureNumber
            position
            byDelegation
            groupShortLabelAtVote
            publicationMode
          }
        }
      }
    }
  }
`
```

et l'importer dans le composant :

```tsx
import { VOTES_QUERY } from '@/lib/queries'
```

Puis compléter `vote-history.tsx`, à la suite de `pageLabel` :

```tsx
type Connection = NonNullable<VoteHistoryQuery['deputy']>['ballotPositions']

/**
 * Position courante dans la liste.
 *
 * `offset` est tenu ici plutôt que déduit du curseur : les curseurs sont
 * opaques par contrat, et le front n'a aucune raison de savoir qu'ils
 * encodent un entier. Avancer ajoute une page, reculer en retire une, et le
 * plancher à zéro reflète celui que l'API applique de son côté.
 */
type Page = { offset: number; after?: string; before?: string }

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; connection: Connection }

export function VoteHistory({ slug }: { slug: string }) {
  const [page, setPage] = useState<Page>({ offset: 0 })
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let abandonne = false
    setState({ status: 'loading' })

    const { offset: _offset, ...cursor } = page
    graphqlFetchClient<VoteHistoryQuery>(VOTES_QUERY, {
      slug,
      first: PAGE_SIZE,
      ...cursor,
    })
      .then((data) => {
        if (abandonne || !data.deputy) return
        setState({ status: 'ready', connection: data.deputy.ballotPositions })
      })
      .catch((error: unknown) => {
        if (abandonne) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })

    // Deux clics rapides sur « Suivant » lancent deux requêtes ; sans ce
    // drapeau, la plus lente écraserait la plus récente et la liste
    // afficherait une page que l'utilisateur a déjà quittée.
    return () => {
      abandonne = true
    }
  }, [slug, page])

  if (state.status === 'loading') {
    return <p className="mt-2 text-sm text-stone-600">Chargement des positions de vote…</p>
  }

  if (state.status === 'error') {
    return (
      <p className="mt-2 rounded border border-dashed border-stone-300 bg-stone-100/60 p-4 text-sm text-stone-700">
        Les positions de vote n&apos;ont pas pu être chargées : {state.message}
      </p>
    )
  }

  const { edges, pageInfo, totalCount } = state.connection

  if (totalCount === 0) {
    return (
      <p className="mt-2 text-sm text-stone-500 italic">
        Aucune position de vote n&apos;est rattachée à ce député, toutes législatures
        confondues.
      </p>
    )
  }

  return (
    <div>
      <ul className="mt-2 divide-y divide-stone-100">
        {edges.map((edge) => (
          <VoteRow key={edge.node.id} vote={edge.node} />
        ))}
      </ul>
      <nav className="mt-4 flex items-center justify-between text-sm">
        <button
          type="button"
          disabled={!pageInfo.hasPreviousPage}
          onClick={() =>
            setPage({
              offset: Math.max(0, page.offset - PAGE_SIZE),
              before: pageInfo.startCursor ?? undefined,
            })
          }
          className="text-stone-600 underline underline-offset-2 disabled:text-stone-400 disabled:no-underline"
        >
          ← Précédent
        </button>
        <span className="text-stone-600">
          {pageLabel(page.offset, edges.length, totalCount)}
        </span>
        <button
          type="button"
          disabled={!pageInfo.hasNextPage}
          onClick={() =>
            setPage({
              offset: page.offset + PAGE_SIZE,
              after: pageInfo.endCursor ?? undefined,
            })
          }
          className="text-stone-600 underline underline-offset-2 disabled:text-stone-400 disabled:no-underline"
        >
          Suivant →
        </button>
      </nav>
    </div>
  )
}
```

Dans `voting-section.tsx`, remplacer le titre et la liste par :

```tsx
      <h3 className="mt-5 text-sm font-medium text-stone-900">Scrutins</h3>
      <VoteHistory slug={slug} />
```

`voting-section.tsx` reçoit déjà le député ; lui passer `slug`. Retirer enfin
le bloc `ballotPositions(first: 25) { … }` de `DEPUTY_QUERY` dans
`apps/web/src/lib/queries.ts` : la fiche ne le charge plus côté serveur.

La synthèse de participation, elle, ne bouge pas — elle reste rendue par le
serveur, avec tout le texte qui l'explique.

- [ ] **Étape 9 : relancer tout le front**

```sh
pnpm --filter @poligraph/web run codegen
pnpm --filter @poligraph/web run typecheck
pnpm --filter @poligraph/web exec vitest run
```

Attendu : SUCCÈS aux trois.

- [ ] **Étape 10 : vérifier sur la stack réelle**

Ouvrir `http://localhost:30000/deputes/pa795176-nicolas-metzdorf`, dérouler
jusqu'aux votes, et vérifier que « Suivant → » avance, que « ← Précédent »
revient, et que la position affichée passe bien de `1-25 sur 2 518` à
`26-50 sur 2 518`.

- [ ] **Étape 11 : committer**

```sh
git add apps/web/src/lib/graphql-fetch-client.ts apps/web/src/components/vote-history.tsx \
        apps/web/src/components/sections/voting-section.tsx apps/web/src/lib/queries.ts \
        apps/web/src/gql/generated.ts apps/web/tests/
git commit -m "feat(web): historique de vote parcourable, 2518 positions au lieu de 25"
```

---

## Vérification finale

- [ ] `pnpm typecheck:seq` et `pnpm build:seq` à la racine, tous paquets confondus.
- [ ] `pnpm test:seq` intégralement. Rappel : la base de test est partagée, `fileParallelism` est désactivé dans `packages/ingestion`, et il faut attendre `pg_isready` après tout redémarrage du conteneur.
- [ ] Sur la stack réelle, parcourir l'historique de vote d'un député de bout en bout : première page, avancer trois fois, reculer trois fois, et vérifier qu'aucune position n'est vue deux fois ni sautée.
- [ ] Vérifier qu'un curseur forgé (`/deputes?before=Zm9v`) rend une erreur nommée et non une page blanche.
- [ ] Vérifier qu'aucune page ne rend `undefined`, `null` ou `NaN` à l'écran, hors charge utile RSC des balises `<script>`.
- [ ] Consigner dans ce plan les chiffres réels observés et committer.
