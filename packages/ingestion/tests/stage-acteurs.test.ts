import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { stageActeurs } from '../src/adapters/an/stage-acteurs.js'
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

async function freshRun() {
  const run = await openImportRun(prisma, descriptor, 'checksum-acteurs')
  if (!run) throw new Error('run attendu')
  return run
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('stageActeurs', () => {
  it('insère une ligne bronze par acteur', async () => {
    const run = await freshRun()
    const report = await stageActeurs(prisma, FIXTURE, run)

    expect(report.staged).toBe(3)
    expect(report.rejected).toBe(0)
    expect(await prisma.anActeurRaw.count()).toBe(3)
  })

  it('extrait l’uid depuis le noeud typé', async () => {
    const run = await freshRun()
    await stageActeurs(prisma, FIXTURE, run)

    const rows = await prisma.anActeurRaw.findMany()
    expect(rows.every((r) => r.uid.startsWith('PA'))).toBe(true)
  })

  it('conserve les dates sous forme de chaînes, sans conversion', async () => {
    const run = await freshRun()
    await stageActeurs(prisma, FIXTURE, run)

    const withBirth = await prisma.anActeurRaw.findFirst({ where: { dateNais: { not: null } } })
    expect(withBirth?.dateNais).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('conserve le nom tel que publié, qualificatif compris', async () => {
    const run = await freshRun()
    await stageActeurs(prisma, FIXTURE, run)

    // L'AN désambiguïse deux députées homonymes par le département dans le champ `nom`.
    // Bronze doit le conserver tel quel : c'est la normalisation qui le retirera.
    const martin = await prisma.anActeurRaw.findFirst({ where: { prenom: 'Alexandra' } })
    expect(martin?.nom).toMatch(/^Martin \(/)
  })

  it('éclate les mandats de chaque acteur dans an_mandat_raw', async () => {
    const run = await freshRun()
    await stageActeurs(prisma, FIXTURE, run)

    expect(await prisma.anMandatRaw.count()).toBe(44)

    const parlementaire = await prisma.anMandatRaw.findFirst({
      where: { typeOrgane: 'ASSEMBLEE' },
    })
    expect(parlementaire?.acteurRef).toMatch(/^PA/)
  })

  it('rattache chaque mandat à un acteur effectivement staged', async () => {
    const run = await freshRun()
    await stageActeurs(prisma, FIXTURE, run)

    const acteurUids = new Set(
      (await prisma.anActeurRaw.findMany({ select: { uid: true } })).map((a) => a.uid),
    )
    const mandats = await prisma.anMandatRaw.findMany({ select: { acteurRef: true } })

    expect(mandats.length).toBeGreaterThan(0)
    expect(mandats.every((m) => acteurUids.has(m.acteurRef))).toBe(true)
  })

  it('conserve la circonscription du mandat parlementaire', async () => {
    const run = await freshRun()
    await stageActeurs(prisma, FIXTURE, run)

    const parlementaires = await prisma.anMandatRaw.findMany({
      where: { typeOrgane: 'ASSEMBLEE' },
    })
    expect(parlementaires.length).toBeGreaterThan(0)
    expect(
      parlementaires.every(
        (m) => (m.numCirco ?? '').length > 0 && (m.refCirconscription ?? '').startsWith('PO'),
      ),
    ).toBe(true)
  })

  it('est rejouable sans doublon dans le même run', async () => {
    const run = await freshRun()
    await stageActeurs(prisma, FIXTURE, run)
    await stageActeurs(prisma, FIXTURE, run)

    expect(await prisma.anActeurRaw.count()).toBe(3)
    expect(await prisma.anMandatRaw.count()).toBe(44)
  })
})
