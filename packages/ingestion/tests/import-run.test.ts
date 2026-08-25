import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { openImportRun, closeImportRun, recordRejection } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ResourceDescriptor } from '../src/contract.js'

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

describe('openImportRun', () => {
  it('crée source, dataset, ressource et run au premier appel', async () => {
    const run = await openImportRun(prisma, descriptor, 'abc123')
    expect(run).not.toBeNull()
    expect(await prisma.source.count()).toBe(1)
    expect(await prisma.dataset.count()).toBe(1)
    expect(await prisma.datasetResource.count()).toBe(1)
  })

  it('renvoie null si le checksum est inchangé depuis un run réussi', async () => {
    const first = await openImportRun(prisma, descriptor, 'abc123')
    if (!first) throw new Error('premier run attendu')
    await closeImportRun(prisma, first, { created: 1, updated: 0, unchanged: 0, rejected: 0, pending: 0 })

    const second = await openImportRun(prisma, descriptor, 'abc123')
    expect(second).toBeNull()
  })

  it('ouvre un nouveau run si le checksum change', async () => {
    const first = await openImportRun(prisma, descriptor, 'abc123')
    if (!first) throw new Error('premier run attendu')
    await closeImportRun(prisma, first, { created: 1, updated: 0, unchanged: 0, rejected: 0, pending: 0 })

    const second = await openImportRun(prisma, descriptor, 'def456')
    expect(second).not.toBeNull()
  })

  it('ne réutilise pas un run précédent resté en échec', async () => {
    const first = await openImportRun(prisma, descriptor, 'abc123')
    if (!first) throw new Error('premier run attendu')
    await prisma.importRun.update({ where: { id: first.id }, data: { status: 'FAILED' } })

    const second = await openImportRun(prisma, descriptor, 'abc123')
    expect(second).not.toBeNull()
  })

  it('réutilise source et dataset existants sans les dupliquer', async () => {
    const first = await openImportRun(prisma, descriptor, 'abc123')
    if (!first) throw new Error('premier run attendu')
    await closeImportRun(prisma, first, { created: 0, updated: 0, unchanged: 0, rejected: 0, pending: 0 })
    await openImportRun(prisma, descriptor, 'def456')

    expect(await prisma.source.count()).toBe(1)
    expect(await prisma.dataset.count()).toBe(1)
    expect(await prisma.datasetResource.count()).toBe(1)
    expect(await prisma.importRun.count()).toBe(2)
  })
})

describe('closeImportRun', () => {
  it('enregistre les compteurs et marque le run comme réussi', async () => {
    const run = await openImportRun(prisma, descriptor, 'abc123')
    if (!run) throw new Error('run attendu')
    await closeImportRun(prisma, run, {
      created: 3, updated: 2, unchanged: 1, rejected: 4, pending: 5,
    })

    const stored = await prisma.importRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(stored.status).toBe('SUCCEEDED')
    expect(stored.created).toBe(3)
    expect(stored.updated).toBe(2)
    expect(stored.unchanged).toBe(1)
    expect(stored.rejected).toBe(4)
    expect(stored.pending).toBe(5)
    expect(stored.finishedAt).not.toBeNull()
  })
})

describe('recordRejection', () => {
  it('trace une ligne rejetée sans lever d’exception', async () => {
    const run = await openImportRun(prisma, descriptor, 'abc123')
    if (!run) throw new Error('run attendu')
    await recordRejection(prisma, run, {
      bronzeTable: 'an_acteur_raw',
      bronzeRef: 'json/acteur/PA1.json',
      code: 'MISSING_UID',
      message: 'uid absent',
    })
    expect(await prisma.importRejection.count()).toBe(1)
  })
})
