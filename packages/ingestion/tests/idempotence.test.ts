import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { normalizeAn } from '../src/adapters/an/normalize.js'
import { stageActeurs } from '../src/adapters/an/stage-acteurs.js'
import { stageOrganes } from '../src/adapters/an/stage-organes.js'
import { closeImportRun, openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ImportRunRef, ResourceDescriptor } from '../src/contract.js'

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

/** Déroule le pipeline complet : ouverture, staging, normalisation, clôture. */
async function runFullImport(checksum: string): Promise<ImportRunRef | null> {
  const run = await openImportRun(prisma, descriptor, checksum)
  if (!run) return null
  await stageOrganes(prisma, FIXTURE, run)
  await stageActeurs(prisma, FIXTURE, run)
  const report = await normalizeAn(prisma, run)
  await closeImportRun(prisma, run, report)
  return run
}

async function snapshot() {
  return {
    person: await prisma.person.count(),
    body: await prisma.body.count(),
    territory: await prisma.territory.count(),
    mandate: await prisma.mandate.count(),
    membership: await prisma.bodyMembership.count(),
    identifier: await prisma.externalIdentifier.count(),
    nameVariant: await prisma.personNameVariant.count(),
  }
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('idempotence du pipeline', () => {
  it('un import complet produit les entités attendues', async () => {
    const run = await runFullImport('identique')
    expect(run).not.toBeNull()

    expect(await snapshot()).toEqual({
      person: 3,
      body: 8,
      territory: 3,
      mandate: 3,
      membership: 8,
      identifier: 11,
      nameVariant: 3,
    })
  })

  it('un second import au même checksum est refusé et ne modifie rien', async () => {
    await runFullImport('identique')
    const before = await snapshot()

    const second = await runFullImport('identique')
    expect(second).toBeNull()

    expect(await snapshot()).toEqual(before)
    expect(await prisma.importRun.count()).toBe(1)
  })

  it('un nouveau run sur des données identiques converge sans rien dupliquer', async () => {
    await runFullImport('checksum-v1')
    const before = await snapshot()

    // Checksum différent : l'AN a republié le fichier, mais son contenu n'a pas changé.
    const second = await runFullImport('checksum-v2')
    expect(second).not.toBeNull()

    expect(await snapshot()).toEqual(before)
    expect(await prisma.importRun.count()).toBe(2)
  })

  it('le rapport du second run ne déclare aucune création', async () => {
    await runFullImport('checksum-v1')

    const run = await openImportRun(prisma, descriptor, 'checksum-v2')
    if (!run) throw new Error('run attendu')
    await stageOrganes(prisma, FIXTURE, run)
    await stageActeurs(prisma, FIXTURE, run)
    const report = await normalizeAn(prisma, run)

    expect(report.created).toBe(0)
    expect(report.unchanged).toBe(11)
    expect(report.updated).toBe(11)
  })

  it('les compteurs stockés du premier run décrivent ce qui a été écrit', async () => {
    const run = await runFullImport('identique')
    if (!run) throw new Error('run attendu')

    const stored = await prisma.importRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(stored.status).toBe('SUCCEEDED')
    expect(stored.created).toBe(22)
    expect(stored.rejected).toBe(0)
    expect(stored.finishedAt).not.toBeNull()
  })
})
