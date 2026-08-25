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

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    // Les tests d'intégration GraphQL partagent la même base de test et la
    // remettent à zéro dans leur beforeEach ; voir le commentaire équivalent
    // dans packages/ingestion/vitest.config.ts.
    fileParallelism: false,
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
