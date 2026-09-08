import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { stageGeo } from '../src/adapters/geo/stage-geo.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ResourceDescriptor } from '../src/contract.js'

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

async function freshRun() {
  const run = await openImportRun(prisma, descriptor, 'checksum-geo')
  if (!run) throw new Error('run attendu')
  return run
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('stageGeo', () => {
  it('insère une ligne bronze par entité, y compris celle au code vide', async () => {
    const run = await freshRun()
    const rapport = await stageGeo(prisma, FIXTURE, run)

    expect(rapport.staged).toBe(6)
    const lignes = await prisma.geoCirconscriptionRaw.count({ where: { importRunId: run.id } })
    expect(lignes).toBe(6)
  })

  it('numérote les lignes à partir de 1, utilisées comme référence bronze', async () => {
    const run = await freshRun()
    await stageGeo(prisma, FIXTURE, run)

    const lignes = await prisma.geoCirconscriptionRaw.findMany({
      where: { importRunId: run.id },
      orderBy: { ligne: 'asc' },
    })
    expect(lignes.map((l) => l.ligne)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('conserve les codes tels que publiés, sans traduction', async () => {
    const run = await freshRun()
    await stageGeo(prisma, FIXTURE, run)

    const ligne = await prisma.geoCirconscriptionRaw.findFirst({
      where: { importRunId: run.id, codeCirconscription: 'ZD07' },
    })
    expect(ligne?.codeDepartement).toBe('ZD')
    expect(ligne?.nomDepartement).toBe('La Réunion')
  })

  it('conserve la géométrie sans la simplifier ni la reprojeter', async () => {
    const run = await freshRun()
    await stageGeo(prisma, FIXTURE, run)

    const ligne = await prisma.geoCirconscriptionRaw.findFirst({
      where: { importRunId: run.id, codeCirconscription: '7506' },
    })
    expect((ligne?.geometry as any).type).toBe('MultiPolygon')
    expect((ligne?.geometry as any).coordinates[0][0][0]).toEqual([2.3, 48.85])
  })

  it('charge aussi l’entité au code vide : bronze est fidèle à ce qui a été publié', async () => {
    const run = await freshRun()
    await stageGeo(prisma, FIXTURE, run)

    const ligne = await prisma.geoCirconscriptionRaw.findFirst({
      where: { importRunId: run.id, nomDepartement: 'Inconnu' },
    })
    expect(ligne).not.toBeNull()
    expect(ligne?.codeCirconscription).toBeNull()
  })

  it('est rejouable dans le même run sans créer de doublon', async () => {
    const run = await freshRun()
    await stageGeo(prisma, FIXTURE, run)
    await stageGeo(prisma, FIXTURE, run)

    const lignes = await prisma.geoCirconscriptionRaw.count({ where: { importRunId: run.id } })
    expect(lignes).toBe(6)
  })
})
