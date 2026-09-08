import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { normalizeGeo } from '../src/adapters/geo/normalize-geo.js'
import { stageGeo } from '../src/adapters/geo/stage-geo.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ImportRunRef, ResourceDescriptor } from '../src/contract.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/geo-circonscriptions.json', import.meta.url))
const prisma = testPrisma()

const descriptor: ResourceDescriptor = {
  sourceKey: 'DATA_GOUV',
  datasetExternalId: 'contours-circonscriptions-legislatives',
  datasetTitle: 'Contours géographiques des circonscriptions législatives',
  resourceExternalId: 'circonscriptions-legislatives-p20.geojson',
  url: 'https://example.invalid/circonscriptions-legislatives-p20.geojson',
  format: 'geojson',
}

async function freshRun(): Promise<ImportRunRef> {
  const run = await openImportRun(prisma, descriptor, 'checksum-geo')
  if (!run) throw new Error('run attendu')
  await stageGeo(prisma, FIXTURE, run)
  return run
}

/**
 * Trois territoires couvrant les cas distingués par la normalisation :
 * - `93-10` → `9310` : traduit, et la fixture porte bien cette ligne bronze.
 * - `75-99` → `7599` : traduit, mais aucune ligne bronze ne porte ce code —
 *   on attendait un contour et on ne l'a pas trouvé.
 * - `099-1` : la traduction rend `null`, la source ne cartographie pas les
 *   Français de l'étranger.
 */
async function seedTerritoires(): Promise<{ couvert: string; attenduMaisAbsent: string; sansContour: string }> {
  const couvert = await prisma.territory.upsert({
    where: { type_code: { type: 'CIRCONSCRIPTION', code: '93-10' } },
    update: {},
    create: { type: 'CIRCONSCRIPTION', code: '93-10', label: '10ème circonscription de la Seine-Saint-Denis' },
  })
  const attenduMaisAbsent = await prisma.territory.upsert({
    where: { type_code: { type: 'CIRCONSCRIPTION', code: '75-99' } },
    update: {},
    create: { type: 'CIRCONSCRIPTION', code: '75-99', label: '99ème circonscription de Paris (test)' },
  })
  const sansContour = await prisma.territory.upsert({
    where: { type_code: { type: 'CIRCONSCRIPTION', code: '099-1' } },
    update: {},
    create: { type: 'CIRCONSCRIPTION', code: '099-1', label: "1ère circonscription des Français de l'étranger" },
  })
  return { couvert: couvert.id, attenduMaisAbsent: attenduMaisAbsent.id, sansContour: sansContour.id }
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('normalizeGeo', () => {
  it('rattache une provenance de géométrie à chaque territoire couvert', async () => {
    const run = await freshRun()
    await seedTerritoires()

    const rapport = await normalizeGeo(prisma, run)
    expect(rapport.created).toBeGreaterThan(0)

    const provenance = await prisma.provenance.findFirst({
      where: { entityType: 'Territory', field: 'geometry', bronzeTable: 'geo_circonscription_raw' },
    })
    expect(provenance).not.toBeNull()
    expect(provenance?.bronzeRef).toBe('4') // 9310 est la 4e entité de la fixture
  })

  it('ne rattache rien aux territoires que la source ne cartographie pas', async () => {
    const run = await freshRun()
    const { sansContour } = await seedTerritoires()

    await normalizeGeo(prisma, run)

    const provenance = await prisma.provenance.count({
      where: { entityType: 'Territory', entityId: sansContour, field: 'geometry' },
    })
    expect(provenance).toBe(0)
  })

  it('compte en pending un territoire dont le contour est attendu mais absent de la source', async () => {
    const run = await freshRun()
    await seedTerritoires()

    const rapport = await normalizeGeo(prisma, run)
    expect(rapport.pending).toBeGreaterThanOrEqual(1)
  })

  it('compte les entités bronze qu’il n’a pas su rattacher plutôt que de les taire', async () => {
    // La sixième entité de la fixture a un code vide : elle ne correspond à
    // aucun territoire et doit ressortir dans `rejected`, pas disparaître.
    const run = await freshRun()
    await seedTerritoires()

    const rapport = await normalizeGeo(prisma, run)
    expect(rapport.rejected).toBeGreaterThanOrEqual(1)
  })

  it('est rejouable sans dupliquer les provenances', async () => {
    const run = await freshRun()
    await seedTerritoires()

    await normalizeGeo(prisma, run)
    const avant = await prisma.provenance.count({ where: { field: 'geometry' } })
    await normalizeGeo(prisma, run)
    const apres = await prisma.provenance.count({ where: { field: 'geometry' } })
    expect(apres).toBe(avant)
    expect(avant).toBeGreaterThan(0)
  })
})
