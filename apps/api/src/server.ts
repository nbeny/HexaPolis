import { NestFactory } from '@nestjs/core'
import { corsOrigins } from './graphql/cors.js'
import { ServerModule, type ServerModuleOptions } from './server.module.js'

/**
 * Démarre le serveur GraphQL. Séparé de `main.ts` pour rester testable :
 * les tests d'intégration appellent `Test.createTestingModule` directement
 * sur `ServerModule`, mais un test qui veut vérifier le cycle de vie complet
 * (écoute HTTP réelle) peut réutiliser cette fonction avec un port éphémère
 * (`port: 0`).
 */
export async function startServer(
  port: number,
  options: ServerModuleOptions = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = await NestFactory.create(ServerModule.forRoot(options), { logger: ['warn', 'error'] })
  const origins = corsOrigins(process.env)
  if (origins.length > 0) app.enableCors({ origin: origins })
  await app.listen(port)
  const url = (await app.getUrl()).replace('[::1]', 'localhost')
  return { url, close: () => app.close() }
}
