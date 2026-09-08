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

  // GoldRepository.listVotes traduisait `legislature === undefined` en
  // `Prisma.empty`, mais `null` prenait la branche `AND legislature_number =
  // NULL` — qui ne correspond jamais à aucune ligne en SQL. `legislature:
  // null` doit se comporter exactement comme l'argument omis.
  it('legislature: null équivaut à l’absence de filtre : les 4 positions d’Alice reviennent', async () => {
    const { body } = await testApp.graphql(QUERY, {
      slug: fixture.alice.slug,
      legislature: null,
      first: 10,
    })
    expect(body.errors).toBeUndefined()
    const connection = (body.data as any).deputy.ballotPositions
    expect(connection.totalCount).toBe(4)
  })
})

describe('Deputy.votingSummary — argument legislature', () => {
  const SUMMARY_QUERY = `
    query($slug: String!, $legislature: Int) {
      deputy(slug: $slug) {
        votingSummary(legislature: $legislature) {
          status voteCount participationBallotCount participationNamedCount
          participationExpressedCount participationNonVotingCount participationExpressedRate
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
    // Toute la décomposition part avec elle — publier « dont non-votant : 0 »
    // pour une législature non agrégée serait un chiffre inventé.
    expect(summary.participationBallotCount).toBeNull()
    expect(summary.participationNamedCount).toBeNull()
    expect(summary.participationExpressedCount).toBeNull()
    expect(summary.participationNonVotingCount).toBeNull()
    expect(summary.participationExpressedRate).toBeNull()
  })

  // DeputyResolver.votingSummary testait `legislature === undefined ||
  // legislature === 17` : faux pour `null`, qui prenait donc la branche de
  // recalcul et renvoyait les champs de participation à `null` alors que la
  // carte 17e les porte. `legislature: null` doit lire l'agrégat précalculé,
  // exactement comme l'argument omis.
  it('legislature: null lit l’agrégat précalculé — pas de recalcul, participation non nullée', async () => {
    const { body } = await testApp.graphql(SUMMARY_QUERY, { slug: fixture.alice.slug, legislature: null })
    expect(body.errors).toBeUndefined()
    const summary = (body.data as any).deputy.votingSummary
    expect(summary.voteCount).toBe(3)
    expect(summary.participationExpressedRate).not.toBeNull()
    expect(summary.participationNonVotingCount).not.toBeNull()
  })
})

const QUERY_PAGE_INFO = `
  query($slug: String!, $first: Int, $after: String) {
    deputy(slug: $slug) {
      ballotPositions(first: $first, after: $after) {
        totalCount
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges { cursor }
      }
    }
  }
`

/** Alice a 4 positions ; `first: 1` donne donc quatre pages d'une ligne. */
async function pageOf(after?: string) {
  const { body } = await testApp.graphql(QUERY_PAGE_INFO, {
    slug: fixture.alice.slug,
    first: 1,
    ...(after !== undefined && { after }),
  })
  expect(body.errors).toBeUndefined()
  return (body.data as any).deputy.ballotPositions
}

describe('PageInfo — les bornes des deux côtés', () => {
  it("n'annonce aucune page précédente sur la première page", async () => {
    const page = await pageOf()
    expect(page.pageInfo.hasPreviousPage).toBe(false)
    expect(page.pageInfo.hasNextPage).toBe(true)
    expect(page.pageInfo.startCursor).toBeTruthy()
  })

  it('annonce une page précédente ET une suivante au milieu', async () => {
    const page1 = await pageOf()
    const page2 = await pageOf(page1.pageInfo.endCursor)
    expect(page2.pageInfo.hasPreviousPage).toBe(true)
    expect(page2.pageInfo.hasNextPage).toBe(true)
  })

  // Alice a 4 positions et `first: 1` : exactement 3 avancées après la
  // première page. La boucle est bornée par ce compte attendu plutôt que par
  // `hasNextPage` seul, pour qu'une régression qui laisserait `hasNextPage`
  // toujours vrai fasse échouer le test au lieu de tourner jusqu'au timeout.
  it("annonce une page précédente mais aucune suivante sur la dernière page", async () => {
    let page = await pageOf()
    let advances = 0
    while (page.pageInfo.hasNextPage && advances < 10) {
      page = await pageOf(page.pageInfo.endCursor)
      advances++
    }
    expect(advances).toBe(3)
    expect(page.pageInfo.hasPreviousPage).toBe(true)
    expect(page.pageInfo.hasNextPage).toBe(false)
  })

  it("chaîne les pages : le startCursor d'une page est l'endCursor de la précédente", async () => {
    const page1 = await pageOf()
    const page2 = await pageOf(page1.pageInfo.endCursor)
    expect(page2.pageInfo.startCursor).toBe(page1.pageInfo.endCursor)
  })
})
