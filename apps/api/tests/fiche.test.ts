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

describe('deputy(slug) — fiche complète', () => {
  it('renvoie l’identité, les mandats et l’activité de vote d’Alice', async () => {
    const { body } = await testApp.graphql(`
      query($slug: String!) {
        deputy(slug: $slug) {
          id
          slug
          displayName
          civility
          mandates { kind legislatureNumber territoryLabel startDate endDate }
          groupMemberships { bodyLabel }
          committees { bodyLabel }
          votingSummary { status mandateCount committeeCount voteCount participationRate }
          candidacies { electionLabel round votes votePctRegistered votePctExpressed elected account { declaredExpenses declaredIncome } }
          sources { sourceId label }
        }
      }
    `, { slug: fixture.alice.slug })

    expect(body.errors).toBeUndefined()
    const deputy = (body.data as any).deputy
    expect(deputy.id).toBe(fixture.alice.id)
    expect(deputy.displayName).toBe('Alice Dupont')

    // Mandats : deux, une législature ouverte et une close (spec — section « Mandats »).
    expect(deputy.mandates).toHaveLength(2)
    expect(deputy.mandates.map((m: any) => m.legislatureNumber).sort()).toEqual([16, 17])

    // Groupe et commissions.
    expect(deputy.groupMemberships).toHaveLength(1)
    expect(deputy.groupMemberships[0].bodyLabel).toBe('Groupe Test')
    expect(deputy.committees).toHaveLength(1)

    // Activité de vote : synthèse COMPUTED, distincte des faits officiels
    // (point 1 de la tâche) — voir aussi tests/pagination.test.ts pour le détail paginé.
    expect(deputy.votingSummary.status).toBe('COMPUTED')
    expect(deputy.votingSummary.mandateCount).toBe(2)
    expect(deputy.votingSummary.voteCount).toBe(3) // 3 scrutins de la 17e, Alice y vote tous.

    // Deux candidatures, triées par année d'élection décroissante : 2024
    // (DATA_GOUV, résultats officiels) puis 2022 (CNCCFP, compte de campagne).
    expect(deputy.candidacies).toHaveLength(2)
    const [c2024, c2022] = deputy.candidacies

    // Résultats électoraux : voix et pourcentages présents, recopiés tels
    // quels — jamais recalculés depuis les voix (point 2 de la consigne).
    expect(c2024.electionLabel).toBe('Élections législatives 2024')
    expect(c2024.round).toBe(2)
    expect(c2024.votes).toBe(33889)
    expect(c2024.votePctRegistered).toBeCloseTo(39.02)
    expect(c2024.votePctExpressed).toBeCloseTo(56.48)
    expect(c2024.elected).toBe(true)
    expect(c2024.account).toBeNull()

    // Financement : compte rapproché, montants réels.
    expect(c2022.electionLabel).toBe('Élections législatives 2022')
    expect(c2022.account.declaredExpenses).toBe(1000)
    expect(c2022.account.declaredIncome).toBe(1200)

    // Absence explicite, jamais un zéro : cette candidature CNCCFP n'a ni
    // tour ni voix ; `elected`, lui, n'est jamais `null` (défaut à `false`).
    expect(c2022.round).toBeNull()
    expect(c2022.votes).toBeNull()
    expect(c2022.votePctRegistered).toBeNull()
    expect(c2022.votePctExpressed).toBeNull()
    expect(c2022.elected).toBe(false)

    // Sources : la chaîne provenance → import_run → dataset_resource → dataset → source.
    expect(deputy.sources).toEqual([{ sourceId: 'AN', label: 'Assemblée nationale' }])
  })

  it('renvoie null pour un slug dont le préfixe AN ne correspond à personne', async () => {
    const { body } = await testApp.graphql(`{ deputy(slug: "pa999999-personne") { id } }`)
    expect(body.errors).toBeUndefined()
    expect((body.data as any).deputy).toBeNull()
  })

  it('résout le même député quel que soit le nom accolé au préfixe AN — le slug n’est fiable que sur ce préfixe', async () => {
    const { body } = await testApp.graphql(`{ deputy(slug: "pa000001-nimporte-quoi") { id } }`)
    expect(body.errors).toBeUndefined()
    expect((body.data as any).deputy.id).toBe(fixture.alice.id)
  })

  it(
    'point 2 de la tâche : un député sans compte de campagne rattaché montre une absence, jamais un zéro',
    async () => {
      const { body } = await testApp.graphql(
        `query($slug: String!) { deputy(slug: $slug) { candidacies { account { declaredExpenses } } } }`,
        { slug: fixture.bob.slug },
      )
      expect(body.errors).toBeUndefined()
      const deputy = (body.data as any).deputy
      // Absence explicite : liste vide, pas une candidature avec un compte à 0.
      expect(deputy.candidacies).toEqual([])
    },
  )
})
