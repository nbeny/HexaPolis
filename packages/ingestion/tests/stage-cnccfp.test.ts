import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { stageCnccfp } from '../src/adapters/cnccfp/stage-cnccfp.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ResourceDescriptor } from '../src/contract.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/cnccfp-legislatives-2022-sample.csv', import.meta.url))
const prisma = testPrisma()

const descriptor: ResourceDescriptor = {
  sourceKey: 'CNCCFP',
  datasetExternalId: 'cnccfp-legislatives-2022',
  datasetTitle: 'Comptes de campagne — Législatives 2022',
  resourceExternalId: 'publications-2022-lg.csv',
  url: 'https://example.invalid/publications-2022-lg.csv',
  format: 'csv',
}

async function freshRun() {
  const run = await openImportRun(prisma, descriptor, 'checksum-cnccfp')
  if (!run) throw new Error('run attendu')
  return run
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('stageCnccfp', () => {
  it('insère une ligne bronze par ligne de fichier, y compris la ligne corrompue', async () => {
    const run = await freshRun()
    const report = await stageCnccfp(prisma, FIXTURE, run)

    expect(report.staged).toBe(11)
    expect(report.rejected).toBe(0)
    expect(await prisma.cnccfpCompteRaw.count()).toBe(11)
  })

  it('numérote les lignes à partir de 1, utilisées comme référence bronze', async () => {
    const run = await freshRun()
    await stageCnccfp(prisma, FIXTURE, run)

    const rows = await prisma.cnccfpCompteRaw.findMany({ orderBy: { ligne: 'asc' } })
    expect(rows.map((r) => r.ligne)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('conserve les valeurs telles quelles, sans conversion : la devise CFP et les montants restent des chaînes', async () => {
    const run = await freshRun()
    await stageCnccfp(prisma, FIXTURE, run)

    const cuenot = await prisma.cnccfpCompteRaw.findFirstOrThrow({ where: { ligne: 5 } })
    expect(cuenot.monnaie).toBe('CFP')
    expect(cuenot.depensesDeclarees).toBe('393409')
    expect(typeof cuenot.depensesDeclarees).toBe('string')
    expect(cuenot.nom).toBe('M. CUENOT Guy-Olivier')

    const rousseauDvd = await prisma.cnccfpCompteRaw.findFirstOrThrow({ where: { ligne: 2 } })
    // Un montant absent s'écrit littéralement « - » dans le fichier publié ;
    // le staging ne l'interprète pas, seule la normalisation le fait.
    expect(rousseauDvd.depensesDeclarees).toBe('-')
  })

  it('conserve les accents lus en cp1252 : « GUÉRAUD » ne devient jamais un caractère de remplacement', async () => {
    const run = await freshRun()
    await stageCnccfp(prisma, FIXTURE, run)

    const gueraud = await prisma.cnccfpCompteRaw.findFirstOrThrow({ where: { ligne: 10 } })
    expect(gueraud.nom).toContain('É')
  })

  it('la ligne corrompue (tous les champs à 0) atterrit aussi en bronze : bronze est fidèle à ce qui a été publié', async () => {
    const run = await freshRun()
    await stageCnccfp(prisma, FIXTURE, run)

    const corrompue = await prisma.cnccfpCompteRaw.findFirstOrThrow({ where: { ligne: 7 } })
    expect(corrompue.nom).toBe('0')
    expect(corrompue.candidat).toBe('0')
  })

  it('est rejouable dans le même run sans créer de doublon', async () => {
    const run = await freshRun()
    await stageCnccfp(prisma, FIXTURE, run)
    await stageCnccfp(prisma, FIXTURE, run)

    expect(await prisma.cnccfpCompteRaw.count()).toBe(11)
  })
})
