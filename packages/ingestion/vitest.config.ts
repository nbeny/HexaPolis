import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Vitest ne lit pas automatiquement le .env à la racine du monorepo. On le
// charge ici avec l'API native de Node (pas de dépendance ajoutée). En CI,
// les variables viennent de l'environnement et le fichier n'existe pas :
// on avale l'erreur silencieusement plutôt que de faire planter la config.
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
    // Plusieurs fichiers de test partagent la même base Postgres de test et
    // la remettent à zéro (TRUNCATE) dans leur beforeEach. Vitest exécute les
    // fichiers de test en parallèle par défaut : sans cette option, deux
    // fichiers peuvent truncater/upserter les mêmes lignes (ex. Source id
    // 'AN') en même temps et provoquer des violations de contrainte unique
    // ou des lectures incohérentes. On force l'exécution séquentielle des
    // fichiers pour ce package.
    fileParallelism: false,
  },
})
