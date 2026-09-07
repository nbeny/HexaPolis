#!/usr/bin/env node
// Exécute une commande après avoir chargé le .env de la racine.
//
// Prisma ne lit que le .env posé à côté de prisma/schema.prisma, jamais celui
// de la racine du monorepo (même constat que dans .github/workflows/ci.yml).
// Sans ce relais, `pnpm db:migrate` et `pnpm db:status` échouent sur
// « Environment variable not found: DATABASE_URL » alors que le .env racine
// est bien là. Les builds et les tests, eux, n'en ont pas besoin : `prisma
// generate` se passe de DATABASE_URL, et les deux vitest.config.ts appellent
// déjà loadEnvFile eux-mêmes.
//
// Même idiome que packages/ingestion/vitest.config.ts et apps/api/src/main.ts :
// on avale l'ENOENT pour que la CI, qui n'a pas de .env, garde les variables
// injectées par le job.
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

try {
  process.loadEnvFile(resolve(root, '.env'))
} catch {
  // .env absent (ex. CI) : les variables sont déjà fournies par l'environnement.
}

// shell: true est nécessaire pour atteindre `pnpm` sous Windows, où le binaire
// est un .cmd que spawn ne sait pas lancer directement. On recolle la commande
// en une seule chaîne plutôt que de passer un tableau d'arguments : avec
// shell: true les deux formes se valent, mais la seconde déclenche DEP0190.
// Les seuls appelants sont les scripts de package.json, dont les arguments
// sont fixes et sans espace.
const command = process.argv.slice(2).join(' ')
if (!command) {
  console.error('usage : node scripts/with-env.mjs <commande> [args...]')
  process.exit(2)
}

const child = spawn(command, { cwd: root, shell: true, stdio: 'inherit' })
child.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1))
})
