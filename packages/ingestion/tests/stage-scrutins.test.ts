import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { stageScrutins } from '../src/adapters/an/stage-scrutins.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ImportRunRef, ResourceDescriptor } from '../src/contract.js'

const ECLATES = fileURLToPath(new URL('../fixtures/an-scrutins-eclates-sample.zip', import.meta.url))
const MONOLITHE = fileURLToPath(
  new URL('../fixtures/an-scrutins-monolithe-sample.zip', import.meta.url),
)
const prisma = testPrisma()

const descriptor: ResourceDescriptor = {
  sourceKey: 'AN',
  datasetExternalId: 'scrutins-17',
  datasetTitle: 'Scrutins — 17e législature',
  resourceExternalId: 'Scrutins.json.zip',
  url: 'https://example.invalid/Scrutins.json.zip',
  format: 'zip',
}

async function freshRun(checksum = 'checksum-scrutins'): Promise<ImportRunRef> {
  const run = await openImportRun(prisma, descriptor, checksum)
  if (!run) throw new Error('run attendu')
  return run
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('stageScrutins', () => {
  it('insère un scrutin par entrée et compte les positions', async () => {
    const run = await freshRun()
    const report = await stageScrutins(prisma, ECLATES, run)

    expect(await prisma.anScrutinRaw.count()).toBe(5)
    expect(await prisma.anPositionRaw.count()).toBe(1292)
    expect(report.staged).toBe(5)
    expect(report.rejected).toBe(0)
  })

  it('lit aussi le conditionnement monolithique de la 14e', async () => {
    const run = await freshRun()
    await stageScrutins(prisma, MONOLITHE, run)

    expect(await prisma.anScrutinRaw.count()).toBe(2)
    expect(await prisma.anPositionRaw.count()).toBe(599)
  })

  it('accepte les clés au singulier comme au pluriel', async () => {
    const run = await freshRun()
    await stageScrutins(prisma, ECLATES, run)

    // VTCGR5L16V1 emploie le singulier (pour/contre), VTANR5L16V2004 le pluriel.
    // Un parseur n'acceptant qu'une forme perdrait l'un des deux en silence.
    expect(await prisma.anPositionRaw.count({ where: { scrutinUid: 'VTCGR5L16V1' } })).toBe(902)
    expect(
      await prisma.anPositionRaw.count({ where: { scrutinUid: 'VTANR5L16V2004' } }),
    ).toBeGreaterThan(0)
  })

  it('conserve les décomptes officiels sans les convertir', async () => {
    const run = await freshRun()
    await stageScrutins(prisma, ECLATES, run)

    const scrutin = await prisma.anScrutinRaw.findFirstOrThrow({
      where: { uid: 'VTANR5L17V2657' },
    })
    expect(scrutin.decomptePour).toBe('121')
    expect(scrutin.decompteContre).toBe('23')
    expect(scrutin.dateScrutin).toBe('2025-06-24')
    expect(scrutin.modePublication).toBe('DecompteNominatif')
    expect(scrutin.legislature).toBe('17')
  })

  it('conserve le groupe politique au moment du vote', async () => {
    const run = await freshRun()
    await stageScrutins(prisma, ECLATES, run)

    const positions = await prisma.anPositionRaw.findMany({
      where: { scrutinUid: 'VTANR5L17V2657' },
      take: 20,
    })
    expect(positions).not.toHaveLength(0)
    expect(positions.every((p) => (p.groupeRef ?? '').startsWith('PO'))).toBe(true)
    expect(positions.every((p) => p.acteurRef.startsWith('PA'))).toBe(true)
  })

  it('conserve le vote par délégation', async () => {
    const run = await freshRun()
    await stageScrutins(prisma, ECLATES, run)

    expect(await prisma.anPositionRaw.count({ where: { parDelegation: 'true' } })).toBe(44)
  })

  it('répartit les positions dans les quatre catégories', async () => {
    const run = await freshRun()
    await stageScrutins(prisma, ECLATES, run)

    const parCategorie = await prisma.anPositionRaw.groupBy({
      by: ['categorie'],
      _count: { _all: true },
    })
    const total = Object.fromEntries(parCategorie.map((c) => [c.categorie, c._count._all]))
    expect(total).toEqual({ POUR: 1086, CONTRE: 147, ABSTENTION: 53, NON_VOTANT: 6 })
  })

  it('est rejouable sans doublon dans le même run', async () => {
    const run = await freshRun()
    await stageScrutins(prisma, ECLATES, run)
    await stageScrutins(prisma, ECLATES, run)

    expect(await prisma.anScrutinRaw.count()).toBe(5)
    expect(await prisma.anPositionRaw.count()).toBe(1292)
  })
})
