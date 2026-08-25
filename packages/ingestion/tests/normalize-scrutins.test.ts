import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { normalizeAn } from '../src/adapters/an/normalize.js'
import { normalizeScrutins } from '../src/adapters/an/normalize-scrutins.js'
import { stageActeurs } from '../src/adapters/an/stage-acteurs.js'
import { stageOrganes } from '../src/adapters/an/stage-organes.js'
import { stageScrutins } from '../src/adapters/an/stage-scrutins.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ImportRunRef, ResourceDescriptor } from '../src/contract.js'

const AMO10 = fileURLToPath(new URL('../fixtures/an-amo10-sample.zip', import.meta.url))
const ECLATES = fileURLToPath(new URL('../fixtures/an-scrutins-eclates-sample.zip', import.meta.url))
const prisma = testPrisma()

function descriptor(dataset: string, resource: string): ResourceDescriptor {
  return {
    sourceKey: 'AN',
    datasetExternalId: dataset,
    datasetTitle: dataset,
    resourceExternalId: resource,
    url: `https://example.invalid/${resource}`,
    format: 'zip',
  }
}

/** Met en base les 3 députés de la fixture AMO10, puis stage les scrutins. */
async function prepare(): Promise<ImportRunRef> {
  const acteurs = await openImportRun(prisma, descriptor('amo10-17', 'AMO10.zip'), 'c-acteurs')
  if (!acteurs) throw new Error('run acteurs attendu')
  await stageOrganes(prisma, AMO10, acteurs)
  await stageActeurs(prisma, AMO10, acteurs)
  await normalizeAn(prisma, acteurs)

  const scrutins = await openImportRun(prisma, descriptor('scrutins-17', 'Scrutins.zip'), 'c-scr')
  if (!scrutins) throw new Error('run scrutins attendu')
  await stageScrutins(prisma, ECLATES, scrutins)
  return scrutins
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('normalizeScrutins', () => {
  it('crée un scrutin par ligne bronze', async () => {
    const run = await prepare()
    await normalizeScrutins(prisma, run)

    expect(await prisma.parliamentaryBallot.count()).toBe(5)
  })

  it('recopie les décomptes officiels en nombres', async () => {
    const run = await prepare()
    await normalizeScrutins(prisma, run)

    const ballot = await prisma.parliamentaryBallot.findFirstOrThrow({
      where: { number: '2657' },
    })
    expect(ballot.officialFor).toBe(121)
    expect(ballot.officialAgainst).toBe(23)
    expect(ballot.officialAbstention).toBe(0)
    expect(ballot.officialNonVoting).toBe(2)
    expect(ballot.date).toBeInstanceOf(Date)
    expect(ballot.date?.toISOString().slice(0, 10)).toBe('2025-06-24')
    expect(ballot.publicationMode).toBe('DecompteNominatif')
  })

  it('rattache le scrutin à sa législature', async () => {
    const run = await prepare()
    await normalizeScrutins(prisma, run)

    const ballots = await prisma.parliamentaryBallot.findMany()
    expect(ballots.every((b) => b.legislatureId !== null)).toBe(true)
  })

  it('n’écrit que les positions des députés connus', async () => {
    const run = await prepare()
    const report = await normalizeScrutins(prisma, run)

    // Seuls les 3 députés de la fixture AMO10 sont en base ; les autres votants
    // restent en bronze et sont comptés en attente plutôt que perdus.
    expect(await prisma.ballotPosition.count()).toBe(4)
    expect(report.pending).toBe(1292 - 4)
  })

  it('n’enregistre que des positions valides', async () => {
    const run = await prepare()
    await normalizeScrutins(prisma, run)

    const positions = await prisma.ballotPosition.findMany()
    expect(
      positions.every((p) => ['POUR', 'CONTRE', 'ABSTENTION', 'NON_VOTANT'].includes(p.position)),
    ).toBe(true)
    expect(positions.every((p) => typeof p.byDelegation === 'boolean')).toBe(true)
  })

  it('enregistre une provenance par scrutin', async () => {
    const run = await prepare()
    await normalizeScrutins(prisma, run)

    for (const ballot of await prisma.parliamentaryBallot.findMany()) {
      const provenance = await prisma.provenance.findFirst({
        where: { entityType: 'ParliamentaryBallot', entityId: ballot.id },
      })
      expect(provenance?.bronzeTable).toBe('an_scrutin_raw')
      expect(provenance?.status).toBe('OFFICIAL')
    }
  })

  it('les compteurs de positions sont fiables sur un rejeu', async () => {
    const run = await prepare()

    // `created` compte toutes les entités silver écrites, scrutins ET positions
    // confondus : 5 scrutins + 4 positions au premier passage. Au second, les
    // scrutins existent déjà (ils passent en `updated`) et les 4 positions
    // entrent en collision, d'où 0 création et 4 inchangées.
    const first = await normalizeScrutins(prisma, run)
    expect(first.created).toBe(9)
    expect(first.unchanged).toBe(0)

    const second = await normalizeScrutins(prisma, run)
    expect(second.created).toBe(0)
    expect(second.unchanged).toBe(4)
  })

  it('est idempotent', async () => {
    const run = await prepare()
    await normalizeScrutins(prisma, run)
    const ballots = await prisma.parliamentaryBallot.count()
    const positions = await prisma.ballotPosition.count()
    const provenances = await prisma.provenance.count()

    const second = await normalizeScrutins(prisma, run)
    expect(second.created).toBe(0)
    expect(await prisma.parliamentaryBallot.count()).toBe(ballots)
    expect(await prisma.ballotPosition.count()).toBe(positions)
    expect(await prisma.provenance.count()).toBe(provenances)
  })
})
