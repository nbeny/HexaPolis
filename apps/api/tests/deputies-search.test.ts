import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { refreshGold } from '@poligraph/ingestion'
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
      { deputies(first: 1) { totalCount pageInfo { hasNextPage } edges { node { displayName } } } }
    `)
    const connection = (body.data as any).deputies
    expect(connection.totalCount).toBe(2) // Alice et Bob.
    expect(connection.edges).toHaveLength(1)
    expect(connection.pageInfo.hasNextPage).toBe(true)
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
