import 'reflect-metadata'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { CommandFactory } from 'nest-commander'
import { AppModule } from './app.module.js'
import { startServer } from './server.js'

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

// Le serveur GraphQL cohabite avec la CLI dans la même application (plan 4,
// tâche 4). Choix : un test d'argv en tête de `main.ts`, plutôt qu'une
// commande `nest-commander` de plus. Deux raisons :
//
// 1. `CommandFactory.run` construit un contexte d'application Nest
//    (`NestFactory.createApplicationContext`, sans serveur HTTP) pour
//    dispatcher UNE commande puis quitter. Un serveur GraphQL a besoin d'un
//    adaptateur HTTP (`NestFactory.create`) et ne quitte jamais de
//    lui-même : le faire vivre comme une commande `nest-commander`
//    obligerait à démarrer une seconde application Nest imbriquée à
//    l'intérieur du contexte de la première, pour un bénéfice nul.
// 2. `serviceErrorHandler` (ci-dessous) suppose qu'une commande se termine
//    et positionne `process.exitCode` en conséquence — un serveur qui tourne
//    indéfiniment n'a pas ce cycle de vie.
//
// Les commandes existantes (`import`, `check`, `resolve`, `gold`) ne sont pas
// affectées : ce test n'intercepte que `serve`, tout le reste retombe sur
// `CommandFactory.run` inchangé.
if (process.argv[2] === 'serve') {
  const portFlagIndex = process.argv.indexOf('--port')
  const portFromFlag = portFlagIndex >= 0 ? Number(process.argv[portFlagIndex + 1]) : NaN
  const portFromEnv = Number(process.env.PORT)
  const port = [portFromFlag, portFromEnv].find((candidate) => Number.isFinite(candidate)) ?? 4000
  const { url } = await startServer(port)
  console.log(`Serveur GraphQL PoliGraph en écoute sur ${url}/graphql`)
} else {
  // nest-commander avale par défaut les erreurs lancées pendant le parsing
  // des options ou l'exécution d'une commande : sa `serviceErrorHandler` par
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
}
