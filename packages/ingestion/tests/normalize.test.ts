import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { normalizeAn } from '../src/adapters/an/normalize.js'
import { stageActeurs } from '../src/adapters/an/stage-acteurs.js'
import { stageOrganes } from '../src/adapters/an/stage-organes.js'
import { openImportRun } from '../src/run/import-run.js'
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

async function stageFixture(checksum: string): Promise<ImportRunRef> {
  const run = await openImportRun(prisma, descriptor, checksum)
  if (!run) throw new Error('run attendu')
  await stageOrganes(prisma, FIXTURE, run)
  await stageActeurs(prisma, FIXTURE, run)
  return run
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('normalizeAn', () => {
  it('crée une Person par acteur staged', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    expect(await prisma.person.count()).toBe(3)
  })

  it('attache un ExternalIdentifier AN à chaque personne', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    const identifiers = await prisma.externalIdentifier.findMany({
      where: { sourceId: 'AN', kind: 'ACTEUR_UID', ownerType: 'Person' },
    })
    expect(identifiers).toHaveLength(3)
    expect(identifiers.every((i) => i.value.startsWith('PA'))).toBe(true)
  })

  it('retire le qualificatif de désambiguïsation de la clé de rapprochement', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    // L'AN publie `Martin (Alpes-Maritimes)` pour distinguer deux députées homonymes.
    // Le nom affiché conserve le qualificatif, la clé de rapprochement ne le porte pas :
    // c'est ce qui permettra à une autre source publiant « MARTIN Alexandra » de correspondre.
    const martin = await prisma.person.findFirstOrThrow({ where: { firstName: 'Alexandra' } })
    expect(martin.lastName).toMatch(/^Martin \(/)
    expect(martin.matchKey).toBe('alexandra|martin')
  })

  it('crée un Body par organe modélisé, et rien pour les autres', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    expect(await prisma.body.count()).toBe(8)
    expect(await prisma.body.count({ where: { type: 'PARLIAMENTARY_GROUP' } })).toBe(2)
    expect(await prisma.body.count({ where: { type: 'COMMITTEE' } })).toBe(4)
    expect(await prisma.body.count({ where: { type: 'DELEGATION' } })).toBe(2)
  })

  it('crée un Territory par circonscription, jamais un Body', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    expect(await prisma.territory.count({ where: { type: 'CIRCONSCRIPTION' } })).toBe(3)
    expect(await prisma.body.count({ where: { type: 'CIRCONSCRIPTION' } })).toBe(0)
  })

  it('crée un mandat parlementaire par député, rattaché à sa circonscription', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    const mandats = await prisma.mandate.findMany({ where: { kind: 'PARLIAMENTARY' } })
    expect(mandats).toHaveLength(3)
    expect(mandats.every((m) => m.territoryId !== null)).toBe(true)
    expect(mandats.every((m) => m.legislatureId !== null)).toBe(true)
  })

  it('crée les appartenances aux groupes et commissions', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    expect(await prisma.bodyMembership.count()).toBe(8)
  })

  it('ne rattache pas les adhésions à un parti à une institution parlementaire', async () => {
    const run = await stageFixture('c1')
    const report = await normalizeAn(prisma, run)

    // PARPOL attend l'entité PoliticalParty (plan 3) plutôt que d'être écrit au mauvais endroit.
    expect(await prisma.mandate.count({ where: { kind: 'PARTY_AFFILIATION' } })).toBe(0)
    expect(report.pending).toBeGreaterThanOrEqual(3)
  })

  it('convertit en Date toute date de naissance présente en bronze', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    const raws = await prisma.anActeurRaw.findMany({ where: { dateNais: { not: null } } })
    expect(raws.length).toBeGreaterThan(0)

    for (const raw of raws) {
      const identifier = await prisma.externalIdentifier.findUnique({
        where: { sourceId_kind_value: { sourceId: 'AN', kind: 'ACTEUR_UID', value: raw.uid } },
      })
      if (!identifier) throw new Error(`identifiant manquant pour ${raw.uid}`)

      const person = await prisma.person.findUnique({ where: { id: identifier.ownerId } })
      expect(person?.birthDate).toBeInstanceOf(Date)
      expect(person?.birthDate?.toISOString().slice(0, 10)).toBe(raw.dateNais)
    }
  })

  it('enregistre une provenance pour chaque personne et chaque mandat', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    for (const person of await prisma.person.findMany()) {
      const provenance = await prisma.provenance.findFirst({
        where: { entityType: 'Person', entityId: person.id },
      })
      expect(provenance?.bronzeTable).toBe('an_acteur_raw')
      expect(provenance?.importRunId).toBe(run.id)
      expect(provenance?.status).toBe('OFFICIAL')
    }

    for (const mandate of await prisma.mandate.findMany()) {
      const provenance = await prisma.provenance.findFirst({
        where: { entityType: 'Mandate', entityId: mandate.id },
      })
      expect(provenance?.bronzeTable).toBe('an_mandat_raw')
    }
  })

  it('est idempotent : renormaliser ne crée aucune entité supplémentaire', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    const counts = {
      person: await prisma.person.count(),
      body: await prisma.body.count(),
      territory: await prisma.territory.count(),
      mandate: await prisma.mandate.count(),
      membership: await prisma.bodyMembership.count(),
      provenance: await prisma.provenance.count(),
    }

    const second = await normalizeAn(prisma, run)
    expect(second.created).toBe(0)

    expect(await prisma.person.count()).toBe(counts.person)
    expect(await prisma.body.count()).toBe(counts.body)
    expect(await prisma.territory.count()).toBe(counts.territory)
    expect(await prisma.mandate.count()).toBe(counts.mandate)
    expect(await prisma.bodyMembership.count()).toBe(counts.membership)
    expect(await prisma.provenance.count()).toBe(counts.provenance)
  })

  it('rend compte de toutes les entités écrites, création puis mise à jour', async () => {
    const run = await stageFixture('c1')
    const first = await normalizeAn(prisma, run)

    // 8 Body + 3 Person + 3 Mandate + 8 BodyMembership.
    expect(first.created).toBe(22)
    expect(first.updated).toBe(0)
    expect(first.unchanged).toBe(0)
    expect(first.pending).toBeGreaterThanOrEqual(3)

    const second = await normalizeAn(prisma, run)

    expect(second.created).toBe(0)
    // 3 Mandate + 8 BodyMembership : réécrits (endDate, quality, territoryId, endCause), donc updated.
    expect(second.updated).toBe(11)
    // 8 Body + 3 Person : laissés strictement inchangés.
    expect(second.unchanged).toBe(11)
  })
})
