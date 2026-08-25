import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { PrismaClient } from '@poligraph/db'
import { PRISMA_CLIENT } from '../../src/graphql/prisma.provider.js'
import { ServerModule, type ServerModuleOptions } from '../../src/server.module.js'

export interface GraphqlResponse {
  status: number
  body: { data?: unknown; errors?: Array<{ message: string; [key: string]: unknown }> }
}

export interface TestApp {
  app: INestApplication
  graphql: (query: string, variables?: Record<string, unknown>) => Promise<GraphqlResponse>
  close: () => Promise<void>
}

/**
 * Démarre un vrai serveur HTTP (port éphémère) porté par `ServerModule`, le
 * `PrismaClient` substitué par celui de test — c'est ce qui permet
 * d'exercer le câblage réel (Apollo, `validationRules`, `GqlThrottlerGuard`)
 * plutôt qu'un schéma construit à la main, sans dépendre de `supertest`
 * (absent du monorepo) : `fetch` global de Node suffit.
 */
export async function createTestApp(
  prisma: PrismaClient,
  options: ServerModuleOptions = {},
): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [ServerModule.forRoot(options)],
  })
    .overrideProvider(PRISMA_CLIENT)
    .useValue(prisma)
    .compile()

  const app = moduleRef.createNestApplication()
  await app.init()
  await app.listen(0)
  const url = (await app.getUrl()).replace('[::1]', 'localhost')

  async function graphql(query: string, variables?: Record<string, unknown>): Promise<GraphqlResponse> {
    const res = await fetch(`${url}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })
    const body = (await res.json()) as GraphqlResponse['body']
    return { status: res.status, body }
  }

  return { app, graphql, close: () => app.close() }
}
