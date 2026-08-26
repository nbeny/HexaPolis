# PoliGraph — Front Next.js (plan 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre lisible par un humain ce que les plans 1 à 5 ont mis en base — une fiche de transparence par député, une liste filtrable, une recherche — sans jamais laisser confondre un fait publié par une source avec un chiffre calculé par PoliGraph.

**Architecture:** Next.js 15, App Router, React Server Components. Les pages interrogent le GraphQL **côté serveur**, avec `fetch`. Aucun client GraphQL n'est embarqué dans le navigateur : la fiche est une page de lecture, pas une application. Les types TypeScript sont générés depuis le schéma émis par NestJS, jamais écrits à la main.

**Tech Stack:** Next.js 15 · React 19 · TypeScript 5.7 · Tailwind CSS 4 · GraphQL Code Generator · Vitest + Testing Library

---

## Ce que ce plan n'est pas

Ce n'est pas un plan de design. L'interface doit être sobre, lisible et honnête ; elle n'a pas à être belle. Les efforts vont à trois endroits, et à ces trois-là seulement :

1. **L'absence est un état de premier rang.** Le financement d'un député de la 17e législature est presque toujours indisponible : la CNCCFP n'a publié que 2022. Une section vide qui n'explique pas pourquoi est un défaut, pas un manque de données.
2. **Le calculé se distingue du publié.** `votingSummary` porte `status: COMPUTED`. Ça doit se voir à l'écran, pas se deviner.
3. **Chaque section dit d'où elle vient.** Source et date d'import, à côté de la donnée, pas dans un pied de page global.

Tout le reste — animations, thème sombre, graphiques — est hors périmètre.

---

## Structure des fichiers

```
apps/api/
  schema.gql                          ← nouveau, généré et committé (Task 1)
apps/web/
  package.json  next.config.ts  tsconfig.json  vitest.config.ts
  codegen.ts                          ← configuration GraphQL Code Generator
  src/
    app/
      layout.tsx  globals.css
      page.tsx                        ← recherche
      deputes/page.tsx                ← liste filtrable
      deputes/[slug]/page.tsx         ← fiche
      not-found.tsx
    lib/
      graphql-fetch.ts                ← client serveur minimal
      queries.ts                      ← documents GraphQL (source de la codegen)
      format.ts                       ← dates, montants, pourcentages en français
    gql/generated.ts                  ← généré, committé
    components/
      section-card.tsx                ← titre + provenance + contenu
      absent.tsx                      ← « donnée non disponible » + lien officiel
      computed-badge.tsx              ← marqueur visuel du COMPUTED
      fact-list.tsx                   ← paires libellé/valeur
      group-chip.tsx                  ← pastille de groupe parlementaire
      sections/
        identity-section.tsx
        mandates-section.tsx
        bodies-section.tsx
        voting-section.tsx
        elections-section.tsx
        funding-section.tsx
  tests/
    graphql-fetch.test.ts  absent.test.tsx  computed-badge.test.tsx
    funding-section.test.tsx  voting-section.test.tsx  elections-section.test.tsx
    format.test.ts
```

---

## Task 1 : Émettre le schéma GraphQL sur disque

Aujourd'hui `ServerModule` déclare `autoSchemaFile: true` : le schéma n'existe qu'en mémoire. La codegen du front a besoin d'un fichier, et un schéma committé rend visible dans un diff toute modification du contrat d'API.

**Files:**
- Modify: `apps/api/src/server.module.ts`
- Create: `apps/api/schema.gql` (généré)
- Test: `apps/api/tests/schema-snapshot.test.ts`

- [ ] **Step 1 : Écrire le test d'abord**

Le test compare le schéma que produit le module au fichier committé. Il échoue dès qu'un résolveur change sans que le fichier soit régénéré — c'est tout son intérêt.

```ts
// apps/api/tests/schema-snapshot.test.ts
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Test } from '@nestjs/testing'
import { GraphQLSchemaHost } from '@nestjs/graphql'
import { printSchema } from 'graphql'
import { describe, expect, it } from 'vitest'
import { ServerModule } from '../src/server.module.js'
import { PRISMA_CLIENT } from '../src/graphql/prisma.provider.js'

const SCHEMA_PATH = fileURLToPath(new URL('../schema.gql', import.meta.url))

describe('schema.gql', () => {
  it('est à jour vis-à-vis des résolveurs', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ServerModule.forRoot()] })
      .overrideProvider(PRISMA_CLIENT)
      .useValue({})
      .compile()
    const app = moduleRef.createNestApplication()
    await app.init()

    const { schema } = app.get(GraphQLSchemaHost)
    const committed = await readFile(SCHEMA_PATH, 'utf-8')

    // Comparaison insensible aux fins de ligne : le dépôt est cloné sous
    // Windows comme sous Linux, et git peut réécrire les CRLF.
    expect(printSchema(schema).replace(/\r\n/g, '\n').trim()).toBe(
      committed.replace(/\r\n/g, '\n').trim(),
    )

    await app.close()
  })
})
```

Vérifiez le nom exact du jeton exporté par `apps/api/src/graphql/prisma.provider.ts` avant d'écrire l'import : les tests GraphQL existants dans `apps/api/tests/` substituent déjà ce provider, alignez-vous sur eux.

- [ ] **Step 2 : Lancer le test, constater l'échec**

`pnpm --filter @poligraph/api test schema-snapshot` — échoue, `schema.gql` n'existe pas.

- [ ] **Step 3 : Faire écrire le fichier par NestJS**

Dans `apps/api/src/server.module.ts`, remplacer `autoSchemaFile: true` par un chemin absolu, calculé depuis l'emplacement du module compilé. Attention : le code s'exécute depuis `dist/`, le fichier doit atterrir à la racine de `apps/api/`, pas dans `dist/`.

```ts
import { fileURLToPath } from 'node:url'
// ...
autoSchemaFile: fileURLToPath(new URL('../schema.gql', import.meta.url)),
sortSchema: true,
```

`sortSchema: true` est important : sans lui, l'ordre des types dépend de l'ordre de découverte des modules et le fichier bouge sans raison entre deux exécutions, ce qui rendrait le test capricieux.

Depuis `dist/server.module.js`, `../schema.gql` désigne `apps/api/schema.gql`. Vérifiez-le réellement plutôt que de le supposer — si `tsconfig.json` produit une arborescence `dist/src/...`, le chemin remonte d'un cran de plus.

- [ ] **Step 4 : Générer, relancer, committer**

Le fichier s'écrit au premier démarrage du module. Lancer le test le produit donc lui-même ; relancez-le une seconde fois pour qu'il passe sur un fichier stable.

```bash
pnpm --filter @poligraph/api test schema-snapshot
git add apps/api/schema.gql apps/api/src/server.module.ts apps/api/tests/schema-snapshot.test.ts
git commit -m "feat(api): emettre schema.gql sur disque et le verrouiller par un test"
```

Ouvrez `schema.gql` et lisez-le : c'est le contrat que le front va consommer. Si `Candidacy` n'y porte pas `votes`, `votePctExpressed` et `elected`, le plan 5 n'est pas terminé — signalez-le plutôt que de contourner.

---

## Task 2 : Échafauder `apps/web`

**Files:**
- Create: `apps/web/{package.json,next.config.ts,tsconfig.json,vitest.config.ts}`
- Create: `apps/web/src/app/{layout.tsx,globals.css,page.tsx}`
- Modify: `turbo.json`

- [ ] **Step 1 : Créer le paquet**

N'utilisez pas `create-next-app` : il crée son propre dépôt, son propre gestionnaire de paquets et un `.gitignore` concurrent. Écrivez les fichiers.

```json
// apps/web/package.json
{
  "name": "@poligraph/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3100",
    "build": "next build",
    "start": "next start --port 3100",
    "codegen": "graphql-codegen --config codegen.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@graphql-codegen/cli": "^5.0.3",
    "@graphql-codegen/typescript": "^4.1.2",
    "@graphql-codegen/typescript-operations": "^4.4.0",
    "@tailwindcss/postcss": "^4.0.0",
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Port 3100, pas 3000 : la machine de développement a déjà un service sur 3000, et l'API écoute sur 4000.

- [ ] **Step 2 : Configuration**

```ts
// apps/web/next.config.ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // Le front lit l'API par le réseau, pas par import : aucun paquet du
  // monorepo n'est transpilé ici. Si un jour `@poligraph/domain` est importé
  // pour partager un type, il faudra l'ajouter à `transpilePackages`.
}

export default config
```

```jsonc
// apps/web/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "incremental": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

```ts
// apps/web/vitest.config.ts
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
})
```

```ts
// apps/web/tests/setup.ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 3 : Tailwind 4 et la coquille de l'application**

Tailwind 4 se configure dans le CSS, pas dans un `tailwind.config.js`.

```css
/* apps/web/src/app/globals.css */
@import 'tailwindcss';
```

```ts
// apps/web/postcss.config.mjs
export default { plugins: { '@tailwindcss/postcss': {} } }
```

```tsx
// apps/web/src/app/layout.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'PoliGraph — transparence parlementaire',
  description:
    "Fiches de transparence des députés, bâties uniquement sur des données publiques officielles.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <header className="border-b border-stone-200 bg-white">
          <nav className="mx-auto flex max-w-4xl items-baseline gap-6 px-4 py-4">
            <Link href="/" className="text-lg font-semibold">
              PoliGraph
            </Link>
            <Link href="/deputes" className="text-sm text-stone-600 hover:text-stone-900">
              Députés
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-4xl px-4 py-8 text-xs text-stone-500">
          Données publiques : Assemblée nationale, ministère de l&apos;Intérieur, CNCCFP, RNE.
          PoliGraph ne produit aucune analyse : les chiffres calculés sont signalés comme tels.
        </footer>
      </body>
    </html>
  )
}
```

Une page d'accueil provisoire suffit à ce stade (`export default function Page() { return <p>PoliGraph</p> }`) ; la recherche arrive à la tâche 7.

- [ ] **Step 4 : Brancher sur Turborepo**

`turbo.json` déclare `build`, `test` et `typecheck`. Ajoutez la sortie de Next à la tâche `build` :

```jsonc
"build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**", "!.next/cache/**"] }
```

- [ ] **Step 5 : Installer, vérifier, committer**

```bash
pnpm install
pnpm --filter @poligraph/web build
git add apps/web turbo.json pnpm-lock.yaml
git commit -m "feat(web): echafauder l'application Next.js"
```

`pnpm --filter @poligraph/web build` doit réussir sans API démarrée : à ce stade aucune page ne l'interroge.

---

## Task 3 : Le client GraphQL serveur

Le point le plus sensible du front. Une erreur GraphQL renvoyée dans le corps d'une réponse HTTP 200 est le mode de défaillance silencieuse le plus courant de ce protocole : ignorer le tableau `errors` produit une page vide sans le moindre message.

**Files:**
- Create: `apps/web/src/lib/graphql-fetch.ts`
- Test: `apps/web/tests/graphql-fetch.test.ts`

- [ ] **Step 1 : Écrire les tests d'abord**

```ts
// apps/web/tests/graphql-fetch.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { graphqlFetch } from '@/lib/graphql-fetch'

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('graphqlFetch', () => {
  it('rend `data` quand la réponse est saine', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { data: { deputy: { displayName: 'Untel' } } }))
    const data = await graphqlFetch<{ deputy: { displayName: string } }>('query { deputy }', {})
    expect(data.deputy.displayName).toBe('Untel')
  })

  it('lève quand la réponse porte des erreurs GraphQL, même en HTTP 200', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, { data: null, errors: [{ message: 'Depth limit exceeded' }] }),
    )
    await expect(graphqlFetch('query { deputy }', {})).rejects.toThrow(/Depth limit exceeded/)
  })

  it('lève quand le transport échoue', async () => {
    vi.stubGlobal('fetch', mockFetch(502, { message: 'Bad Gateway' }))
    await expect(graphqlFetch('query { deputy }', {})).rejects.toThrow(/502/)
  })

  it("lève quand la réponse ne porte ni données ni erreurs", async () => {
    vi.stubGlobal('fetch', mockFetch(200, {}))
    await expect(graphqlFetch('query { deputy }', {})).rejects.toThrow()
  })
})
```

Le quatrième test compte autant que les autres : un corps `{}` est ce que renvoie un proxy mal configuré, et sans ce garde-fou la page rendrait « donnée non disponible » partout, ce qui est un mensonge — les données existent, c'est l'appel qui a échoué.

- [ ] **Step 2 : Lancer, constater l'échec**

`pnpm --filter @poligraph/web test graphql-fetch` — le module n'existe pas.

- [ ] **Step 3 : Implémenter**

```ts
// apps/web/src/lib/graphql-fetch.ts

/**
 * Client GraphQL minimal, destiné aux Server Components uniquement.
 *
 * Il n'y a délibérément pas de client GraphQL complet ici : les pages sont
 * rendues sur le serveur et ne re-requêtent jamais depuis le navigateur, donc
 * ni cache normalisé ni gestion d'état ne servent à quelque chose.
 *
 * Toute la valeur du module tient dans la gestion d'erreur. GraphQL répond
 * volontiers `200 OK` avec un corps `{ data: null, errors: [...] }` : lire
 * `body.data` sans regarder `body.errors` transforme une panne en page vide,
 * ce qui est exactement le défaut que ce projet ne peut pas se permettre.
 */

const ENDPOINT = process.env.POLIGRAPH_API_URL ?? 'http://127.0.0.1:4000/graphql'

interface GraphQLResponse<T> {
  data?: T | null
  errors?: { message: string; path?: (string | number)[] }[]
}

export interface GraphqlFetchOptions {
  /** Durée de validité du cache Next, en secondes. `0` désactive le cache. */
  revalidate?: number
}

export class GraphqlError extends Error {}

export async function graphqlFetch<T>(
  query: string,
  variables: Record<string, unknown>,
  options: GraphqlFetchOptions = {},
): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: options.revalidate ?? 300 },
  })

  if (!response.ok) {
    throw new GraphqlError(
      `L'API PoliGraph a répondu ${response.status} (${ENDPOINT}) : ${await response.text()}`,
    )
  }

  const body = (await response.json()) as GraphQLResponse<T>

  if (body.errors?.length) {
    throw new GraphqlError(
      `Erreur GraphQL : ${body.errors.map((e) => e.message).join(' · ')}`,
    )
  }

  if (body.data === undefined || body.data === null) {
    throw new GraphqlError(
      `Réponse GraphQL sans données ni erreurs — l'API est probablement mal configurée (${ENDPOINT}).`,
    )
  }

  return body.data
}
```

`127.0.0.1` et non `localhost`, ici comme partout dans ce dépôt : sous Node 18+, `localhost` se résout d'abord en `::1`, et la pile IPv6 de cette machine est instable sous charge. Ce détail a coûté plusieurs heures au plan 4.

- [ ] **Step 4 : Relancer les tests, committer**

```bash
pnpm --filter @poligraph/web test
git add apps/web/src/lib/graphql-fetch.ts apps/web/tests/graphql-fetch.test.ts
git commit -m "feat(web): client GraphQL serveur qui ne masque aucune erreur"
```

---

## Task 4 : Documents GraphQL et génération des types

**Files:**
- Create: `apps/web/src/lib/queries.ts`
- Create: `apps/web/codegen.ts`
- Create: `apps/web/src/gql/generated.ts` (généré, committé)

- [ ] **Step 1 : Écrire les documents**

Un seul fichier, des chaînes exportées. Pas de fichiers `.graphql` séparés : les requêtes sont peu nombreuses et les garder à côté de leur usage évite un aller-retour.

```ts
// apps/web/src/lib/queries.ts

/**
 * La fiche demande tout en une requête : six sections, un aller-retour.
 * Attention à la profondeur — l'API refuse au-delà de 12 niveaux et
 * plafonne la complexité à 2000 (voir `apps/api/src/server.module.ts`).
 * `ballotPositions` est donc borné à 25, la valeur par défaut de l'API.
 */
export const DEPUTY_QUERY = /* GraphQL */ `
  query Deputy($slug: String!) {
    deputy(slug: $slug) {
      id
      slug
      displayName
      firstName
      lastName
      civility
      birthDate
      constituencyCode
      constituencyLabel
      departmentCode
      currentGroupLabel
      currentGroupShortLabel
      currentGroupColor
      votingSummary {
        status
        mandateCount
        committeeCount
        voteCount
        participationBallotCount
        participationVoteCount
        participationRate
      }
      mandates {
        id
        kind
        institutionLabel
        legislatureNumber
        territoryCode
        territoryLabel
        startDate
        endDate
        endCause
      }
      groupMemberships {
        id
        bodyLabel
        bodyShortLabel
        bodyColor
        quality
        startDate
        endDate
      }
      committees {
        id
        bodyLabel
        quality
        startDate
        endDate
      }
      candidacies {
        id
        electionLabel
        electionYear
        round
        territoryCode
        territoryLabel
        nuance
        partyName
        votes
        votePctExpressed
        elected
        account {
          currency
          declaredExpenses
          declaredIncome
          declaredDonations
          personalFunds
          retainedExpenses
          retainedIncome
          decisionCode
        }
      }
      sources {
        sourceId
        label
        importedAt
      }
      ballotPositions(first: 25) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            id
            ballotId
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

export const DEPUTIES_QUERY = /* GraphQL */ `
  query Deputies($legislature: Int, $groupId: ID, $departmentCode: String, $first: Int, $after: String) {
    deputies(
      legislature: $legislature
      groupId: $groupId
      departmentCode: $departmentCode
      first: $first
      after: $after
    ) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          slug
          displayName
          constituencyCode
          constituencyLabel
          departmentCode
          currentGroupId
          currentGroupShortLabel
          currentGroupColor
        }
      }
    }
  }
`

export const SEARCH_QUERY = /* GraphQL */ `
  query Search($query: String!, $first: Int) {
    search(query: $query, first: $first) {
      personId
      slug
      displayName
      constituencyLabel
      currentGroupLabel
    }
  }
`
```

Vérifiez chaque champ contre `apps/api/schema.gql`. Un nom inventé ne se voit pas à la compilation TypeScript — il ne se voit qu'à l'exécution, et le message d'Apollo est laconique.

- [ ] **Step 2 : Configurer la génération**

```ts
// apps/web/codegen.ts
import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  schema: '../api/schema.gql',
  documents: ['src/lib/queries.ts'],
  generates: {
    'src/gql/generated.ts': {
      plugins: ['typescript', 'typescript-operations'],
      config: {
        // Le schéma déclare `DateTime` (scalaire de NestJS) : sans cette
        // correspondance, la codegen le rendrait `any`. Les dates arrivent
        // en chaînes ISO dans le JSON — jamais en objets `Date`.
        scalars: { DateTime: 'string' },
        avoidOptionals: true,
        skipTypename: true,
        enumsAsTypes: true,
      },
    },
  },
}

export default config
```

Ouvrez `apps/api/schema.gql` pour relever le nom réel du scalaire de date avant d'écrire cette ligne. NestJS émet `DateTime` par défaut, mais vérifiez-le.

- [ ] **Step 3 : Générer et lire le résultat**

```bash
pnpm --filter @poligraph/web codegen
```

Lisez `src/gql/generated.ts`. Deux points à contrôler concrètement :

- `VotingSummary.participationRate` doit être `number | null`, pas `number`. S'il est non-nullable, la codegen n'a pas lu le bon schéma : tout ce plan repose sur le fait que l'absence remonte jusqu'au composant.
- `Candidacy.votes` et `Candidacy.votePctExpressed` doivent exister. Sinon, le plan 5 n'a pas exposé les résultats électoraux et il faut le signaler avant de continuer.

- [ ] **Step 4 : Committer le fichier généré**

Il est committé, pas ignoré : `pnpm typecheck` doit passer sur un dépôt fraîchement cloné, sans API démarrée ni étape de génération.

```bash
git add apps/web/codegen.ts apps/web/src/lib/queries.ts apps/web/src/gql/generated.ts
git commit -m "feat(web): documents GraphQL et types generes depuis le schema"
```

---

## Task 5 : Les primitives d'affichage honnête

Le cœur du plan. Trois composants, trois règles.

**Files:**
- Create: `apps/web/src/components/{absent.tsx,computed-badge.tsx,section-card.tsx,fact-list.tsx}`
- Create: `apps/web/src/lib/format.ts`
- Tests: `apps/web/tests/{absent.test.tsx,computed-badge.test.tsx,format.test.ts}`

- [ ] **Step 1 : Écrire les tests d'abord**

```tsx
// apps/web/tests/absent.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Absent } from '@/components/absent'

describe('Absent', () => {
  it('nomme la donnée manquante et la source qui devrait la porter', () => {
    render(
      <Absent
        what="Compte de campagne"
        why="La CNCCFP n'a pas encore publié les comptes des législatives de 2024."
        officialUrl="https://www.cnccfp.fr/"
        officialLabel="CNCCFP"
      />,
    )
    expect(screen.getByText(/donnée non disponible/i)).toBeInTheDocument()
    expect(screen.getByText(/CNCCFP n'a pas encore publié/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /CNCCFP/ })
    expect(link).toHaveAttribute('href', 'https://www.cnccfp.fr/')
  })

  it("n'affiche jamais zéro à la place d'une absence", () => {
    render(<Absent what="Taux de participation" why="Dénominateur invérifiable." />)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByText('0 %')).not.toBeInTheDocument()
  })
})
```

```tsx
// apps/web/tests/computed-badge.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ComputedBadge } from '@/components/computed-badge'

describe('ComputedBadge', () => {
  it('annonce en toutes lettres que le chiffre est calculé par PoliGraph', () => {
    render(<ComputedBadge />)
    expect(screen.getByText(/calculé par PoliGraph/i)).toBeInTheDocument()
  })

  it('porte une explication accessible, pas seulement une couleur', () => {
    render(<ComputedBadge />)
    // La distinction officiel/calculé doit survivre au daltonisme et aux
    // lecteurs d'écran : elle est portée par du texte, pas par une classe CSS.
    expect(screen.getByTitle(/n'est pas un chiffre publié/i)).toBeInTheDocument()
  })
})
```

```ts
// apps/web/tests/format.test.ts
import { describe, expect, it } from 'vitest'
import { formatDate, formatAmount, formatPercent, formatInteger } from '@/lib/format'

describe('format', () => {
  it('rend une date ISO au format français', () => {
    expect(formatDate('2024-07-07')).toBe('7 juillet 2024')
  })

  it('rend null pour une date absente, jamais une date par défaut', () => {
    expect(formatDate(null)).toBeNull()
    expect(formatDate(undefined)).toBeNull()
  })

  it('rend un montant avec sa devise, sans arrondir', () => {
    expect(formatAmount(38150.42, 'EUR')).toContain('38 150,42')
  })

  it('distingue zéro de absent', () => {
    // Un compte de campagne à 0 € déclaré est un fait ; l'absence n'en est pas un.
    expect(formatAmount(0, 'EUR')).toContain('0,00')
    expect(formatAmount(null, 'EUR')).toBeNull()
  })

  it('rend un pourcentage tel que fourni, sans le recalculer', () => {
    expect(formatPercent(52.31)).toBe('52,31 %')
    expect(formatPercent(null)).toBeNull()
  })

  it('sépare les milliers des entiers', () => {
    expect(formatInteger(24_531)).toBe('24 531')
    expect(formatInteger(null)).toBeNull()
  })
})
```

Les espaces produits par `Intl` sont des espaces insécables (U+202F ou U+00A0), pas des espaces ordinaires. Si une assertion échoue sur ce qui semble identique à l'écran, c'est ça — normalisez dans le test avec `.replace(/ | /g, ' ')` plutôt que de tordre l'implémentation.

- [ ] **Step 2 : Lancer les tests, constater l'échec**

- [ ] **Step 3 : Implémenter le formatage**

```ts
// apps/web/src/lib/format.ts

/**
 * Toutes ces fonctions rendent `null` quand la valeur est absente, jamais une
 * valeur de repli. C'est la règle centrale du produit : `0 €` et « pas de
 * compte de campagne déposé » sont deux faits différents, et les confondre
 * serait un mensonge sur la donnée. L'appelant reçoit `null` et affiche
 * `<Absent>` — il n'a pas le choix, le type l'y oblige.
 */

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const INTEGER_FORMAT = new Intl.NumberFormat('fr-FR')

export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return DATE_FORMAT.format(date)
}

export function formatAmount(
  value: number | null | undefined,
  currency: string,
): string | null {
  if (value === null || value === undefined) return null
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  // Le pourcentage vient de la source, déjà exprimé en points (52.31 = 52,31 %).
  // On ne divise pas par 100 et on ne recalcule rien : la spec §5.4 interdit
  // de retoucher un chiffre publié, arrondi maison compris.
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} %`
}

export function formatInteger(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return INTEGER_FORMAT.format(value)
}
```

- [ ] **Step 4 : Implémenter les composants**

```tsx
// apps/web/src/components/absent.tsx

/**
 * L'absence de donnée est un état de premier rang, pas un vide (spec §9).
 * Le cas le plus fréquent est le financement en 17e législature : la CNCCFP
 * n'a publié que 2022. Une section vide laisserait croire à un défaut du
 * site ; celle-ci dit ce qui manque, pourquoi, et où le vérifier.
 */
export function Absent({
  what,
  why,
  officialUrl,
  officialLabel,
}: {
  what: string
  why: string
  officialUrl?: string
  officialLabel?: string
}) {
  return (
    <div className="rounded border border-dashed border-stone-300 bg-stone-100/60 p-4 text-sm">
      <p className="font-medium text-stone-700">
        {what} — donnée non disponible
      </p>
      <p className="mt-1 text-stone-600">{why}</p>
      {officialUrl && officialLabel && (
        <p className="mt-2">
          <a
            className="text-stone-700 underline underline-offset-2 hover:text-stone-900"
            href={officialUrl}
            rel="noreferrer noopener"
            target="_blank"
          >
            Consulter la publication officielle — {officialLabel}
          </a>
        </p>
      )}
    </div>
  )
}
```

```tsx
// apps/web/src/components/computed-badge.tsx

/**
 * Marque un chiffre produit par PoliGraph et non publié par une source
 * (spec §5.7, statut `COMPUTED`). L'information est portée par du texte et un
 * attribut `title`, pas par la seule couleur : la distinction doit survivre
 * à un lecteur d'écran comme à une impression en noir et blanc.
 */
export function ComputedBadge() {
  return (
    <span
      className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[0.7rem] font-medium uppercase tracking-wide text-amber-800"
      title="Ce chiffre est calculé par PoliGraph à partir des données officielles. Ce n'est pas un chiffre publié par une source."
    >
      Calculé par PoliGraph
    </span>
  )
}
```

```tsx
// apps/web/src/components/section-card.tsx
import { formatDate } from '@/lib/format'

export interface SectionSource {
  sourceId: string
  label: string
  importedAt: string | null
}

/**
 * Chaque section porte sa provenance à côté de son contenu, pas dans un pied
 * de page global (spec §9) : sur une fiche qui agrège quatre sources, un
 * unique « sources : AN, CNCCFP, RNE, Intérieur » n'apprendrait rien.
 */
export function SectionCard({
  title,
  sources,
  children,
}: {
  title: string
  sources?: SectionSource[]
  children: React.ReactNode
}) {
  return (
    <section className="mb-6 rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="mb-3 text-base font-semibold text-stone-900">{title}</h2>
      {children}
      {sources && sources.length > 0 && (
        <p className="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-500">
          {sources
            .map((s) => {
              const date = formatDate(s.importedAt)
              return date ? `${s.label}, importé le ${date}` : s.label
            })
            .join(' · ')}
        </p>
      )}
    </section>
  )
}
```

```tsx
// apps/web/src/components/fact-list.tsx
import { Absent } from './absent'

export interface Fact {
  label: string
  /** `null` déclenche l'affichage d'absence — voir `lib/format.ts`. */
  value: string | null
  /** Motif d'absence, obligatoire dès lors que `value` peut être `null`. */
  absentWhy?: string
  badge?: React.ReactNode
}

export function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,14rem)_1fr]">
      {facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="text-sm text-stone-500">{fact.label}</dt>
          <dd className="text-sm text-stone-900">
            {fact.value === null ? (
              <span className="text-stone-500 italic">
                {fact.absentWhy ?? 'Donnée non disponible'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                {fact.value}
                {fact.badge}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
```

`Absent` n'est pas utilisé par `FactList` — une paire libellé/valeur n'a pas la place d'un encadré. `Absent` sert aux sections entières manquantes. Retirez l'import s'il reste inutilisé plutôt que de le laisser traîner.

- [ ] **Step 5 : Tests au vert, committer**

```bash
pnpm --filter @poligraph/web test
git add apps/web/src/components apps/web/src/lib/format.ts apps/web/tests
git commit -m "feat(web): primitives d'affichage — absence, calcule, provenance"
```

---

## Task 6 : La fiche

**Files:**
- Create: `apps/web/src/components/sections/*.tsx` (six fichiers)
- Create: `apps/web/src/app/deputes/[slug]/page.tsx`
- Create: `apps/web/src/app/not-found.tsx`
- Tests: `apps/web/tests/{funding-section,voting-section,elections-section}.test.tsx`

Six sections : identité · mandats · groupe et commissions · activité de vote · élections et résultats · financement.

- [ ] **Step 1 : Écrire les trois tests qui portent les règles**

Les trois sections testées sont celles où une erreur d'affichage serait une contre-vérité. Les trois autres (identité, mandats, groupe) sont du rendu direct et n'ont pas besoin de test dédié.

```tsx
// apps/web/tests/funding-section.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FundingSection } from '@/components/sections/funding-section'

const candidature2022 = {
  id: 'c1',
  electionLabel: 'Législatives 2022',
  electionYear: 2022,
  territoryLabel: '1re circonscription de l’Ain',
  account: {
    currency: 'EUR',
    declaredExpenses: 38150.42,
    declaredIncome: 40000,
    declaredDonations: null,
    personalFunds: null,
    retainedExpenses: 37900,
    retainedIncome: null,
    decisionCode: 'APPROBATION',
  },
}

describe('FundingSection', () => {
  it('affiche les montants déclarés tels quels', () => {
    render(<FundingSection candidacies={[candidature2022]} sources={[]} />)
    expect(screen.getByText(/38 150,42/)).toBeInTheDocument()
  })

  it("affiche un motif d'absence quand aucune candidature n'a de compte", () => {
    render(
      <FundingSection
        candidacies={[{ ...candidature2022, electionYear: 2024, account: null }]}
        sources={[]}
      />,
    )
    expect(screen.getByText(/donnée non disponible/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /CNCCFP/ })).toBeInTheDocument()
  })

  it("n'affiche pas 0 € pour un montant non déclaré", () => {
    render(<FundingSection candidacies={[candidature2022]} sources={[]} />)
    // `declaredDonations` est null : il ne doit apparaître ni comme 0 € ni
    // comme une ligne vide sans explication.
    expect(screen.queryByText('0,00 €')).not.toBeInTheDocument()
    expect(screen.getByText(/Dons.*non déclaré/i)).toBeInTheDocument()
  })
})
```

```tsx
// apps/web/tests/voting-section.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VotingSection } from '@/components/sections/voting-section'

const resume = {
  status: 'COMPUTED' as const,
  mandateCount: 1,
  committeeCount: 2,
  voteCount: 412,
  participationBallotCount: 500,
  participationVoteCount: 412,
  participationRate: 0.824,
}

const positions = {
  totalCount: 412,
  pageInfo: { hasNextPage: true, endCursor: 'Y3Vyc29yOjI1' },
  edges: [
    {
      cursor: 'Y3Vyc29yOjE=',
      node: {
        id: 'bp1',
        ballotId: 'b1',
        ballotDate: '2024-10-15',
        ballotTitle: 'Projet de loi de finances pour 2025',
        ballotNumber: '412',
        legislatureNumber: 17,
        position: 'FOR',
        byDelegation: false,
        groupShortLabelAtVote: 'LR',
        publicationMode: 'DecompteNominatif',
      },
    },
  ],
}

describe('VotingSection', () => {
  it('marque le taux de participation comme calculé', () => {
    render(<VotingSection summary={resume} positions={positions} sources={[]} />)
    expect(screen.getByText(/82,40 %/)).toBeInTheDocument()
    expect(screen.getAllByText(/calculé par PoliGraph/i).length).toBeGreaterThan(0)
  })

  it("affiche l'absence quand le dénominateur est invérifiable, jamais 0 %", () => {
    render(
      <VotingSection
        summary={{
          ...resume,
          participationBallotCount: null,
          participationVoteCount: null,
          participationRate: null,
        }}
        positions={positions}
        sources={[]}
      />,
    )
    expect(screen.queryByText('0,00 %')).not.toBeInTheDocument()
    expect(screen.getByText(/non calculable/i)).toBeInTheDocument()
  })

  it("ne présente jamais une absence de ligne comme une absence du député", () => {
    render(<VotingSection summary={resume} positions={positions} sources={[]} />)
    // 412 positions sur 500 scrutins : les 88 restants ne sont PAS des
    // absences constatées — l'AN ne nomme les votants que sur les scrutins
    // publiés en décompte nominatif.
    expect(screen.getByText(/ne publie pas le détail nominatif/i)).toBeInTheDocument()
  })
})
```

Le taux vient de `gold` sous forme de **ratio arrondi à quatre décimales** (0,824), pas de points de pourcentage — vérifié dans la migration `20260825204803_gold_views` : `ROUND(voted / eligible, 4)`. `formatPercent` attend des points, la section multiplie donc par 100 avant de formater. C'est la seule multiplication autorisée du front : elle change l'unité, pas la valeur. Ne l'étendez à aucun autre chiffre.

```tsx
// apps/web/tests/elections-section.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ElectionsSection } from '@/components/sections/elections-section'

describe('ElectionsSection', () => {
  it('affiche voix, pourcentage et issue tels que publiés', () => {
    render(
      <ElectionsSection
        candidacies={[
          {
            id: 'c1',
            electionLabel: 'Législatives 2024',
            electionYear: 2024,
            round: 2,
            territoryLabel: '1re circonscription de l’Ain',
            nuance: 'LR',
            partyName: null,
            votes: 24531,
            votePctExpressed: 52.31,
            elected: true,
          },
        ]}
        sources={[]}
      />,
    )
    expect(screen.getByText(/24 531/)).toBeInTheDocument()
    expect(screen.getByText(/52,31 %/)).toBeInTheDocument()
    expect(screen.getByText(/élu/i)).toBeInTheDocument()
    expect(screen.getByText(/2e tour/i)).toBeInTheDocument()
  })

  it("affiche l'absence de résultats sans inventer de zéro", () => {
    render(
      <ElectionsSection
        candidacies={[
          {
            id: 'c2',
            electionLabel: 'Législatives 2022',
            electionYear: 2022,
            round: null,
            territoryLabel: '1re circonscription de l’Ain',
            nuance: 'LR',
            partyName: null,
            votes: null,
            votePctExpressed: null,
            elected: false,
          },
        ]}
        sources={[]}
      />,
    )
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.getByText(/résultat non importé/i)).toBeInTheDocument()
  })
})
```

Ce second test dit une chose vraie de la base : les 6 290 candidatures de 2022 viennent de la CNCCFP, qui ne publie pas les voix. Afficher `0 voix` serait faux.

- [ ] **Step 2 : Lancer, constater l'échec, implémenter les six sections**

Chaque section est une fonction pure qui reçoit ses données en propriétés — aucune ne fait d'appel réseau. C'est ce qui les rend testables sans API ni base.

Les propriétés de chaque section doivent être typées depuis `@/gql/generated`, pas redéclarées à la main : un type recopié se désynchronise du schéma sans que rien ne le signale.

Notes d'implémentation section par section :

- **Identité** — civilité, nom, date de naissance, circonscription, groupe actuel avec sa couleur. Une date de naissance absente est un fait connu de la base (l'AN ne la publie pas pour tous) : `FactList` l'affiche comme absente.
- **Mandats** — triés par date de début décroissante, un mandat en cours (`endDate` nulle) marqué « en cours », `endCause` affiché quand il existe.
- **Groupe et commissions** — `groupMemberships` et `committees` viennent du même type ; `quality` distingue un président d'un simple membre et doit être affiché.
- **Activité de vote** — voir le test ci-dessus. Les 25 derniers scrutins, avec un lien vers la fiche du scrutin sur le site de l'AN si l'identifiant le permet. La phrase sur le décompte nominatif est obligatoire, pas décorative.
- **Élections et résultats** — groupées par élection puis par tour, décroissant.
- **Financement** — une entrée par candidature ayant un compte ; quand aucune n'en a, `<Absent>` avec le lien CNCCFP.

- [ ] **Step 3 : La page**

```tsx
// apps/web/src/app/deputes/[slug]/page.tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { graphqlFetch } from '@/lib/graphql-fetch'
import { DEPUTY_QUERY } from '@/lib/queries'
import type { DeputyQuery, DeputyQueryVariables } from '@/gql/generated'

async function loadDeputy(slug: string): Promise<DeputyQuery['deputy']> {
  const data = await graphqlFetch<DeputyQuery>(DEPUTY_QUERY, { slug } satisfies DeputyQueryVariables)
  return data.deputy
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const deputy = await loadDeputy(slug)
  if (!deputy) return { title: 'Député introuvable — PoliGraph' }
  return {
    title: `${deputy.displayName} — PoliGraph`,
    description: `Fiche de transparence de ${deputy.displayName}${
      deputy.constituencyLabel ? `, ${deputy.constituencyLabel}` : ''
    } : mandats, votes, élections, financement.`,
  }
}

export default async function DeputyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const deputy = await loadDeputy(slug)
  if (!deputy) notFound()

  // ... rendu des six sections
}
```

`params` est une promesse dans Next 15 — c'est un changement par rapport à la 14, et l'oublier produit une erreur de type peu explicite.

Ne mettez pas de `try`/`catch` autour de `loadDeputy` : une panne de l'API doit remonter en page d'erreur, pas se dégrader en fiche vide. `notFound()` ne concerne que le cas où l'API répond correctement qu'aucun député ne porte ce slug.

- [ ] **Step 4 : Vérifier sur la vraie API, committer**

Démarrez l'API (`pnpm --filter @poligraph/api serve`), puis `pnpm --filter @poligraph/web dev`, et ouvrez une vraie fiche. Prenez un député dont vous avez vérifié les chiffres en base et comparez à l'écran. Consignez dans le rapport le slug utilisé et les chiffres comparés.

---

## Task 7 : Liste et recherche

**Files:**
- Create: `apps/web/src/app/deputes/page.tsx`
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1 : La liste**

`/deputes` avec filtres législature, groupe et département, portés par la query string (`?groupId=...&departmentCode=...`) et non par un état client : les filtres doivent être partageables par URL et rendus côté serveur.

`searchParams` est une promesse dans Next 15, comme `params`.

Pagination par curseur : l'API rend `pageInfo.endCursor`, un lien « page suivante » porte `?after=<curseur>`. Pas de défilement infini — il casse le lien direct et la navigation arrière.

Afficher `totalCount` en tête : « 577 députés ». C'est un chiffre issu de `gold.deputy_card`, donc calculé — mais un dénombrement de lignes n'est pas une estimation et n'appelle pas de badge. Réservez `ComputedBadge` aux agrégats qui pourraient passer pour officiels.

- [ ] **Step 2 : La recherche**

`/` : un champ, un formulaire qui soumet en GET vers `/?q=...`, les résultats rendus côté serveur via `SEARCH_QUERY`. Pas de saisie assistée en direct : ce serait un appel par frappe, sur une API à 120 requêtes par minute et par IP.

Une recherche sans résultat affiche un état explicite qui rappelle le périmètre : seuls les députés de la 17e législature sont présents (spec §2). C'est la question que se posera l'utilisateur qui cherche un sénateur ou un maire.

- [ ] **Step 3 : Vérifier et committer**

Vérifiez trois cas réels : une recherche qui trouve plusieurs homonymes (« Besson » en a deux en base), un filtre par département, et la deuxième page de la liste.

---

## Task 8 : Vérification de bout en bout

- [ ] `pnpm typecheck` et `pnpm build` à la racine, tous paquets confondus.
- [ ] `pnpm test` intégralement — les suites existantes (domain, ingestion, api) doivent rester au vert. Rappel : la base de test est partagée, `fileParallelism` est désactivé, et il faut attendre `pg_isready` après tout redémarrage du conteneur.
- [ ] Comparer trois fiches réelles à la base : un député avec compte de campagne 2022, un sans, et un dont la participation est `null`. Les trois doivent afficher un état juste, et le troisième ne doit afficher aucun `0 %`.
- [ ] Vérifier qu'aucune page ne rend `undefined`, `null` ou `NaN` à l'écran. Une recherche du texte brut dans le HTML rendu suffit.
- [ ] Consigner dans ce plan les chiffres réels observés et committer.

---

## Critère d'achèvement

- Les trois routes fonctionnent sur les données réelles.
- Une section sans donnée affiche son motif et un lien vers la source officielle — jamais un vide, jamais un zéro.
- Le taux de participation porte visiblement la mention « calculé par PoliGraph ».
- Chaque section affiche sa source et sa date d'import.
- Les types du front sont générés depuis `apps/api/schema.gql`, et le test d'instantané de schéma empêche les deux de diverger.
- `pnpm test`, `pnpm typecheck` et `pnpm build` passent à la racine.
