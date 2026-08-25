import 'reflect-metadata'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { CommandFactory } from 'nest-commander'
import { AppModule } from './app.module.js'

// Comme `packages/ingestion/vitest.config.ts`, on charge le .env de la racine
// du monorepo nous-mêmes : ni tsx ni Node ne le font automatiquement, et le
// CLI a besoin de DATABASE_URL pour se connecter via getPrisma(). En
// production/CI, les variables sont déjà fournies par l'environnement et le
// fichier peut être absent : on avale l'erreur silencieusement.
const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env')
try {
  process.loadEnvFile(rootEnvPath)
} catch {
  // .env absent (ex. CI) : les variables sont déjà fournies par l'environnement.
}

// nest-commander avale par défaut les erreurs lancées pendant le parsing des
// options ou l'exécution d'une commande : sa `serviceErrorHandler` par
// défaut se contente d'écrire l'erreur sur stderr sans jamais positionner
// `process.exitCode`, si bien qu'une commande en échec sortait quand même
// avec le code 0. On force donc un code non nul dès qu'une erreur remonte
// jusqu'ici, qu'elle vienne d'une option invalide (ex. --legislature) ou
// d'un import qui a réellement échoué.
await CommandFactory.run(AppModule, {
  logger: ['warn', 'error'],
  serviceErrorHandler: (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  },
})
