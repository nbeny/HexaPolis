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

const QUERY = `
  query($slug: String!, $legislature: Int, $first: Int, $after: String) {
    deputy(slug: $slug) {
      ballotPositions(legislature: $legislature, first: $first, after: $after) {
        totalCount
        pageInfo { hasNextPage endCursor }
        edges { cursor node { ballotTitle legislatureNumber position } }
      }
    }
  }
`

describe('Deputy.ballotPositions — pagination Relay', () => {
  it('pagine sur toutes les législatures quand aucun filtre n’est fourni : 4 positions au total pour Alice', async () => {
    const { body } = await testApp.graphql(QUERY, { slug: fixture.alice.slug, first: 2 })
    expect(body.errors).toBeUndefined()
    const connection = (body.data as any).deputy.ballotPositions
    expect(connection.totalCount).toBe(4)
    expect(connection.edges).toHaveLength(2)
    expect(connection.pageInfo.hasNextPage).toBe(true)
    expect(connection.pageInfo.endCursor).toBeTruthy()
  })

  it('avance avec le curseur `after` sans répéter ni sauter de ligne', async () => {
    const first = await testApp.graphql(QUERY, { slug: fixture.alice.slug, first: 2 })
    const firstConnection = (first.body.data as any).deputy.ballotPositions
    const firstTitles = firstConnection.edges.map((e: any) => e.node.ballotTitle)

    const second = await testApp.graphql(QUERY, {
      slug: fixture.alice.slug,
      first: 2,
      after: firstConnection.pageInfo.endCursor,
    })
    const secondConnection = (second.body.data as any).deputy.ballotPositions
    const secondTitles = secondConnection.edges.map((e: any) => e.node.ballotTitle)

    expect(secondConnection.edges).toHaveLength(2)
    expect(secondConnection.pageInfo.hasNextPage).toBe(false)
    // Les deux pages, mises bout à bout, couvrent les 4 positions sans chevauchement.
    expect(new Set([...firstTitles, ...secondTitles]).size).toBe(4)
  })

  it('filtre par législature : seuls les 3 scrutins de la 17e reviennent', async () => {
    const { body } = await testApp.graphql(QUERY, {
      slug: fixture.alice.slug,
      legislature: 17,
      first: 10,
    })
    const connection = (body.data as any).deputy.ballotPositions
    expect(connection.totalCount).toBe(3)
    expect(connection.edges.every((e: any) => e.node.legislatureNumber === 17)).toBe(true)
  })

  it('filtre par une législature antérieure : le seul scrutin de la 16e revient', async () => {
    const { body } = await testApp.graphql(QUERY, {
      slug: fixture.alice.slug,
      legislature: 16,
      first: 10,
    })
    const connection = (body.data as any).deputy.ballotPositions
    expect(connection.totalCount).toBe(1)
    expect(connection.edges[0].node.legislatureNumber).toBe(16)
  })
})

describe('Deputy.votingSummary — argument legislature', () => {
  const SUMMARY_QUERY = `
    query($slug: String!, $legislature: Int) {
      deputy(slug: $slug) {
        votingSummary(legislature: $legislature) {
          status voteCount participationRate
        }
      }
    }
  `

  it('sans argument, lit l’agrégat précalculé de gold.deputy_card (17e législature)', async () => {
    const { body } = await testApp.graphql(SUMMARY_QUERY, { slug: fixture.alice.slug })
    const summary = (body.data as any).deputy.votingSummary
    expect(summary.status).toBe('COMPUTED')
    expect(summary.voteCount).toBe(3)
  })

  it('sur une législature hors 17e, compte en direct sur gold.deputy_vote et laisse la participation absente', async () => {
    const { body } = await testApp.graphql(SUMMARY_QUERY, { slug: fixture.alice.slug, legislature: 16 })
    const summary = (body.data as any).deputy.votingSummary
    expect(summary.voteCount).toBe(1)
    // gold.deputy_card n'agrège la participation que pour la 17e : jamais
    // recalculée pour une autre législature, donc absente plutôt que fausse.
    expect(summary.participationRate).toBeNull()
  })
})
