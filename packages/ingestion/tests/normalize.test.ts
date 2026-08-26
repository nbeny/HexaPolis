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

  it('lit la date de prise de fonction dans mandature.datePriseFonction, sans écraser la date de début', async () => {
    const run = await stageFixture('c1')
    await normalizeAn(prisma, run)

    // PA368 : l'AN publie `dateDebut = 2025-09-28` (ouverture du mandat du
    // siège) et `mandature.datePriseFonction = 2025-09-29` (entrée en fonction
    // de la personne). Les deux sont vraies et répondent à deux questions
    // différentes ; silver porte les deux.
    const identifier = await prisma.externalIdentifier.findUniqueOrThrow({
      where: { sourceId_kind_value: { sourceId: 'AN', kind: 'ACTEUR_UID', value: 'PA368' } },
    })
    const mandat = await prisma.mandate.findFirstOrThrow({
      where: { personId: identifier.ownerId, kind: 'PARLIAMENTARY' },
    })

    expect(mandat.startDate).toEqual(new Date('2025-09-28T00:00:00Z'))
    expect(mandat.takingOfficeDate).toEqual(new Date('2025-09-29T00:00:00Z'))
  })

  it("laisse la date de prise de fonction nulle quand la source ne la publie pas, sans perdre le mandat", async () => {
    const run = await stageFixture('c1')

    // Mandat parlementaire sans `datePriseFonction` : le cas se produit sur
    // les législatures anciennes, et il ne doit ni faire échouer la
    // normalisation ni se voir attribuer une date d'entrée en fonction
    // inventée. C'est `gold.deputy_card` qui décide de retomber sur
    // `start_date`, pas silver.
    await prisma.anMandatRaw.create({
      data: {
        importRunId: run.id,
        uid: 'PM_TEST_SANS_PRISE_FONCTION',
        acteurRef: 'PA368',
        typeOrgane: 'ASSEMBLEE',
        legislature: '15',
        dateDebut: '2017-06-21',
        payload: {},
      },
    })

    await normalizeAn(prisma, run)

    const identifier = await prisma.externalIdentifier.findUniqueOrThrow({
      where: { sourceId_kind_value: { sourceId: 'AN', kind: 'ACTEUR_UID', value: 'PA368' } },
    })
    const mandat = await prisma.mandate.findFirstOrThrow({
      where: {
        personId: identifier.ownerId,
        kind: 'PARLIAMENTARY',
        startDate: new Date('2017-06-21T00:00:00Z'),
      },
    })

    expect(mandat.takingOfficeDate).toBeNull()
    expect(mandat.startDate).toEqual(new Date('2017-06-21T00:00:00Z'))
  })

  it("retient la plus ancienne prise de fonction et le dernier état publié quand plusieurs mandats partagent la clé naturelle", async () => {
    const run = await stageFixture('c1')

    // Cas réel : un député élu aux générales, nommé au gouvernement, puis
    // reprenant son mandat. L'AN publie deux mandats de même `dateDebut`, qui
    // partagent donc la clé naturelle et se fondent en une seule ligne silver.
    // La ligne fusionnée doit ouvrir sa fenêtre au plus tôt — sans quoi le
    // premier passage à l'Assemblée disparaîtrait du dénominateur — et porter
    // la fin du dernier mandat publié — sans quoi un député en exercice
    // apparaîtrait comme sorti.
    //
    // Les deux lignes sont créées dans l'ordre « le plus récent d'abord »,
    // exactement l'ordre qui produisait le mauvais résultat quand la lecture
    // suivait l'ordre physique des lignes.
    await prisma.anMandatRaw.createMany({
      data: [
        {
          importRunId: run.id,
          uid: 'PM_TEST_REPRISE',
          acteurRef: 'PA368',
          typeOrgane: 'ASSEMBLEE',
          legislature: '15',
          dateDebut: '2016-01-01',
          datePriseFonction: '2016-09-01',
          dateFin: null,
          payload: {},
        },
        {
          importRunId: run.id,
          uid: 'PM_TEST_PREMIER_PASSAGE',
          acteurRef: 'PA368',
          typeOrgane: 'ASSEMBLEE',
          legislature: '15',
          dateDebut: '2016-01-01',
          datePriseFonction: '2016-01-02',
          dateFin: '2016-06-30',
          causeFin: 'Nomination comme membre du Gouvernement',
          payload: {},
        },
      ],
    })

    await normalizeAn(prisma, run)

    const identifier = await prisma.externalIdentifier.findUniqueOrThrow({
      where: { sourceId_kind_value: { sourceId: 'AN', kind: 'ACTEUR_UID', value: 'PA368' } },
    })
    const mandats = await prisma.mandate.findMany({
      where: {
        personId: identifier.ownerId,
        kind: 'PARLIAMENTARY',
        startDate: new Date('2016-01-01T00:00:00Z'),
      },
    })

    // La clé naturelle n'est pas modifiée (spec §6.2) : une seule ligne.
    expect(mandats).toHaveLength(1)
    expect(mandats[0]?.takingOfficeDate).toEqual(new Date('2016-01-02T00:00:00Z'))
    expect(mandats[0]?.endDate).toBeNull()
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

  it("conserve séparément l'appartenance et la fonction dans un même organe", async () => {
    const run = await stageFixture('c1')

    // L'AN publie deux mandats distincts quand un député est à la fois membre
    // et titulaire d'une fonction (ex. président) d'un même organe, à la
    // même date. Sur les vraies données, 59 de ces paires se sont révélées
    // écrasées silencieusement par un naturalKey de BodyMembership qui
    // n'incluait pas la qualité : le second upsert remplaçait le premier.
    await prisma.anMandatRaw.createMany({
      data: [
        {
          importRunId: run.id,
          uid: 'PM_TEST_MEMBRE',
          acteurRef: 'PA368',
          typeOrgane: 'COMPER',
          organeRef: 'PO59047',
          dateDebut: '2026-01-01',
          codeQualite: 'Membre',
          payload: {},
        },
        {
          importRunId: run.id,
          uid: 'PM_TEST_PRESIDENT',
          acteurRef: 'PA368',
          typeOrgane: 'COMPER',
          organeRef: 'PO59047',
          dateDebut: '2026-01-01',
          codeQualite: 'Président',
          payload: {},
        },
      ],
    })

    await normalizeAn(prisma, run)

    const personIdentifier = await prisma.externalIdentifier.findUniqueOrThrow({
      where: { sourceId_kind_value: { sourceId: 'AN', kind: 'ACTEUR_UID', value: 'PA368' } },
    })
    const bodyIdentifier = await prisma.externalIdentifier.findUniqueOrThrow({
      where: { sourceId_kind_value: { sourceId: 'AN', kind: 'ORGANE_UID', value: 'PO59047' } },
    })

    // Filtré sur la date du cas synthétique : le fixture contient déjà un
    // vrai mandat COMPER de Barnier sur ce même organe à une autre date
    // (2025-10-01), qui ne doit pas fausser le compte.
    const memberships = await prisma.bodyMembership.findMany({
      where: {
        personId: personIdentifier.ownerId,
        bodyId: bodyIdentifier.ownerId,
        startDate: new Date('2026-01-01T00:00:00Z'),
      },
    })

    expect(memberships).toHaveLength(2)
    expect(new Set(memberships.map((m) => m.quality))).toEqual(new Set(['Membre', 'Président']))
  })
})
