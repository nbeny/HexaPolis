import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { refreshGold } from '@poligraph/ingestion'
import { encodeCursor } from '../src/graphql/common/cursor.js'
import { createTestApp, type TestApp } from './helpers/app.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import { seedFiche, type SeededFiche } from './helpers/seed.js'

const prisma = testPrisma()
let testApp: TestApp
let fixture: SeededFiche

beforeAll(async () => {
  await resetDatabase(prisma)
  fixture = await seedFiche(prisma)
  await refreshGold(prisma)
  testApp = await createTestApp(prisma)
})

afterAll(async () => {
  await testApp.close()
  await prisma.$disconnect()
})

describe('Query.deputies', () => {
  it('liste les députés en exercice, paginés', async () => {
    const { body } = await testApp.graphql(`
      {
        deputies(first: 1) {
          totalCount
          pageInfo { startCursor hasNextPage hasPreviousPage }
          edges { node { displayName } }
        }
      }
    `)
    const connection = (body.data as any).deputies
    expect(connection.totalCount).toBe(2) // Alice et Bob.
    expect(connection.edges).toHaveLength(1)
    expect(connection.pageInfo.hasNextPage).toBe(true)
    // Première page : pas de précédente, mais un startCursor tout de même
    // (voir apps/api/src/graphql/common/connection.ts).
    expect(connection.pageInfo.hasPreviousPage).toBe(false)
    expect(connection.pageInfo.startCursor).toBeTruthy()
  })

  it('filtre par groupe', async () => {
    const { body } = await testApp.graphql(`
      query($groupId: ID) { deputies(groupId: $groupId, first: 10) { totalCount } }
    `, { groupId: fixture.group })
    // Alice et Bob sont tous deux membres du même groupe test.
    expect((body.data as any).deputies.totalCount).toBe(2)
  })

  it('une législature autre que la 17e renvoie une page vide — hors périmètre d’affichage (spec §2)', async () => {
    const { body } = await testApp.graphql(`{ deputies(legislature: 15, first: 10) { totalCount } }`)
    expect((body.data as any).deputies.totalCount).toBe(0)
  })

  // GraphQL livre `null` pour un argument nullable explicitement passé —
  // c'est la façon naturelle dont un client généré (InputMaybe<T> = T | null)
  // exprime « pas de filtre ». Avant la correction, `legislature: null`
  // échouait le test `!== undefined` de GoldRepository.listCards et renvoyait
  // une page vide au lieu de la liste complète : un défaut silencieux.
  it('legislature: null équivaut à l’absence de filtre (pas à une valeur hors périmètre)', async () => {
    const { body } = await testApp.graphql(
      `query($legislature: Int) { deputies(legislature: $legislature, first: 10) { totalCount } }`,
      { legislature: null },
    )
    expect(body.errors).toBeUndefined()
    expect((body.data as any).deputies.totalCount).toBe(2)
  })

  // `groupId` et `departmentCode` passent par un simple test de vérité
  // (`if (filters.groupId)`), qui tolère déjà `null` en JavaScript — ce test
  // fige ce comportement pour qu'un futur refactor (ex. `!== undefined`) ne
  // le casse pas silencieusement.
  it('groupId: null équivaut à l’absence de filtre', async () => {
    const { body } = await testApp.graphql(
      `query($groupId: ID) { deputies(groupId: $groupId, first: 10) { totalCount } }`,
      { groupId: null },
    )
    expect(body.errors).toBeUndefined()
    expect((body.data as any).deputies.totalCount).toBe(2)
  })

  it('departmentCode: null équivaut à l’absence de filtre', async () => {
    const { body } = await testApp.graphql(
      `query($departmentCode: String) { deputies(departmentCode: $departmentCode, first: 10) { totalCount } }`,
      { departmentCode: null },
    )
    expect(body.errors).toBeUndefined()
    expect((body.data as any).deputies.totalCount).toBe(2)
  })

  // `Query.deputies` est une requête racine : contrairement à
  // `Deputy.ballotPositions` (un @ResolveField, que les filtres Nest
  // n'atteignent pas faute de `fieldResolverEnhancers`), c'est le seul
  // chemin où `GraphqlErrorFilter` a un effet. Sans ce test, la connexion
  // racine n'a aucune couverture de son argument `before`.
  it('deputies : `after` et `before` ensemble sont refusés en BAD_USER_INPUT', async () => {
    const { body } = await testApp.graphql(
      `query($after: String, $before: String) {
         deputies(first: 1, after: $after, before: $before) { totalCount }
       }`,
      { after: encodeCursor(1), before: encodeCursor(1) },
    )
    expect(body.errors?.[0]?.message).toMatch(/ensemble/)
    expect(body.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT')
  })

  // Aller-retour symétrique de celui de `Deputy.ballotPositions` : Alice et
  // Bob sont les deux seuls députés de la fixture, triés par nom de famille
  // (Dupont puis Martin) — de quoi former deux pages d'un élément et vérifier
  // que `before` ramène bien la première.
  it('deputies : `before` depuis la page 2 rend exactement la page 1', async () => {
    const QUERY = `
      query($first: Int, $after: String, $before: String) {
        deputies(first: $first, after: $after, before: $before) {
          pageInfo { startCursor endCursor hasPreviousPage }
          edges { cursor node { displayName } }
        }
      }
    `
    const page1res = await testApp.graphql(QUERY, { first: 1 })
    expect(page1res.body.errors).toBeUndefined()
    const page1 = (page1res.body.data as any).deputies

    const page2res = await testApp.graphql(QUERY, { first: 1, after: page1.pageInfo.endCursor })
    expect(page2res.body.errors).toBeUndefined()
    const page2 = (page2res.body.data as any).deputies

    const backRes = await testApp.graphql(QUERY, { first: 1, before: page2.pageInfo.startCursor })
    expect(backRes.body.errors).toBeUndefined()
    const back = (backRes.body.data as any).deputies

    expect(back.edges.map((e: any) => e.node.displayName)).toEqual(
      page1.edges.map((e: any) => e.node.displayName),
    )
    expect(back.pageInfo.hasPreviousPage).toBe(false)
  })
})

describe('Query.search', () => {
  it('trouve un député par une partie de son nom', async () => {
    const { body } = await testApp.graphql(`{ search(query: "Dupont", first: 5) { slug displayName } }`)
    const hits = (body.data as any).search
    expect(hits).toEqual([{ slug: fixture.alice.slug, displayName: 'Alice Dupont' }])
  })

  it('renvoie une liste vide pour une requête sans résultat', async () => {
    const { body } = await testApp.graphql(`{ search(query: "Zzzzz", first: 5) { slug } }`)
    expect((body.data as any).search).toEqual([])
  })
})
