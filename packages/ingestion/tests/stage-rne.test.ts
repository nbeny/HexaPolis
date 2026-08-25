import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { stageRne } from '../src/adapters/rne/stage-rne.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ResourceDescriptor } from '../src/contract.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/rne-deputes-sample.csv', import.meta.url))
const prisma = testPrisma()

const descriptor: ResourceDescriptor = {
  sourceKey: 'RNE',
  datasetExternalId: 'rne-deputes',
  datasetTitle: 'Répertoire national des élus — Députés',
  resourceExternalId: 'elus-depute-dep.csv',
  url: 'https://example.invalid/elus-depute-dep.csv',
  format: 'csv',
}

async function freshRun() {
  const run = await openImportRun(prisma, descriptor, 'checksum-rne')
  if (!run) throw new Error('run attendu')
  return run
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('stageRne', () => {
  it('insère une ligne bronze par député', async () => {
    const run = await freshRun()
    const report = await stageRne(prisma, FIXTURE, run)

    expect(report.staged).toBe(8)
    expect(report.rejected).toBe(0)
    expect(await prisma.rneEluRaw.count()).toBe(8)
  })

  it('numérote les lignes à partir de 1, utilisées comme référence bronze', async () => {
    const run = await freshRun()
    await stageRne(prisma, FIXTURE, run)

    const rows = await prisma.rneEluRaw.findMany({ orderBy: { ligne: 'asc' } })
    expect(rows.map((r) => r.ligne)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('conserve les valeurs telles quelles, sans conversion : la date de naissance reste une chaîne', async () => {
    const run = await freshRun()
    await stageRne(prisma, FIXTURE, run)

    const row = await prisma.rneEluRaw.findFirstOrThrow({ where: { ligne: 1 } })
    expect(row.dateNaissance).toBe('1968-10-25')
    expect(typeof row.dateNaissance).toBe('string')
    expect(row.nom).toBe('MARTIN')
    expect(row.prenom).toBe('Alexandra')
    expect(row.codeCirconscription).toBe('0608')
    expect(row.codeDepartement).toBe('06')
  })

  it('conserve les deux Alexandra Martin comme deux lignes bronze distinctes', async () => {
    const run = await freshRun()
    await stageRne(prisma, FIXTURE, run)

    const martins = await prisma.rneEluRaw.findMany({
      where: { nom: 'MARTIN', prenom: 'Alexandra' },
      orderBy: { ligne: 'asc' },
    })
    expect(martins).toHaveLength(2)
    expect(martins.map((m) => m.dateNaissance)).toEqual(['1968-10-25', '1976-07-28'])
  })

  it('est rejouable dans le même run sans créer de doublon', async () => {
    const run = await freshRun()
    await stageRne(prisma, FIXTURE, run)
    await stageRne(prisma, FIXTURE, run)

    expect(await prisma.rneEluRaw.count()).toBe(8)
  })
})
