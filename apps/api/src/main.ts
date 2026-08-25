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

await CommandFactory.run(AppModule, ['warn', 'error'])
