import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { districtCodeFromCirconscription, normalizeResultats } from '../src/adapters/resultats/normalize-resultats.js'
import { stageResultats } from '../src/adapters/resultats/stage-resultats.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ImportRunRef, ResourceDescriptor } from '../src/contract.js'

const T1 = fileURLToPath(new URL('../fixtures/resultats-t1-sample.csv', import.meta.url))
const T2 = fileURLToPath(new URL('../fixtures/resultats-t2-sample.csv', import.meta.url))
const prisma = testPrisma()

const t1Descriptor: ResourceDescriptor = {
  sourceKey: 'DATA_GOUV',
  datasetExternalId: 'legislatives-2024-t1',
  datasetTitle: 'Résultats définitifs — Législatives 2024, 1er tour',
  resourceExternalId: 'resultats-definitifs-par-circonscriptions-legislatives.csv',
  url: 'https://example.invalid/t1.csv',
  format: 'csv',
}

const t2Descriptor: ResourceDescriptor = {
  sourceKey: 'DATA_GOUV',
  datasetExternalId: 'legislatives-2024-t2',
  datasetTitle: 'Résultats définitifs — Législatives 2024, 2nd tour',
  resourceExternalId: 'resultats-definitifs-par-circonscription.csv',
  url: 'https://example.invalid/t2.csv',
  format: 'csv',
}

async function stageT1(checksum: string): Promise<ImportRunRef> {
  const run = await openImportRun(prisma, t1Descriptor, checksum)
  if (!run) throw new Error('run attendu')
  await stageResultats(prisma, T1, run)
  return run
}

async function stageT2(checksum: string): Promise<ImportRunRef> {
  const run = await openImportRun(prisma, t2Descriptor, checksum)
  if (!run) throw new Error('run attendu')
  await stageResultats(prisma, T2, run)
  return run
}

async function seedTerritory(code: string, label: string): Promise<string> {
  const territory = await prisma.territory.upsert({
    where: { type_code: { type: 'CIRCONSCRIPTION', code } },
    update: {},
    create: { type: 'CIRCONSCRIPTION', code, label },
  })
  return territory.id
}

async function seedXavierBretonAvecMandat(startDate: string): Promise<string> {
  const institution = await prisma.institution.upsert({
    where: { code: 'TEST_INSTITUTION' },
    update: {},
    create: { code: 'TEST_INSTITUTION', label: 'Institution de test' },
  })
  const territoryId = await seedTerritory('01-1', "1ère circonscription de l'Ain")
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
      territoryId,
      kind: 'PARLIAMENTARY',
      startDate: new Date(startDate),
    },
  })
  return person.id
}

/** Les 18 colonnes fixes d'une ligne de résultats, avec les 4 champs qui
 * varient réellement d'une circonscription à l'autre dans ce test. Le reste
 * (inscrits, votants, etc.) est fixé à des valeurs cohérentes mais arbitraires. */
function fixedColumns(codeDepartement: string, codeCirconscription: string, libelle: string): string[] {
  return [
    codeDepartement,
    'Dépt test',
    codeCirconscription,
    libelle,
    '1000', // Inscrits
    '600', // Votants
    '60,00%',
    '400', // Abstentions
    '40,00%',
    '580', // Exprimés
    '58,00%',
    '96,67%',
    '15', // Blancs
    '1,50%',
    '2,50%',
    '5', // Nuls
    '0,50%',
    '0,83%',
  ]
}

function candidateBlock(fields: {
  nom: string
  prenom: string
  voix: string
  elu?: boolean
  nuance?: string
  numeroPanneau?: string
}): string[] {
  const { nom, prenom, voix, elu = false, nuance = 'DIV', numeroPanneau = '1' } = fields
  return [numeroPanneau, nuance, nom, prenom, 'MASCULIN', voix, '10,00%', '20,00%', elu ? 'élu' : '']
}

const MINIMAL_HEADER_1_BLOC = [
  ...Array.from({ length: 18 }, (_, i) => `fixe${i + 1}`),
  'panneau1',
  'nuance1',
  'nom1',
  'prenom1',
  'sexe1',
  'voix1',
  'pctIns1',
  'pctExp1',
  'elu1',
]

/**
 * Écrit un fichier au format large synthétique, un seul bloc candidat par
 * ligne, pour construire des scénarios précis sans dépendre des fixtures
 * réelles. Chaque `row` fournit ses 18 colonnes fixes puis un unique bloc.
 */
async function ecrireCsvUnBlocParLigne(path: string, rows: string[][]): Promise<void> {
  const lines = [MINIMAL_HEADER_1_BLOC.join(';'), ...rows.map((row) => row.join(';'))]
  await writeFile(path, lines.join('\n') + '\n', 'utf-8')
}

// La plupart des tests de ce fichier tournent sur des fixtures réduites, pas
// sur les fichiers réels : ils doivent rester indépendants du contenu réel de
// `data/identity-decisions.yaml` (chemin par défaut de `normalizeResultats`),
// qui porte désormais de vraies décisions pour le 2nd tour (plan 5, tâche 4)
// absentes de ces fixtures. Sans ce chemin isolé, ces décisions viseraient
// des sourceKey introuvables dans la fixture et feraient échouer
// `assertDecisionsAreResolvable` — un couplage accidentel avec le fichier de
// production, pas une vraie régression.
let emptyDecisionsDir: string
let EMPTY_DECISIONS_PATH: string

beforeAll(async () => {
  emptyDecisionsDir = await mkdtemp(join(tmpdir(), 'poligraph-resultats-empty-decisions-'))
  EMPTY_DECISIONS_PATH = join(emptyDecisionsDir, 'decisions.yaml')
  await writeFile(EMPTY_DECISIONS_PATH, 'decisions: []\n', 'utf-8')
})

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await rm(emptyDecisionsDir, { recursive: true, force: true })
  await prisma.$disconnect()
})

describe('districtCodeFromCirconscription', () => {
  it('le code court du 1er tour (101) et le code long du 2nd tour (0101) donnent tous deux 01-1', () => {
    expect(districtCodeFromCirconscription('101')).toBe('01-1')
    expect(districtCodeFromCirconscription('0101')).toBe('01-1')
  })

  it('complète aussi la forme courte 901 en 09-1', () => {
    expect(districtCodeFromCirconscription('901')).toBe('09-1')
  })

  it('ne complète pas un code déjà à deux chiffres ou plus (ex. 6908 -> 69-8)', () => {
    expect(districtCodeFromCirconscription('6908')).toBe('69-8')
  })

  it('convertit le code département alphabétique ZZ (Français établis hors de France) en 099', () => {
    expect(districtCodeFromCirconscription('ZZ01')).toBe('099-1')
    expect(districtCodeFromCirconscription('ZZ11')).toBe('099-11')
  })

  it('convertit le code département alphabétique ZX (Saint-Barthélemy et Saint-Martin) en 977', () => {
    expect(districtCodeFromCirconscription('ZX01')).toBe('977-1')
  })
})

describe('normalizeResultats — dépivotage et faits électoraux', () => {
  it('crée une Candidacy par candidat exploitable : 28 pour la fixture du 1er tour', async () => {
    const run = await stageT1('t1-c1')
    const report = await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)

    expect(await prisma.candidacy.count()).toBe(28)
    expect(report.rejected).toBe(0)
  })

  it('crée l’élection 2024, portée par toutes les candidatures créées', async () => {
    const run = await stageT1('t1-c1')
    await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)

    expect(await prisma.election.count()).toBe(1)
    const election = await prisma.election.findFirstOrThrow()
    expect(election.year).toBe(2024)

    const candidacies = await prisma.candidacy.findMany()
    expect(candidacies.every((c) => c.electionId === election.id)).toBe(true)
  })

  it('elected est true uniquement pour le vainqueur marqué, jamais null : circo 901, élue au bloc 4', async () => {
    const run = await stageT1('t1-c1')
    await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)

    const froger = await prisma.candidacy.findFirstOrThrow({ where: { displayName: 'Martine FROGER' } })
    expect(froger.elected).toBe(true)

    // Les trois autres candidats de la même circonscription (901), y compris
    // ceux qui précèdent le vainqueur dans le fichier, ne sont pas élus.
    const autresDe901 = await prisma.candidacy.findMany({
      where: { displayName: { in: ['Jean-Marc GARNIER', 'Pascal MASCETTI', 'Gisèle LAPEYRE'] } },
    })
    expect(autresDe901).toHaveLength(3)
    expect(autresDe901.every((c) => c.elected === false)).toBe(true)
    expect(autresDe901.every((c) => c.elected !== null)).toBe(true)
  })

  it('76 élus au premier tour... vérifié ici sur la fixture réduite : exactement 2 élus (205 et 901)', async () => {
    const run = await stageT1('t1-c1')
    await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)

    const elus = await prisma.candidacy.findMany({ where: { elected: true } })
    expect(elus).toHaveLength(2)
  })

  it('les voix et pourcentages sont convertis à la normalisation, pas au staging : Xavier Breton, 33889 voix', async () => {
    const run = await stageT2('t2-c1')
    await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)

    const breton = await prisma.candidacy.findFirstOrThrow({ where: { displayName: 'Xavier BRETON' } })
    expect(breton.votes).toBe(33889)
    expect(typeof breton.votes).toBe('number')
    expect(breton.votePctRegistered?.toString()).toBe('39.02')
    expect(breton.votePctExpressed?.toString()).toBe('56.48')
    expect(breton.round).toBe(2)
    expect(breton.elected).toBe(true)
  })

  it('rattache le territoire à la candidature quand la circonscription se résout, y compris via la forme courte du 1er tour (901 -> 09-1)', async () => {
    await seedTerritory('09-1', "1ère circonscription de l'Ariège")
    const run = await stageT1('t1-c1')
    await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)

    const froger = await prisma.candidacy.findFirstOrThrow({ where: { displayName: 'Martine FROGER' } })
    const territory = await prisma.territory.findUniqueOrThrow({ where: { type_code: { type: 'CIRCONSCRIPTION', code: '09-1' } } })
    expect(froger.territoryId).toBe(territory.id)
  })

  it('la forme longue du 2nd tour (0101) résout le même territoire que la forme courte du 1er tour (101) résoudrait', async () => {
    await seedTerritory('01-1', "1ère circonscription de l'Ain")
    const run = await stageT2('t2-c1')
    await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)

    const breton = await prisma.candidacy.findFirstOrThrow({ where: { displayName: 'Xavier BRETON' } })
    const territory = await prisma.territory.findUniqueOrThrow({ where: { type_code: { type: 'CIRCONSCRIPTION', code: '01-1' } } })
    expect(breton.territoryId).toBe(territory.id)
  })

  it('écrit les chiffres de participation dans silver.election_turnout, une ligne par circonscription et par tour', async () => {
    await seedTerritory('01-1', "1ère circonscription de l'Ain")
    await seedTerritory('01-3', "3ème circonscription de l'Ain")
    await seedTerritory('69-8', 'Rhône 8')
    const run = await stageT2('t2-c1')
    await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)

    expect(await prisma.electionTurnout.count()).toBe(3)
    const territory = await prisma.territory.findUniqueOrThrow({ where: { type_code: { type: 'CIRCONSCRIPTION', code: '01-1' } } })
    const turnout = await prisma.electionTurnout.findFirstOrThrow({ where: { territoryId: territory.id } })
    expect(turnout.registered).toBe(86854)
    expect(turnout.voters).toBe(62311)
    expect(turnout.abstentions).toBe(86854 - 62311)
    expect(turnout.round).toBe(2)
  })

  it('réimporter le même fichier remplace les chiffres de participation plutôt que de les accumuler', async () => {
    await seedTerritory('01-1', "1ère circonscription de l'Ain")
    await seedTerritory('01-3', "3ème circonscription de l'Ain")
    await seedTerritory('69-8', 'Rhône 8')
    const run = await stageT2('t2-c1')
    await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)
    await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)

    expect(await prisma.electionTurnout.count()).toBe(3)
  })

  it('est idempotent : rejouer la normalisation ne crée rien de plus', async () => {
    const run = await stageT1('t1-c1')
    await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)

    const before = {
      candidacy: await prisma.candidacy.count(),
      election: await prisma.election.count(),
      identityMatch: await prisma.identityMatch.count(),
    }

    await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)

    expect(await prisma.candidacy.count()).toBe(before.candidacy)
    expect(await prisma.election.count()).toBe(before.election)
    expect(await prisma.identityMatch.count()).toBe(before.identityMatch)
  })
})

describe('normalizeResultats — résolution d’identité', () => {
  it('un candidat élu dont la personne est connue (mandat post-élection, seul homonyme du fichier) résout CONFIRMED et sa candidature est rattachée', async () => {
    const bretonId = await seedXavierBretonAvecMandat('2024-07-07')
    const run = await stageT2('t2-c1')
    await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)

    const match = await prisma.identityMatch.findFirstOrThrow({
      where: { sourceId: 'DATA_GOUV', sourceKey: { contains: 'breton' } },
    })
    expect(match.confidence).toBe('CONFIRMED')
    expect(match.personId).toBe(bretonId)
    expect(match.evidence).toContain('ELECTED_MANDATE')

    const candidacy = await prisma.candidacy.findFirstOrThrow({ where: { displayName: 'Xavier BRETON' } })
    expect(candidacy.personId).toBe(bretonId)
    expect(candidacy.elected).toBe(true)
  })

  it('un mandat antérieur à l’élection ne corrobore pas : non rattaché', async () => {
    await seedXavierBretonAvecMandat('2017-06-21')
    const run = await stageT2('t2-c1')
    await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)

    const candidacy = await prisma.candidacy.findFirstOrThrow({ where: { displayName: 'Xavier BRETON' } })
    expect(candidacy.personId).toBeNull()
  })

  it("une décision visant le 2nd tour ne fait pas échouer la normalisation du 1er tour (les deux tours partagent le sourceId DATA_GOUV mais sont des runs distincts)", async () => {
    const person = await prisma.person.create({
      data: {
        displayName: 'Xavier Breton',
        firstName: 'Xavier',
        lastName: 'Breton',
        matchKey: 'xavier|breton',
        birthDate: null,
      },
    })
    await prisma.externalIdentifier.create({
      data: { ownerType: 'Person', ownerId: person.id, sourceId: 'AN', kind: 'ACTEUR_UID', value: 'PA900001' },
    })

    const dir = await mkdtemp(join(tmpdir(), 'poligraph-resultats-decision-2e-tour-'))
    const decisionsPath = join(dir, 'decisions.yaml')
    try {
      await writeFile(
        decisionsPath,
        `decisions:
  - decision: MERGE
    left:  { source: DATA_GOUV, key: "2|01-1|3|xavier|breton" }
    right: { source: AN, key: "PA900001" }
    reason: "test : la clé ne figure que dans le fichier du 2nd tour"
    decidedOn: 2026-08-26
`,
        'utf-8',
      )

      // Le 1er tour ne connaît pas cette sourceKey (préfixée "2|") : la
      // normalisation ne doit pas lever d'erreur pour autant.
      const runT1 = await stageT1('t1-decision-round-scope')
      await expect(normalizeResultats(prisma, runT1, decisionsPath)).resolves.toBeDefined()

      // Le 2nd tour, lui, la connaît : la décision s'y applique normalement.
      const runT2 = await stageT2('t2-decision-round-scope')
      await normalizeResultats(prisma, runT2, decisionsPath)

      const match = await prisma.identityMatch.findFirstOrThrow({
        where: { sourceId: 'DATA_GOUV', sourceKey: '2|01-1|3|xavier|breton' },
      })
      expect(match.personId).toBe(person.id)
      expect(match.confidence).toBe('CONFIRMED')
      expect(match.decidedBy).toBe('HUMAN')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("l'unicité par circonscription se calcule sur l'ensemble du fichier : un homonyme placé loin derrière défait le premier candidat", async () => {
    const institution = await prisma.institution.upsert({
      where: { code: 'TEST_INSTITUTION' },
      update: {},
      create: { code: 'TEST_INSTITUTION', label: 'Institution de test' },
    })
    const territoryId = await seedTerritory('01-1', "1ère circonscription de l'Ain")
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
        naturalKey: `test-dupont-${person.id}`,
        personId: person.id,
        institutionId: institution.id,
        territoryId,
        kind: 'PARLIAMENTARY',
        startDate: new Date('2024-07-08'),
      },
    })

    const dir = await mkdtemp(join(tmpdir(), 'poligraph-resultats-homonyme-tardif-'))
    const path = join(dir, 'homonyme-tardif.csv')
    try {
      const rows: string[][] = []
      rows.push([...fixedColumns('1', '101', 'Ain - 1ère circo'), ...candidateBlock({ nom: 'DUPONT', prenom: 'Jean', voix: '400', elu: true })])
      for (let i = 0; i < 50; i++) {
        rows.push([
          ...fixedColumns(String(100 + i), `${100 + i}01`, `Filler ${i}`),
          ...candidateBlock({ nom: `TEMOIN${i}`, prenom: `Prenom${i}`, voix: '10' }),
        ])
      }
      rows.push([
        ...fixedColumns('1', '101', 'Ain - 1ère circo'),
        ...candidateBlock({ nom: 'DUPONT', prenom: 'Jean', voix: '5', numeroPanneau: '2' }),
      ])
      await ecrireCsvUnBlocParLigne(path, rows)

      const homonymeDescriptor: ResourceDescriptor = { ...t2Descriptor, resourceExternalId: 'homonyme-tardif.csv' }
      const run = await openImportRun(prisma, homonymeDescriptor, 'homonyme-tardif')
      if (!run) throw new Error('run attendu')
      await stageResultats(prisma, path, run)
      await normalizeResultats(prisma, run, EMPTY_DECISIONS_PATH)

      const dupontCandidacies = await prisma.candidacy.findMany({ where: { displayName: 'Jean DUPONT' } })
      expect(dupontCandidacies).toHaveLength(2)
      // Ni l'un ni l'autre n'est CONFIRMÉ : deux homonymes se présentaient
      // dans la même circonscription. Une implémentation qui compterait au
      // fil de l'eau confirmerait à tort le premier (élu, ligne 1) avant
      // même de lire le second (ligne 52).
      expect(dupontCandidacies.every((c) => c.personId === null)).toBe(true)

      const matches = await prisma.identityMatch.findMany({ where: { sourceId: 'DATA_GOUV', personId: person.id } })
      expect(matches.every((m) => m.confidence !== 'CONFIRMED')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
