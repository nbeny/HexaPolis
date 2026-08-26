import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { stageResultats } from '../src/adapters/resultats/stage-resultats.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ResourceDescriptor } from '../src/contract.js'

const T1 = fileURLToPath(new URL('../fixtures/resultats-t1-sample.csv', import.meta.url))
const T2 = fileURLToPath(new URL('../fixtures/resultats-t2-sample.csv', import.meta.url))
const prisma = testPrisma()

const t1Descriptor: ResourceDescriptor = {
  sourceKey: 'DATA_GOUV',
  datasetExternalId: 'legislatives-2024-t1',
  datasetTitle: 'Résultats définitifs — Législatives 2024, 1er tour',
  resourceExternalId: 'resultats-definitifs-par-circonscriptions-legislatives.csv',
  url: 'https://example.invalid/t1.csv',
  format: 'csv',
}

const t2Descriptor: ResourceDescriptor = {
  sourceKey: 'DATA_GOUV',
  datasetExternalId: 'legislatives-2024-t2',
  datasetTitle: 'Résultats définitifs — Législatives 2024, 2nd tour',
  resourceExternalId: 'resultats-definitifs-par-circonscription.csv',
  url: 'https://example.invalid/t2.csv',
  format: 'csv',
}

async function freshRun(descriptor: ResourceDescriptor, checksum: string) {
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

describe('stageResultats', () => {
  it('insère une ligne bronze par candidat dépivoté : 28 pour la fixture du 1er tour (19 + 5 + 4)', async () => {
    const run = await freshRun(t1Descriptor, 't1-checksum')
    const report = await stageResultats(prisma, T1, run)

    expect(report.staged).toBe(28)
    expect(report.rejected).toBe(0)
    expect(await prisma.electionResultRaw.count()).toBe(28)
  })

  it('insère 8 lignes bronze pour la fixture du 2nd tour (2 + 2 + 4)', async () => {
    const run = await freshRun(t2Descriptor, 't2-checksum')
    const report = await stageResultats(prisma, T2, run)

    expect(report.staged).toBe(8)
    expect(await prisma.electionResultRaw.count()).toBe(8)
  })

  it('un bloc dont le nom est vide ne produit aucune ligne bronze : circo 205 (5 candidats sur 19 blocs) n’en produit que 5', async () => {
    const run = await freshRun(t1Descriptor, 't1-checksum')
    await stageResultats(prisma, T1, run)

    const rows = await prisma.electionResultRaw.findMany({ where: { codeCirconscription: '205' } })
    expect(rows).toHaveLength(5)
  })

  it('(ligne, rang) sert de référence bronze, unique par run', async () => {
    const run = await freshRun(t1Descriptor, 't1-checksum')
    await stageResultats(prisma, T1, run)

    const rows = await prisma.electionResultRaw.findMany({ where: { codeCirconscription: '901' }, orderBy: { rang: 'asc' } })
    expect(rows.map((r) => r.rang)).toEqual([1, 2, 3, 4])
    expect(rows.every((r) => r.ligne === rows[0]?.ligne)).toBe(true)
  })

  it('les voix et les pourcentages sont rendus tels quels, en chaînes, sans conversion', async () => {
    const run = await freshRun(t2Descriptor, 't2-checksum')
    await stageResultats(prisma, T2, run)

    const breton = await prisma.electionResultRaw.findFirstOrThrow({ where: { nom: 'BRETON' } })
    expect(breton.voix).toBe('33889')
    expect(typeof breton.voix).toBe('string')
    expect(breton.pctInscrits).toBe('39,02%')
    expect(breton.pctExprimes).toBe('56,48%')
  })

  it('conserve le code circonscription tel que publié, y compris la forme courte du 1er tour', async () => {
    const run = await freshRun(t1Descriptor, 't1-checksum')
    await stageResultats(prisma, T1, run)

    const row = await prisma.electionResultRaw.findFirstOrThrow({ where: { codeCirconscription: '901' } })
    expect(row.codeDepartement).toBe('9')
  })

  it('est rejouable dans le même run sans créer de doublon', async () => {
    const run = await freshRun(t1Descriptor, 't1-checksum')
    await stageResultats(prisma, T1, run)
    await stageResultats(prisma, T1, run)

    expect(await prisma.electionResultRaw.count()).toBe(28)
  })
})
