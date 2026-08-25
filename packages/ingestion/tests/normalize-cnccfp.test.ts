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

/** Xavier Breton connu, avec un mandat dont la date de début est fournie —
 * pour exercer le niveau « élection puis mandat » (Task 2) : corroboration si
 * le mandat suit l'élection, silence s'il la précède. */
async function seedXavierBretonAvecMandat(startDate: string): Promise<string> {
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
      naturalKey: `test-breton-mandat-${person.id}`,
      personId: person.id,
      institutionId: institution.id,
      territoryId: territory.id,
      kind: 'PARLIAMENTARY',
      startDate: new Date(startDate),
    },
  })
  return person.id
}

/** Deux Sandrine Rousseau déjà connues, homonymes exactes, toutes deux
 * rattachées à la même circonscription (Paris 9e) — le cas réel qui justifie
 * l'arbitrage : ni le nom, ni la circonscription ne les départagent. Chacune
 * porte un mandat dont la date suit l'élection : si l'unicité par
 * circonscription n'était pas correctement calculée à faux pour les deux, la
 * corroboration « élection puis mandat » les confirmerait à tort. */
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
      startDate: new Date('2022-06-20'),
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
      startDate: new Date('2022-06-20'),
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

const CNCCFP_MINIMAL_HEADER =
  'candidat;nom;scrutin;circonscription;département;code département;nuance;monnaie;' +
  'dépenses totales déclarées;recettes totales déclarées;dons déclarés;apport personnel déclaré;' +
  'depenses totales retenues;recettes totales retenues;decision'

function cnccfpRow(fields: {
  candidat: string
  nom: string
  circonscription: string
  departement: string
  codeDepartement: string
  nuance?: string
}): string {
  const { candidat, nom, circonscription, departement, codeDepartement, nuance = 'DIV' } = fields
  // scrutin;monnaie;...montants absents (vide) ; decision "A".
  return [candidat, nom, '202200999', circonscription, departement, codeDepartement, nuance, 'EURO', '', '', '', '', '', '', 'A'].join(
    ';',
  )
}

/**
 * Construit un fichier CNCCFP synthétique où un second candidat du même nom,
 * dans la même circonscription qu'un premier, n'apparaît qu'après un grand
 * nombre d'autres lignes. Sert à prouver que le calcul de l'unicité se fait
 * sur l'ensemble du fichier, jamais en flux : une implémentation qui compterait
 * au fil de l'eau verrait le premier homonyme seul au moment de le résoudre,
 * et le confirmerait à tort avant même d'avoir lu le second.
 */
async function ecrireCsvAvecHomonymeTardif(
  path: string,
  options: { firstCandidat: string; lastCandidat: string; fillerCount: number },
): Promise<void> {
  const { firstCandidat, lastCandidat, fillerCount } = options
  const lines = [CNCCFP_MINIMAL_HEADER]
  lines.push(
    cnccfpRow({
      candidat: firstCandidat,
      nom: 'M. DUPONT Jean',
      circonscription: 'Ain - 1re circonscription',
      departement: 'Ain',
      codeDepartement: '1',
    }),
  )
  for (let i = 0; i < fillerCount; i++) {
    lines.push(
      cnccfpRow({
        candidat: `FILLER-${i}`,
        nom: `M. TEMOIN${i} Prenom${i}`,
        circonscription: 'Filler - 1re circonscription',
        departement: 'Filler',
        codeDepartement: String(100 + i),
      }),
    )
  }
  lines.push(
    cnccfpRow({
      candidat: lastCandidat,
      nom: 'M. DUPONT Jean',
      circonscription: 'Ain - 1re circonscription',
      departement: 'Ain',
      codeDepartement: '1',
    }),
  )
  await writeFile(path, lines.join('\n') + '\n', 'latin1')
}

/** Jean Dupont, connu, avec un mandat qui suivrait l'élection dans la 1ère
 * circonscription de l'Ain — corroborant en apparence, sauf qu'un second
 * candidat du même nom s'y présente aussi (voir `ecrireCsvAvecHomonymeTardif`). */
async function seedJeanDupontAvecMandatPostElection(): Promise<string> {
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
      displayName: 'Jean Dupont',
      firstName: 'Jean',
      lastName: 'Dupont',
      matchKey: 'jean|dupont',
      birthDate: null,
    },
  })
  await prisma.mandate.create({
    data: {
      naturalKey: `test-dupont-mandat-${person.id}`,
      personId: person.id,
      institutionId: institution.id,
      territoryId: territory.id,
      kind: 'PARLIAMENTARY',
      startDate: new Date('2022-06-22'),
    },
  })
  return person.id
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

describe('normalizeCnccfp — niveau élection puis mandat (Task 2)', () => {
  it('Xavier Breton, mandat au 2022-06-22 dans 01-1, résout CONFIRMED et sa candidature est rattachée', async () => {
    const bretonId = await seedXavierBretonAvecMandat('2022-06-22')
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    const match = await prisma.identityMatch.findFirstOrThrow({ where: { sourceId: 'CNCCFP', sourceKey: BRETON } })
    expect(match.confidence).toBe('CONFIRMED')
    expect(match.personId).toBe(bretonId)
    expect(match.evidence).toContain('ELECTED_MANDATE')

    const candidacy = await prisma.candidacy.findFirstOrThrow({ where: { naturalKey: `cnccfp|${BRETON}` } })
    expect(candidacy.personId).toBe(bretonId)
  })

  it("rétro-alimente second_round_date sur une Election déjà en base (créée avant cette fonctionnalité), sans quoi la corroboration reste muette", async () => {
    // Reproduit exactement l'état réel constaté en base de dev : l'Election a
    // été créée par un import antérieur à l'ajout de `secondRoundDate`, elle
    // existe donc déjà avec cette colonne à null. Un `upsert` dont la branche
    // `update` ne touche pas `secondRoundDate` laisserait la corroboration
    // silencieusement désactivée pour toujours, sans qu'aucun test sur base
    // vierge ne le détecte jamais (`resetDatabase` repart toujours de zéro).
    await prisma.election.create({
      data: {
        naturalKey: 'legislatives-2022',
        type: 'LEGISLATIVE',
        label: 'Élections législatives 2022',
        year: 2022,
        secondRoundDate: null,
      },
    })

    const bretonId = await seedXavierBretonAvecMandat('2022-06-22')
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    const election = await prisma.election.findUniqueOrThrow({ where: { naturalKey: 'legislatives-2022' } })
    expect(election.secondRoundDate).not.toBeNull()

    const match = await prisma.identityMatch.findFirstOrThrow({ where: { sourceId: 'CNCCFP', sourceKey: BRETON } })
    expect(match.confidence).toBe('CONFIRMED')
    expect(match.evidence).toContain('ELECTED_MANDATE')

    const candidacy = await prisma.candidacy.findFirstOrThrow({ where: { naturalKey: `cnccfp|${BRETON}` } })
    expect(candidacy.personId).toBe(bretonId)
  })

  it('les deux Sandrine Rousseau restent non rattachées malgré des mandats post-élection : uniqueInDistrict est faux pour les deux', async () => {
    await seedDeuxSandrineRousseauMemeCirconscription()
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    const candidacies = await prisma.candidacy.findMany({
      where: { naturalKey: { in: [`cnccfp|${ROUSSEAU_ECO}`, `cnccfp|${ROUSSEAU_DVD}`] } },
    })
    expect(candidacies).toHaveLength(2)
    expect(candidacies.every((c) => c.personId === null)).toBe(true)

    const matches = await prisma.identityMatch.findMany({
      where: { sourceId: 'CNCCFP', sourceKey: { in: [ROUSSEAU_ECO, ROUSSEAU_DVD] } },
    })
    expect(matches.every((m) => m.confidence !== 'CONFIRMED')).toBe(true)
    expect(matches.every((m) => m.personId === null)).toBe(true)
  })

  it('un mandat antérieur à l’élection ne corrobore pas : le candidat reste PROBABLE, non rattaché', async () => {
    const bretonId = await seedXavierBretonAvecMandat('2017-06-21')
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    const match = await prisma.identityMatch.findFirstOrThrow({ where: { sourceId: 'CNCCFP', sourceKey: BRETON } })
    expect(match.confidence).toBe('PROBABLE')
    expect(match.personId).toBe(bretonId)
    expect(match.evidence).not.toContain('ELECTED_MANDATE')

    const candidacy = await prisma.candidacy.findFirstOrThrow({ where: { naturalKey: `cnccfp|${BRETON}` } })
    expect(candidacy.personId).toBeNull()
  })

  it('un mandat démarrant le jour même de l’élection corrobore (>=, pas >)', async () => {
    const bretonId = await seedXavierBretonAvecMandat('2022-06-19')
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    const match = await prisma.identityMatch.findFirstOrThrow({ where: { sourceId: 'CNCCFP', sourceKey: BRETON } })
    expect(match.confidence).toBe('CONFIRMED')
    expect(match.evidence).toContain('ELECTED_MANDATE')

    const candidacy = await prisma.candidacy.findFirstOrThrow({ where: { naturalKey: `cnccfp|${BRETON}` } })
    expect(candidacy.personId).toBe(bretonId)
  })

  it("l'unicité se calcule sur tout le fichier : un homonyme tardif défait le premier candidat, même bien avant lui dans le fichier", async () => {
    const dupontId = await seedJeanDupontAvecMandatPostElection()

    const dir = await mkdtemp(join(tmpdir(), 'poligraph-cnccfp-homonyme-tardif-'))
    const path = join(dir, 'homonyme-tardif.csv')
    try {
      const FIRST = 'HOM-A'
      const LAST = 'HOM-B'
      // Le nombre de lignes de remplissage n'a pas besoin d'être grand pour
      // démontrer le défaut d'une implémentation en flux : il suffit que le
      // second homonyme ne soit pas la ligne immédiatement suivante. 50 lignes
      // séparent les deux Jean Dupont, assez pour qu'un comptage "au fil de
      // l'eau" ait déjà rendu son verdict sur le premier avant de lire le
      // second — tout en gardant la suite rapide à rejouer.
      await ecrireCsvAvecHomonymeTardif(path, { firstCandidat: FIRST, lastCandidat: LAST, fillerCount: 50 })

      const runDescriptor: ResourceDescriptor = { ...descriptor, resourceExternalId: 'homonyme-tardif.csv' }
      const run = await openImportRun(prisma, runDescriptor, 'c-homonyme-tardif')
      if (!run) throw new Error('run attendu')
      await stageCnccfp(prisma, path, run)

      await normalizeCnccfp(prisma, run)

      // Le premier candidat (ligne 2) ne doit JAMAIS être confirmé : un
      // deuxième homonyme dans la même circonscription apparaît 500 lignes
      // plus loin. Une implémentation qui compterait au fil de l'eau le
      // verrait seul au moment de le résoudre et le confirmerait à tort.
      const firstMatch = await prisma.identityMatch.findFirstOrThrow({
        where: { sourceId: 'CNCCFP', sourceKey: FIRST },
      })
      expect(firstMatch.confidence).not.toBe('CONFIRMED')

      const firstCandidacy = await prisma.candidacy.findFirstOrThrow({
        where: { naturalKey: `cnccfp|${FIRST}` },
      })
      expect(firstCandidacy.personId).toBeNull()

      // Le mandat de Jean Dupont existe bel et bien et n'est écarté que par
      // l'unicité, pas par une autre raison (district ou nom qui ne
      // correspondrait pas).
      expect(firstMatch.personId).toBe(dupontId)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('est idempotent pour un rapprochement CONFIRMED : rejouer ne change ni le verdict ni le rattachement', async () => {
    const bretonId = await seedXavierBretonAvecMandat('2022-06-22')
    const run = await stageCnccfpFixture('c1')
    await normalizeCnccfp(prisma, run)

    const before = await prisma.candidacy.findFirstOrThrow({ where: { naturalKey: `cnccfp|${BRETON}` } })
    expect(before.personId).toBe(bretonId)

    await normalizeCnccfp(prisma, run)

    const after = await prisma.candidacy.findFirstOrThrow({ where: { naturalKey: `cnccfp|${BRETON}` } })
    expect(after.personId).toBe(bretonId)
    expect(await prisma.candidacy.count()).toBe(10)
    expect(await prisma.identityMatch.count({ where: { sourceId: 'CNCCFP' } })).toBe(10)
  })

  it("retire le rattachement quand le verdict s'affaiblit", async () => {
    const dupontId = await seedJeanDupontAvecMandatPostElection()

    const dir = await mkdtemp(join(tmpdir(), 'poligraph-cnccfp-downgrade-'))
    const seul = join(dir, 'seul.csv')
    const avecHomonyme = join(dir, 'avec-homonyme.csv')
    try {
      const JD = 'JD-1'
      const HOMONYME = 'JD-2'

      // Étape 1 : un seul candidat de ce nom dans la circonscription — le
      // mandat post-élection de Jean Dupont corrobore, CONFIRMED, rattaché.
      await writeFile(
        seul,
        [
          CNCCFP_MINIMAL_HEADER,
          cnccfpRow({
            candidat: JD,
            nom: 'M. DUPONT Jean',
            circonscription: 'Ain - 1re circonscription',
            departement: 'Ain',
            codeDepartement: '1',
          }),
        ].join('\n') + '\n',
        'latin1',
      )
      const run1Descriptor: ResourceDescriptor = { ...descriptor, resourceExternalId: 'seul.csv' }
      const run1 = await openImportRun(prisma, run1Descriptor, 'c-downgrade-1')
      if (!run1) throw new Error('run attendu')
      await stageCnccfp(prisma, seul, run1)
      await normalizeCnccfp(prisma, run1)

      const avant = await prisma.candidacy.findFirstOrThrow({ where: { naturalKey: `cnccfp|${JD}` } })
      expect(avant.personId).toBe(dupontId)
      const matchAvant = await prisma.identityMatch.findFirstOrThrow({
        where: { sourceId: 'CNCCFP', sourceKey: JD },
      })
      expect(matchAvant.confidence).toBe('CONFIRMED')

      // Étape 2 : un import ultérieur du même fichier républié révèle un
      // second candidat du même nom dans la même circonscription. uniqueInDistrict
      // devient faux pour JD : la corroboration élection puis mandat ne
      // s'applique plus, exactement le cas Sandrine Rousseau — mais découvert
      // au réimport plutôt qu'au premier passage.
      await writeFile(
        avecHomonyme,
        [
          CNCCFP_MINIMAL_HEADER,
          cnccfpRow({
            candidat: JD,
            nom: 'M. DUPONT Jean',
            circonscription: 'Ain - 1re circonscription',
            departement: 'Ain',
            codeDepartement: '1',
          }),
          cnccfpRow({
            candidat: HOMONYME,
            nom: 'M. DUPONT Jean',
            circonscription: 'Ain - 1re circonscription',
            departement: 'Ain',
            codeDepartement: '1',
          }),
        ].join('\n') + '\n',
        'latin1',
      )
      const run2Descriptor: ResourceDescriptor = { ...descriptor, resourceExternalId: 'avec-homonyme.csv' }
      const run2 = await openImportRun(prisma, run2Descriptor, 'c-downgrade-2')
      if (!run2) throw new Error('run attendu')
      await stageCnccfp(prisma, avecHomonyme, run2)
      await normalizeCnccfp(prisma, run2)

      const apres = await prisma.candidacy.findFirstOrThrow({ where: { naturalKey: `cnccfp|${JD}` } })
      expect(apres.personId).toBeNull()
      const matchApres = await prisma.identityMatch.findFirstOrThrow({
        where: { sourceId: 'CNCCFP', sourceKey: JD },
      })
      expect(['PROBABLE', 'AMBIGUOUS']).toContain(matchApres.confidence)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
