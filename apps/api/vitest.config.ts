import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

// Comme `packages/ingestion/vitest.config.ts` : le .env racine du monorepo
// n'est pas chargé automatiquement par vitest.
const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env')
try {
  process.loadEnvFile(rootEnvPath)
} catch {
  // .env absent (ex. CI) : les variables sont déjà fournies par l'environnement.
}

// `graphql` n'a pas de champ `exports` : Node, en `require()`, résout son
// entrée CJS (`main: index.js`) — c'est ce que charge la chaîne interne de
// `@nestjs/graphql`/`@apollo/server`. Mais le résolveur de Vite, pour un
// `import` ESM comme celui de schema-snapshot.test.ts, privilégie le champ
// `module` (`index.mjs`) : deux fichiers distincts, donc deux classes
// `GraphQLObjectType` distinctes. `graphql` refuse alors de comparer une
// instance de l'une à une instance de l'autre (« Cannot use GraphQLObjectType
// from another module or realm »). On force, via un alias, tout le graphe de
// test à résoudre `graphql` vers le même fichier que `require('graphql')`.
const require = createRequire(import.meta.url)
const graphqlCjsEntry = require.resolve('graphql')

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    // Les tests d'intégration GraphQL partagent la même base de test et la
    // remettent à zéro dans leur beforeEach ; voir le commentaire équivalent
    // dans packages/ingestion/vitest.config.ts.
    fileParallelism: false,
  },
  resolve: {
    alias: { graphql: graphqlCjsEntry },
  },
  // esbuild (transformateur par défaut de vitest) supporte la syntaxe des
  // décorateurs mais pas `emitDecoratorMetadata` : il ne fait pas de
  // vérification de types, donc ne peut pas produire les métadonnées
  // `design:type`/`design:paramtypes` dont Nest a besoin pour déduire les
  // types GraphQL depuis les classes (`@Field()` sans fonction de type
  // explicite, injection par constructeur). C'est le contournement officiel
  // documenté par NestJS pour faire fonctionner Vitest avec ses décorateurs.
  plugins: [swc.vite()],
})
