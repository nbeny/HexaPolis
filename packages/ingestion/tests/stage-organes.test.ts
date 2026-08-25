import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { stageOrganes } from '../src/adapters/an/stage-organes.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ResourceDescriptor } from '../src/contract.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/an-amo10-sample.zip', import.meta.url))
const prisma = testPrisma()

const descriptor: ResourceDescriptor = {
  sourceKey: 'AN',
  datasetExternalId: 'amo10-17',
  datasetTitle: 'Députés actifs, mandats et organes',
  resourceExternalId: 'AMO10.json.zip',
  url: 'https://example.invalid/AMO10.json.zip',
  format: 'zip',
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('stageOrganes', () => {
  it('insère une ligne bronze par organe de la fixture', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-organes')
    if (!run) throw new Error('run attendu')

    const report = await stageOrganes(prisma, FIXTURE, run)

    expect(report.staged).toBe(36)
    expect(report.rejected).toBe(0)
    expect(await prisma.anOrganeRaw.count()).toBe(36)
  })

  it('conserve le codeType et le libellé tels que publiés', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-organes')
    if (!run) throw new Error('run attendu')
    await stageOrganes(prisma, FIXTURE, run)

    const rows = await prisma.anOrganeRaw.findMany()
    expect(rows.every((r) => r.codeType.length > 0)).toBe(true)
    expect(rows.every((r) => r.uid.startsWith('PO'))).toBe(true)
  })

  it('conserve les groupes politiques avec leur libellé abrégé', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-organes')
    if (!run) throw new Error('run attendu')
    await stageOrganes(prisma, FIXTURE, run)

    const groupes = await prisma.anOrganeRaw.findMany({ where: { codeType: 'GP' } })
    expect(groupes).toHaveLength(2)
    expect(groupes.every((g) => (g.libelle ?? '').length > 0)).toBe(true)
    expect(groupes.every((g) => (g.libelleAbrege ?? '').length > 0)).toBe(true)
  })

  it('conserve les circonscriptions avec leur département et leur numéro', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-organes')
    if (!run) throw new Error('run attendu')
    await stageOrganes(prisma, FIXTURE, run)

    const circos = await prisma.anOrganeRaw.findMany({ where: { codeType: 'CIRCONSCRIPTION' } })
    expect(circos).toHaveLength(3)
    expect(circos.every((c) => (c.departementCode ?? '').length > 0)).toBe(true)
    expect(circos.every((c) => (c.numero ?? '').length > 0)).toBe(true)
  })

  it('ne convertit aucune date : les valeurs restent des chaînes brutes', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-organes')
    if (!run) throw new Error('run attendu')
    await stageOrganes(prisma, FIXTURE, run)

    const avecDebut = await prisma.anOrganeRaw.findFirst({ where: { dateDebut: { not: null } } })
    expect(typeof avecDebut?.dateDebut).toBe('string')
    expect(avecDebut?.dateDebut).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('est rejouable sans doublon dans le même run', async () => {
    const run = await openImportRun(prisma, descriptor, 'checksum-organes')
    if (!run) throw new Error('run attendu')
    await stageOrganes(prisma, FIXTURE, run)
    await stageOrganes(prisma, FIXTURE, run)

    expect(await prisma.anOrganeRaw.count()).toBe(36)
  })
})
