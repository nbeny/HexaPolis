import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './helpers/app.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import { seedFiche, type SeededFiche } from './helpers/seed.js'

const prisma = testPrisma()
let testApp: TestApp
let fixture: SeededFiche

beforeAll(async () => {
  await resetDatabase(prisma)
  fixture = await seedFiche(prisma)
  testApp = await createTestApp(prisma)
})

afterAll(async () => {
  await testApp.close()
  await prisma.$disconnect()
})

const QUERY = `
  query($entityType: String!, $entityId: ID!, $field: String) {
    provenance(entityType: $entityType, entityId: $entityId, field: $field) {
      entityType
      field
      bronzeTable
      bronzeRef
      status
      source { sourceId label }
    }
  }
`

describe('Query.provenance — descend jusqu’à la ligne bronze', () => {
  it('sans filtre de champ, renvoie toute la provenance de l’entité (niveau entité et niveau champ)', async () => {
    const { body } = await testApp.graphql(QUERY, { entityType: 'Person', entityId: fixture.alice.id })
    expect(body.errors).toBeUndefined()
    const records = (body.data as any).provenance as any[]
    expect(records).toHaveLength(2)
    expect(records.every((r) => r.bronzeTable === 'an_acteur_raw')).toBe(true)
    expect(records.every((r) => r.bronzeRef === fixture.alice.anId)).toBe(true)
    expect(records.every((r) => r.status === 'OFFICIAL')).toBe(true)
    expect(records.every((r) => r.source?.sourceId === 'AN')).toBe(true)
  })

  it('vérifie que la ligne bronze référencée existe réellement', async () => {
    const { body } = await testApp.graphql(QUERY, { entityType: 'Person', entityId: fixture.alice.id })
    const [record] = (body.data as any).provenance as any[]
    const bronzeRows = await prisma.anActeurRaw.findMany({
      where: { importRunId: fixture.importRunId, uid: record.bronzeRef },
    })
    expect(bronzeRows).toHaveLength(1)
  })

  it('filtre sur un champ précis quand `field` est fourni', async () => {
    const { body } = await testApp.graphql(QUERY, {
      entityType: 'Person',
      entityId: fixture.alice.id,
      field: 'birthDate',
    })
    const records = (body.data as any).provenance as any[]
    expect(records).toHaveLength(1)
    expect(records[0].field).toBe('birthDate')
  })

  it('renvoie une liste vide pour une entité sans provenance connue', async () => {
    const { body } = await testApp.graphql(QUERY, { entityType: 'Person', entityId: fixture.bob.id })
    expect((body.data as any).provenance).toEqual([])
  })

  // SilverRepository.provenanceFor teste `field === undefined` pour choisir
  // entre les deux requêtes ; `field: null` prenait la branche filtrée
  // (`p.field = NULL`), qui ne correspond jamais à rien en SQL. `field: null`
  // doit se comporter comme l'argument omis : toute la provenance de l'entité.
  it('field: null équivaut à l’absence de filtre', async () => {
    const { body } = await testApp.graphql(QUERY, {
      entityType: 'Person',
      entityId: fixture.alice.id,
      field: null,
    })
    expect(body.errors).toBeUndefined()
    expect((body.data as any).provenance as any[]).toHaveLength(2)
  })
})
