import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { refreshGold } from '@poligraph/ingestion'
import { createTestApp, type TestApp } from './helpers/app.js'
import { resetDatabase, testPrisma } from './helpers/db.js'

// Les limites de profondeur et de complexité se valident avant toute
// exécution de résolveur : aucune donnée seedée n'est nécessaire pour ces
// deux garde-fous. Le rate limiting, lui, ne s'engage que sur une requête
// qui invoque un vrai résolveur Nest (voir plus bas pourquoi `{ __typename }`
// ne convient pas) : la base est réinitialisée (vide) pour rester
// déterministe, sans qu'il soit nécessaire d'y semer quoi que ce soit.
//
// `gold.deputy_card` est une VUE MATÉRIALISÉE : TRUNCATE sur `silver` ne la
// vide pas, elle garde l'instantané de son dernier REFRESH (par ex. celui
// d'un fichier de test précédent). Il faut donc aussi la rafraîchir pour
// obtenir une base réellement vide — exactement la distinction que
// l'auto-revue de tâche fait sur la fraîcheur de `gold`.
const prisma = testPrisma()
let testApp: TestApp | undefined

beforeAll(async () => {
  await resetDatabase(prisma)
  await refreshGold(prisma)
})

afterEach(async () => {
  await testApp?.close()
  testApp = undefined
})

describe('garde-fous — limite de profondeur', () => {
  it('refuse une requête dont la profondeur dépasse la limite configurée', async () => {
    testApp = await createTestApp(prisma, { maxDepth: 1 })

    const { body } = await testApp.graphql(
      `{ deputy(slug: "pa000001-x") { mandates { id } } }`,
    )

    expect(body.data).toBeUndefined()
    expect(body.errors).toBeDefined()
    expect(body.errors?.[0]?.message).toMatch(/exceeds maximum operation depth/i)
  })

  it('laisse passer une requête dans la limite', async () => {
    testApp = await createTestApp(prisma, { maxDepth: 1 })

    const { body } = await testApp.graphql(`{ deputy(slug: "pa000001-x") { id } }`)

    // Base vide : le député reste introuvable, mais l'important est qu'il
    // n'y ait pas d'erreur de VALIDATION — la requête a été acceptée.
    expect(body.errors).toBeUndefined()
    expect(body.data).toEqual({ deputy: null })
  })
})

describe('garde-fous — limite de complexité', () => {
  it('refuse une requête dont la complexité dépasse la limite configurée', async () => {
    testApp = await createTestApp(prisma, { maxComplexity: 2 })

    const { body } = await testApp.graphql(`
      { deputy(slug: "pa000001-x") { id slug displayName firstName lastName } }
    `)

    expect(body.data).toBeUndefined()
    expect(body.errors).toBeDefined()
    expect((body.errors?.[0] as any)?.extensions?.code).toBe('QUERY_TOO_COMPLEX')
  })
})

describe('garde-fous — rate limiting', () => {
  it('finit par refuser les requêtes au-delà de la limite par fenêtre', async () => {
    testApp = await createTestApp(prisma, { throttle: { ttl: 60_000, limit: 2 } })

    // `{ __typename }` ne suffit pas ici : c'est un champ d'introspection
    // résolu directement par graphql-js, sans jamais passer par un handler
    // Nest — le `APP_GUARD` global (dont `GqlThrottlerGuard`) ne s'engage
    // que sur l'invocation d'un handler. Il faut un vrai résolveur.
    const responses = []
    for (let i = 0; i < 5; i++) {
      responses.push(await testApp.graphql(`{ deputy(slug: "pa000001-x") { id } }`))
    }

    const throttled = responses.some(
      (r) => r.status === 429 || r.body.errors?.some((e) => /throttl|too many/i.test(e.message)),
    )
    expect(throttled).toBe(true)
  })
})
