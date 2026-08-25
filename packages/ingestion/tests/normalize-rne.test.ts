import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { normalizeAn } from '../src/adapters/an/normalize.js'
import { stageActeurs } from '../src/adapters/an/stage-acteurs.js'
import { stageOrganes } from '../src/adapters/an/stage-organes.js'
import { normalizeRne } from '../src/adapters/rne/normalize-rne.js'
import { stageRne } from '../src/adapters/rne/stage-rne.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ImportRunRef, ResourceDescriptor } from '../src/contract.js'

const AN_FIXTURE = fileURLToPath(new URL('../fixtures/an-amo10-sample.zip', import.meta.url))
const RNE_FIXTURE = fileURLToPath(new URL('../fixtures/rne-deputes-sample.csv', import.meta.url))
const prisma = testPrisma()

const anDescriptor: ResourceDescriptor = {
  sourceKey: 'AN',
  datasetExternalId: 'amo10-17',
  datasetTitle: 'Députés actifs, mandats et organes',
  resourceExternalId: 'AMO10.json.zip',
  url: 'https://example.invalid/AMO10.json.zip',
  format: 'zip',
}

const rneDescriptor: ResourceDescriptor = {
  sourceKey: 'RNE',
  datasetExternalId: 'rne-deputes',
  datasetTitle: 'Répertoire national des élus — Députés',
  resourceExternalId: 'elus-depute-dep.csv',
  url: 'https://example.invalid/elus-depute-dep.csv',
  format: 'csv',
}

/**
 * Le fixture AMO10 ne contient qu'une Alexandra Martin (née en 1968). Le vrai
 * import (AMO30 historique) en apporterait une seconde ; on la simule ici
 * directement en base pour exercer le cas décisif sans dépendre d'un second
 * fixture AN.
 */
async function seedAn(): Promise<void> {
  const run = await openImportRun(prisma, anDescriptor, 'checksum-an')
  if (!run) throw new Error('run attendu')
  await stageOrganes(prisma, AN_FIXTURE, run)
  await stageActeurs(prisma, AN_FIXTURE, run)
  await normalizeAn(prisma, run)
}

async function seedSecondAlexandraMartin(): Promise<string> {
  const person = await prisma.person.create({
    data: {
      displayName: 'Alexandra Martin',
      firstName: 'Alexandra',
      lastName: 'Martin',
      matchKey: 'alexandra|martin',
      birthDate: new Date('1976-07-28T00:00:00Z'),
    },
  })
  return person.id
}

/** Une Xavier Breton connue sans date de naissance, rattachée à la 1ère
 * circonscription de l'Ain (« 01-1 », la forme réelle des codes Territory) —
 * pour exercer le niveau 3 (circonscription) de la cascade. */
async function seedXavierBretonSansDateNaissance(): Promise<string> {
  const institution = await prisma.institution.upsert({
    where: { code: 'TEST_INSTITUTION' },
    update: {},
    create: { code: 'TEST_INSTITUTION', label: 'Institution de test' },
  })
  const territory = await prisma.territory.upsert({
    where: { type_code: { type: 'CIRCONSCRIPTION', code: '01-1' } },
    update: {},
    create: { type: 'CIRCONSCRIPTION', code: '01-1', label: "1ère circonscription de l'Ain" },
  })
  const person = await prisma.person.create({
    data: {
      displayName: 'Xavier Breton',
      firstName: 'Xavier',
      lastName: 'Breton',
      matchKey: 'xavier|breton',
      birthDate: null,
    },
  })
  await prisma.mandate.create({
    data: {
      naturalKey: `test-breton-${person.id}`,
      personId: person.id,
      institutionId: institution.id,
      territoryId: territory.id,
      kind: 'PARLIAMENTARY',
    },
  })
  return person.id
}

/**
 * Deux Élisa Martin connues, homonymes exactes (même matchKey), toutes deux
 * sans date de naissance et sans circonscription : sans arbitrage, la ligne
 * RNE « MARTIN Élisa » (née 1972-05-15) ne peut pas les départager — la
 * cascade rend AMBIGUOUS. C'est exactement le cas qu'un arbitrage humain doit
 * pouvoir trancher. `personA` porte un identifiant AN, seul moyen pour une
 * décision de la désigner sans ambiguïté.
 */
async function seedTwoElisaMartinsSansDepartage(): Promise<{ personAId: string; personBId: string }> {
  const personA = await prisma.person.create({
    data: {
      displayName: 'Élisa Martin (A)',
      firstName: 'Élisa',
      lastName: 'Martin',
      matchKey: 'elisa|martin',
      birthDate: null,
    },
  })
  await prisma.externalIdentifier.create({
    data: { ownerType: 'Person', ownerId: personA.id, sourceId: 'AN', kind: 'ACTEUR_UID', value: 'PA900001' },
  })
  const personB = await prisma.person.create({
    data: {
      displayName: 'Élisa Martin (B)',
      firstName: 'Élisa',
      lastName: 'Martin',
      matchKey: 'elisa|martin',
      birthDate: null,
    },
  })
  return { personAId: personA.id, personBId: personB.id }
}

async function stageRneFixture(checksum: string): Promise<ImportRunRef> {
  const run = await openImportRun(prisma, rneDescriptor, checksum)
  if (!run) throw new Error('run attendu')
  await stageRne(prisma, RNE_FIXTURE, run)
  return run
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('normalizeRne', () => {
  it('rattache les deux Alexandra Martin à deux personnes différentes', async () => {
    await seedAn()
    const martin1976Id = await seedSecondAlexandraMartin()
    const run = await stageRneFixture('c1')

    await normalizeRne(prisma, run)

    const matches = await prisma.identityMatch.findMany({ where: { sourceId: 'RNE' } })
    const martin1968Match = matches.find((m) => m.sourceKey.endsWith('1968-10-25'))
    const martin1976Match = matches.find((m) => m.sourceKey.endsWith('1976-07-28'))

    expect(martin1968Match?.confidence).toBe('CONFIRMED')
    expect(martin1976Match?.confidence).toBe('CONFIRMED')
    expect(martin1968Match?.personId).toBeTruthy()
    expect(martin1976Match?.personId).toBe(martin1976Id)
    // Le test décisif : ce ne sont jamais la même personne.
    expect(martin1968Match?.personId).not.toBe(martin1976Match?.personId)
  })

  it('écrit un IdentityMatch pour chacune des 8 lignes', async () => {
    await seedAn()
    const run = await stageRneFixture('c1')
    await normalizeRne(prisma, run)

    expect(await prisma.identityMatch.count({ where: { sourceId: 'RNE' } })).toBe(8)
  })

  it('confirme un député déjà connu via l’AN sur nom et date de naissance, et lui attache un identifiant RNE', async () => {
    await seedAn()
    const run = await stageRneFixture('c1')
    await normalizeRne(prisma, run)

    const barnier = await prisma.person.findFirstOrThrow({ where: { lastName: 'Barnier' } })
    const match = await prisma.identityMatch.findFirstOrThrow({
      where: { sourceId: 'RNE', personId: barnier.id },
    })
    expect(match.confidence).toBe('CONFIRMED')
    expect(match.evidence).toContain('BIRTH_DATE')

    const identifier = await prisma.externalIdentifier.findFirstOrThrow({
      where: { sourceId: 'RNE', ownerType: 'Person', ownerId: barnier.id },
    })
    // Dérivé, pas un identifiant national : le RNE n'en publie aucun.
    expect(identifier.kind).toBe('RNE_DERIVED_KEY')
    expect(identifier.value).toBe('michel|barnier|1951-01-09')
  })

  it('ne crée aucune personne pour un député absent de la base', async () => {
    await seedAn()
    const run = await stageRneFixture('c1')
    const personsBefore = await prisma.person.count()

    await normalizeRne(prisma, run)

    // Xavier Breton n'est dans aucun des deux fixtures de ce test.
    const breton = await prisma.identityMatch.findFirstOrThrow({
      where: { sourceId: 'RNE', sourceKey: { contains: 'xavier|breton' } },
    })
    expect(breton.confidence).toBe('UNMATCHED')
    expect(breton.personId).toBeNull()
    expect(await prisma.person.count()).toBe(personsBefore)
  })

  it('utilise la circonscription normalisée quand la date de naissance connue est absente (niveau 3)', async () => {
    const bretonId = await seedXavierBretonSansDateNaissance()
    const run = await stageRneFixture('c1')

    await normalizeRne(prisma, run)

    const match = await prisma.identityMatch.findFirstOrThrow({
      where: { sourceId: 'RNE', sourceKey: { contains: 'xavier|breton' } },
    })
    expect(match.confidence).toBe('PROBABLE')
    expect(match.personId).toBe(bretonId)
    expect(match.evidence).toContain('DISTRICT')
  })

  it('est idempotent : rejouer la normalisation ne crée rien de plus', async () => {
    await seedAn()
    await seedSecondAlexandraMartin()
    const run = await stageRneFixture('c1')
    await normalizeRne(prisma, run)

    const counts = {
      person: await prisma.person.count(),
      identityMatch: await prisma.identityMatch.count(),
      externalIdentifier: await prisma.externalIdentifier.count(),
    }

    await normalizeRne(prisma, run)

    expect(await prisma.person.count()).toBe(counts.person)
    expect(await prisma.identityMatch.count()).toBe(counts.identityMatch)
    expect(await prisma.externalIdentifier.count()).toBe(counts.externalIdentifier)
  })

  it('MERGE : sans arbitrage, deux homonymes sans date de naissance restent AMBIGUOUS', async () => {
    // Vérifie la prémisse du test MERGE ci-dessous : sans décision, la cascade
    // seule ne peut pas départager ces deux Élisa Martin.
    await seedTwoElisaMartinsSansDepartage()
    const run = await stageRneFixture('c1')

    await normalizeRne(prisma, run)

    const match = await prisma.identityMatch.findFirstOrThrow({
      where: { sourceId: 'RNE', sourceKey: 'elisa|martin|1972-05-15' },
    })
    expect(match.confidence).toBe('AMBIGUOUS')
    expect(match.personId).toBeNull()
  })

  it('MERGE : un arbitrage rattache le candidat à la personne qu’il désigne, sans toucher l’autre', async () => {
    const { personAId, personBId } = await seedTwoElisaMartinsSansDepartage()
    const run = await stageRneFixture('c1')

    const dir = await mkdtemp(join(tmpdir(), 'poligraph-rne-decisions-'))
    const decisionsPath = join(dir, 'decisions.yaml')
    try {
      await writeFile(
        decisionsPath,
        `decisions:
  - decision: MERGE
    left:  { source: RNE, key: "elisa|martin|1972-05-15" }
    right: { source: AN, key: "PA900001" }
    reason: "vérifié manuellement : seule PA900001 correspond réellement"
    decidedOn: 2026-08-25
`,
        'utf-8',
      )

      await normalizeRne(prisma, run, decisionsPath)

      const match = await prisma.identityMatch.findFirstOrThrow({
        where: { sourceId: 'RNE', sourceKey: 'elisa|martin|1972-05-15' },
      })
      expect(match.personId).toBe(personAId)
      expect(match.confidence).toBe('CONFIRMED')
      expect(match.evidence).toContain('DECISION')
      // Décidé par un humain, pas déduit par l'algorithme.
      expect(match.decidedBy).toBe('HUMAN')

      // L'autre personne n'est pas touchée : ni identifiant RNE, ni rattachement.
      expect(match.personId).not.toBe(personBId)
      const untouched = await prisma.externalIdentifier.findFirst({
        where: { ownerId: personBId, sourceId: 'RNE' },
      })
      expect(untouched).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('SPLIT : un arbitrage écarte la personne désignée, la cascade retombe sur l’unique homonyme restant', async () => {
    const { personAId, personBId } = await seedTwoElisaMartinsSansDepartage()
    const run = await stageRneFixture('c1')

    const dir = await mkdtemp(join(tmpdir(), 'poligraph-rne-decisions-'))
    const decisionsPath = join(dir, 'decisions.yaml')
    try {
      await writeFile(
        decisionsPath,
        `decisions:
  - decision: SPLIT
    left:  { source: RNE, key: "elisa|martin|1972-05-15" }
    right: { source: AN, key: "PA900001" }
    reason: "vérifié manuellement : ce n'est pas PA900001"
    decidedOn: 2026-08-25
`,
        'utf-8',
      )

      await normalizeRne(prisma, run, decisionsPath)

      const match = await prisma.identityMatch.findFirstOrThrow({
        where: { sourceId: 'RNE', sourceKey: 'elisa|martin|1972-05-15' },
      })
      // personA est écartée par le SPLIT ; personB, seule homonyme restante
      // une fois l'exclusion appliquée, est retenue par la cascade normale.
      expect(match.personId).toBe(personBId)
      expect(match.personId).not.toBe(personAId)
      expect(match.confidence).toBe('POSSIBLE')
      expect(match.decidedBy).toBe('HUMAN')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('lève une erreur explicite quand une décision d’arbitrage nomme une clé introuvable parmi les lignes importées', async () => {
    await seedAn()
    const run = await stageRneFixture('c1')

    const dir = await mkdtemp(join(tmpdir(), 'poligraph-rne-decisions-'))
    const decisionsPath = join(dir, 'decisions.yaml')
    try {
      await writeFile(
        decisionsPath,
        `decisions:
  - decision: MERGE
    left:  { source: RNE, key: "personne|inexistante|1900-01-01" }
    right: { source: AN, key: "PA000000" }
    reason: "clé RNE qui ne correspond à aucune ligne importée"
    decidedOn: 2026-08-25
`,
        'utf-8',
      )

      await expect(normalizeRne(prisma, run, decisionsPath)).rejects.toThrow(/inexistante/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
