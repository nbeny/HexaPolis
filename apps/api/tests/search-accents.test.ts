import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { refreshGold } from '@poligraph/ingestion'
import { createTestApp, type TestApp } from './helpers/app.js'
import { resetDatabase, testPrisma } from './helpers/db.js'

/**
 * Écart 5 du plan p6 (tâche 8) : `GoldRepository.searchCards` faisait un
 * `ILIKE` brut, donc `?q=Corbiere` (sans accent) ne trouvait pas Alexis
 * Corbière. Sur un site français, ça se lit comme une absence de donnée,
 * pas comme une variante orthographique. Fixture minimale et dédiée plutôt
 * que `seedFiche` : ni Alice ni Bob ne portent de diacritique, et ajouter
 * une troisième personne à cette fixture partagée casserait les comptes
 * exacts (`totalCount`, pagination) que d'autres fichiers de test vérifient.
 */
const prisma = testPrisma()
let testApp: TestApp

beforeAll(async () => {
  await resetDatabase(prisma)

  const institution = await prisma.institution.create({
    data: { code: 'ASSEMBLEE_NATIONALE', label: 'Assemblée nationale' },
  })
  const legislature17 = await prisma.legislature.create({ data: { number: 17 } })
  const territory = await prisma.territory.create({
    data: { type: 'CIRCONSCRIPTION', code: '93-1', label: '1ère circonscription de la Seine-Saint-Denis' },
  })

  const corbiere = await prisma.person.create({
    data: {
      displayName: 'Alexis Corbière',
      firstName: 'Alexis',
      lastName: 'Corbière',
      matchKey: 'alexis|corbiere',
    },
  })
  await prisma.externalIdentifier.create({
    data: { ownerType: 'Person', ownerId: corbiere.id, sourceId: 'AN', kind: 'ACTEUR_UID', value: 'PA721210' },
  })
  await prisma.mandate.create({
    data: {
      naturalKey: 'mandate-corbiere-17',
      personId: corbiere.id,
      institutionId: institution.id,
      legislatureId: legislature17.id,
      territoryId: territory.id,
      kind: 'PARLIAMENTARY',
      startDate: new Date('2024-07-08T00:00:00Z'),
      endDate: null,
    },
  })

  await refreshGold(prisma)
  testApp = await createTestApp(prisma)
})

afterAll(async () => {
  await testApp.close()
  await prisma.$disconnect()
})

describe('Query.search — insensibilité aux accents', () => {
  it('une requête sans accent trouve un nom accentué', async () => {
    const { body } = await testApp.graphql(`{ search(query: "Corbiere", first: 5) { displayName } }`)
    expect(body.errors).toBeUndefined()
    expect((body.data as any).search).toEqual([{ displayName: 'Alexis Corbière' }])
  })

  it('une requête accentuée trouve le même nom (et continue de fonctionner sans regression)', async () => {
    const { body } = await testApp.graphql(`{ search(query: "Corbière", first: 5) { displayName } }`)
    expect(body.errors).toBeUndefined()
    expect((body.data as any).search).toEqual([{ displayName: 'Alexis Corbière' }])
  })

  it('une requête accentuée trouve aussi une variante mal accentuée de la requête', async () => {
    // Sens symétrique : la casse « saisie accentuée, orthographe différente
    // en base » n'existe pas ici (une seule personne), donc on vérifie plutôt
    // qu'un accent différent de celui du nom (aigu vs grave) matche toujours,
    // preuve que la comparaison passe bien par `unaccent()` des deux côtés.
    const { body } = await testApp.graphql(`{ search(query: "Corbiére", first: 5) { displayName } }`)
    expect(body.errors).toBeUndefined()
    expect((body.data as any).search).toEqual([{ displayName: 'Alexis Corbière' }])
  })
})
