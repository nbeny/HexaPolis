import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Prisma } from '@poligraph/db'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { normalizeCnccfp } from '../src/adapters/cnccfp/normalize-cnccfp.js'
import { stageCnccfp } from '../src/adapters/cnccfp/stage-cnccfp.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ImportRunRef, ResourceDescriptor } from '../src/contract.js'

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

// Candidats (identifiants réels de la fixture) utiles aux assertions.
const ROUSSEAU_ECO = '202204221'
const ROUSSEAU_DVD = '202204216'
const BRETON = '202200003'

async function stageCnccfpFixture(checksum: string): Promise<ImportRunRef> {
  const run = await openImportRun(prisma, descriptor, checksum)
  if (!run) throw new Error('run attendu')
  await stageCnccfp(prisma, FIXTURE, run)
  return run
}

/** Xavier Breton, déjà connu (par ex. via le RNE), sans date de naissance —
 * la CNCCFP n'en publie aucune. Rattaché à la 1ère circonscription de l'Ain
 * (« 01-1 », la forme réelle des codes Territory) pour exercer le niveau 3. */
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

/** Deux Sandrine Rousseau déjà connues, homonymes exactes, toutes deux
 * rattachées à la même circonscription (Paris 9e) — le cas réel qui justifie
 * l'arbitrage : ni le nom, ni la circonscription ne les départagent. */
async function seedDeuxSandrineRousseauMemeCirconscription(): Promise<{ ecoId: string; dvdId: string }> {
  const institution = await prisma.institution.upsert({
    where: { code: 'TEST_INSTITUTION' },
    update: {},
    create: { code: 'TEST_INSTITUTION', label: 'Institution de test' },
  })
  const territory = await prisma.territory.upsert({
    where: { type_code: { type: 'CIRCONSCRIPTION', code: '75-9' } },
    update: {},
    create: { type: 'CIRCONSCRIPTION', code: '75-9', label: '9ème circonscription de Paris' },
  })

  const eco = await prisma.person.create({
    data: {
      displayName: 'Sandrine Rousseau (a)',
      firstName: 'Sandrine',
      lastName: 'Rousseau',
      matchKey: 'sandrine|rousseau',
      birthDate: null,
    },
  })
  await prisma.mandate.create({
    data: {
      naturalKey: `test-rousseau-a-${eco.id}`,
      personId: eco.id,
      institutionId: institution.id,
      territoryId: territory.id,
      kind: 'PARLIAMENTARY',
    },
  })

  const dvd = await prisma.person.create({
    data: {
      displayName: 'Sandrine Rousseau (b)',
      firstName: 'Sandrine',
      lastName: 'Rousseau',
      matchKey: 'sandrine|rousseau',
      birthDate: null,
    },
  })
  await prisma.mandate.create({
    data: {
      naturalKey: `test-rousseau-b-${dvd.id}`,
      personId: dvd.id,
      institutionId: institution.id,
      territoryId: territory.id,
      kind: 'PARLIAMENTARY',
    },
  })

  return { ecoId: eco.id, dvdId: dvd.id }
}

/** Les cinq circonscriptions couvertes par la fixture, dans la forme réelle
 * des codes Territory (vérifiée contre la base de développement). */
async function seedToutesLesCirconscriptionsDeLaFixture(): Promise<void> {
  const codes: Array<[string, string]> = [
    ['75-9', '9ème circonscription de Paris'],
    ['23-1', '1ère circonscription de la Creuse'],
    ['85-3', '3ème circonscription de la Vendée'],
    ['988-1', '1ère circonscription de Nouvelle-Calédonie'],
    ['01-1', "1ère circonscription de l'Ain"],
  ]
  for (const [code, label] of codes) {
    await prisma.territory.upsert({
      where: { type_code: { type: 'CIRCONSCRIPTION', code } },
      update: {},
      create: { type: 'CIRCONSCRIPTION', code, label },
    })
  }
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('normalizeCnccfp', () => {
  it('rejette la ligne corrompue avec trace, sans l’ignorer silencieusement', async () => {
    const run = await stageCnccfpFixture('c1')
    const report = await normalizeCnccfp(prisma, run)

    expect(report.rejected).toBe(1)

    const rejection = await prisma.importRejection.findFirstOrThrow({
      where: { importRunId: run.id, bronzeTable: 'cnccfp_compte_raw' },
    })
    expect(rejection.bronzeRef).toBe('7')
  })

  it('crée une Candidacy et un CampaignAccount pour chacune des 10 lignes exploitables', async () => {
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    expect(await prisma.candidacy.count()).toBe(10)
    expect(await prisma.campaignAccount.count()).toBe(10)
  })

  it('rattache chaque candidature à l’élection législative 2022, une seule fois', async () => {
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    expect(await prisma.election.count()).toBe(1)
    const election = await prisma.election.findFirstOrThrow()
    expect(election.year).toBe(2022)

    const candidacies = await prisma.candidacy.findMany()
    expect(candidacies.every((c) => c.electionId === election.id)).toBe(true)
  })

  it('porte la nuance sur la candidature', async () => {
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    const breton = await prisma.candidacy.findFirstOrThrow({ where: { naturalKey: `cnccfp|${BRETON}` } })
    expect(breton.nuance).toBe('LR')
  })

  it('conserve la devise telle quelle : deux comptes en CFP, huit en EURO', async () => {
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    const accounts = await prisma.campaignAccount.findMany()
    expect(accounts.filter((a) => a.currency === 'CFP')).toHaveLength(2)
    expect(accounts.filter((a) => a.currency === 'EURO')).toHaveLength(8)
  })

  it('aucun agrégat ne mélange les devises : les totaux par devise restent distincts et corrects', async () => {
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    const accounts = await prisma.campaignAccount.findMany()
    // La devise est portée par chaque compte (colonne non nullable en base :
    // il est impossible d'écrire un CampaignAccount sans devise). On calcule
    // ici un total PAR devise ; les mélanger donnerait un montant sans sens
    // (des euros additionnés à des francs CFP).
    const totalsByCurrency = new Map<string, Prisma.Decimal>()
    for (const account of accounts) {
      if (!account.declaredExpenses) continue
      const running = totalsByCurrency.get(account.currency) ?? new Prisma.Decimal(0)
      totalsByCurrency.set(account.currency, running.plus(account.declaredExpenses))
    }

    // CFP : Cuenot 393409 + Dunoyer 8012254
    expect(totalsByCurrency.get('CFP')?.toString()).toBe('8405663')
    // EURO : Rousseau ECO 37154 + Moreau ENS 31987 + Moreau DVD 0
    //      + Armenjon 0 + Breton 36436 + Guéraud 25037 + Guillermin 9935
    //      (Rousseau DVD est "-", donc null, exclue de la somme)
    expect(totalsByCurrency.get('EURO')?.toString()).toBe('140549')
  })

  it('les montants sont des Decimal : « - » et vide deviennent null, jamais 0', async () => {
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    // Rousseau DVD : tous les montants valent « - » dans le fichier.
    const rousseauDvd = await prisma.campaignAccount.findFirstOrThrow({
      where: { candidacy: { naturalKey: `cnccfp|${ROUSSEAU_DVD}` } },
    })
    expect(rousseauDvd.declaredExpenses).toBeNull()
    expect(rousseauDvd.declaredIncome).toBeNull()
  })

  it('un montant déclaré à zéro reste 0, distinct d’un montant absent', async () => {
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    // Moreau (Vendée, DVD) déclare explicitement 0 partout.
    const moreauVendee = await prisma.candidacy.findFirstOrThrow({
      where: { naturalKey: 'cnccfp|202204991' },
      include: { account: true },
    })
    expect(moreauVendee.account?.declaredExpenses?.toString()).toBe('0')
    expect(moreauVendee.account?.declaredExpenses).not.toBeNull()
  })

  it('ne fusionne JAMAIS les deux Sandrine Rousseau : AMBIGUOUS, personId null, deux IdentityMatch en attente', async () => {
    await seedDeuxSandrineRousseauMemeCirconscription()
    const run = await stageCnccfpFixture('c1')
    const report = await normalizeCnccfp(prisma, run)

    const candidacies = await prisma.candidacy.findMany({
      where: { naturalKey: { in: [`cnccfp|${ROUSSEAU_ECO}`, `cnccfp|${ROUSSEAU_DVD}`] } },
    })
    expect(candidacies).toHaveLength(2)
    expect(candidacies.every((c) => c.personId === null)).toBe(true)

    const matches = await prisma.identityMatch.findMany({
      where: { sourceId: 'CNCCFP', sourceKey: { in: [ROUSSEAU_ECO, ROUSSEAU_DVD] } },
    })
    expect(matches).toHaveLength(2)
    expect(matches.every((m) => m.confidence === 'AMBIGUOUS')).toBe(true)
    expect(matches.every((m) => m.personId === null)).toBe(true)
    expect(report.pending).toBeGreaterThanOrEqual(2)
  })

  it('Xavier Breton, connu sans date de naissance, n’est rapproché qu’en PROBABLE — jamais fusionné automatiquement', async () => {
    const bretonId = await seedXavierBretonSansDateNaissance()
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    const match = await prisma.identityMatch.findFirstOrThrow({ where: { sourceId: 'CNCCFP', sourceKey: BRETON } })
    expect(match.confidence).toBe('PROBABLE')
    expect(match.personId).toBe(bretonId)
    expect(match.evidence).toContain('DISTRICT')

    // La cascade suggère Breton, mais PROBABLE n'autorise pas la fusion
    // automatique : la candidature reste non rattachée en attendant l'arbitrage.
    const candidacy = await prisma.candidacy.findFirstOrThrow({ where: { naturalKey: `cnccfp|${BRETON}` } })
    expect(candidacy.personId).toBeNull()
  })

  it('le compte de campagne s’accroche à la Candidacy, jamais directement à la personne', async () => {
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    const account = await prisma.campaignAccount.findFirstOrThrow({
      where: { candidacy: { naturalKey: `cnccfp|${BRETON}` } },
      include: { candidacy: true },
    })
    expect(account.candidacyId).toBe(account.candidacy.id)
    // CampaignAccount n'a pas de colonne personId : la seule voie vers une
    // personne passe par candidacy.personId.
    expect('personId' in account).toBe(false)
  })

  it('rattache le territoire quand la circonscription se résout : 10 candidatures sur 10 quand les circonscriptions sont connues', async () => {
    await seedToutesLesCirconscriptionsDeLaFixture()
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    const candidacies = await prisma.candidacy.findMany()
    expect(candidacies).toHaveLength(10)
    expect(candidacies.every((c) => c.territoryId !== null)).toBe(true)
  })

  it('laisse territoryId à null quand la circonscription ne correspond à aucun Territory connu, sans en inventer un', async () => {
    // Aucune circonscription n'est seedée ici : aucune ne peut se résoudre.
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    const candidacies = await prisma.candidacy.findMany()
    expect(candidacies).toHaveLength(10)
    expect(candidacies.every((c) => c.territoryId === null)).toBe(true)
    // Aucun Territory n'a été créé pour combler l'absence.
    expect(await prisma.territory.count()).toBe(0)
  })

  it('rejette une ligne exploitable dont la devise est absente, une devise est indispensable à un compte de campagne', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'poligraph-cnccfp-fixture-'))
    const path = join(dir, 'sans-devise.csv')
    try {
      await writeFile(
        path,
        'candidat;nom;scrutin;circonscription;département;code département;nuance;monnaie;dépenses totales déclarées;recettes totales déclarées;dons déclarés;apport personnel déclaré;depenses totales retenues;recettes totales retenues;decision\n' +
          '999999999;M. SANS DEVISE Test;202299999;Paris - 1e circonscription;Paris;75;DIV;;100;100;0;0;100;100;A\n',
        'latin1',
      )

      const runDescriptor: ResourceDescriptor = { ...descriptor, resourceExternalId: 'sans-devise.csv' }
      const run = await openImportRun(prisma, runDescriptor, 'c-sans-devise')
      if (!run) throw new Error('run attendu')
      await stageCnccfp(prisma, path, run)

      const report = await normalizeCnccfp(prisma, run)

      expect(report.rejected).toBe(1)
      expect(await prisma.campaignAccount.count()).toBe(0)
      const rejection = await prisma.importRejection.findFirstOrThrow({
        where: { importRunId: run.id, bronzeTable: 'cnccfp_compte_raw' },
      })
      expect(rejection.code).toBe('MISSING_CURRENCY')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('est idempotent : rejouer la normalisation ne crée rien de plus', async () => {
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    const counts = {
      candidacy: await prisma.candidacy.count(),
      campaignAccount: await prisma.campaignAccount.count(),
      election: await prisma.election.count(),
      identityMatch: await prisma.identityMatch.count(),
    }

    await normalizeCnccfp(prisma, run)

    expect(await prisma.candidacy.count()).toBe(counts.candidacy)
    expect(await prisma.campaignAccount.count()).toBe(counts.campaignAccount)
    expect(await prisma.election.count()).toBe(counts.election)
    expect(await prisma.identityMatch.count()).toBe(counts.identityMatch)
  })
})
