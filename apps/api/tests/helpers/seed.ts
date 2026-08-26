import type { PrismaClient } from '@poligraph/db'
import { openImportRun, closeImportRun } from '@poligraph/ingestion'
import type { ResourceDescriptor } from '@poligraph/ingestion'

const DESCRIPTOR: ResourceDescriptor = {
  sourceKey: 'AN',
  datasetExternalId: 'amo10-17',
  datasetTitle: 'Députés actifs, mandats et organes — 17e législature',
  resourceExternalId: 'AMO10.json.zip',
  url: 'https://example.invalid/AMO10.json.zip',
  format: 'zip',
}

export interface SeededFiche {
  /** Alice a un mandat ouvert, un historique de deux législatures, deux
   * candidatures (2022 CNCCFP avec compte de campagne rapproché mais sans
   * résultat électoral, 2024 DATA_GOUV avec voix et pourcentages mais sans
   * compte) et de la provenance jusqu'au bronze — le cas « fiche complète ». */
  alice: { id: string; anId: string; slug: string }
  /** Bob a un mandat ouvert mais aucune candidature rattachée — le cas
   * « financement absent », à ne jamais confondre avec un montant à 0. */
  bob: { id: string; anId: string; slug: string }
  group: string
  committee: string
  /** 3 scrutins de la 17e (tous DecompteNominatif, Alice y vote) + 1 de la 16e. */
  ballots17: string[]
  ballot16: string
  importRunId: string
}

/**
 * Jeu de données couvrant les points sensibles de la tâche : une fiche
 * complète (Alice, six sections alimentées), une absence explicite de
 * financement (Bob), assez de positions de vote pour paginer, deux
 * législatures pour le filtre `legislature`, et une chaîne de provenance
 * complète jusqu'à une ligne `bronze.an_acteur_raw` réelle.
 */
export async function seedFiche(prisma: PrismaClient): Promise<SeededFiche> {
  const run = await openImportRun(prisma, DESCRIPTOR, 'checksum-test')
  if (!run) throw new Error('run d’import attendu (checksum non vu auparavant)')

  const institution = await prisma.institution.create({
    data: { code: 'ASSEMBLEE_NATIONALE', label: 'Assemblée nationale' },
  })
  const legislature17 = await prisma.legislature.create({ data: { number: 17 } })
  const legislature16 = await prisma.legislature.create({ data: { number: 16 } })
  const territory = await prisma.territory.create({
    data: { type: 'CIRCONSCRIPTION', code: '01-1', label: '1ère circonscription de l’Ain' },
  })
  const group = await prisma.body.create({
    data: {
      type: 'PARLIAMENTARY_GROUP',
      label: 'Groupe Test',
      shortLabel: 'GT',
      legislatureId: legislature17.id,
      color: '#123456',
    },
  })
  const committee = await prisma.body.create({
    data: { type: 'COMMITTEE', label: 'Commission Test', legislatureId: legislature17.id },
  })

  const alice = await prisma.person.create({
    data: {
      displayName: 'Alice Dupont',
      firstName: 'Alice',
      lastName: 'Dupont',
      civility: 'Mme',
      birthDate: new Date('1975-03-14T00:00:00Z'),
      matchKey: 'alice|dupont',
    },
  })
  const bob = await prisma.person.create({
    data: { displayName: 'Bob Martin', firstName: 'Bob', lastName: 'Martin', matchKey: 'bob|martin' },
  })

  await prisma.externalIdentifier.create({
    data: { ownerType: 'Person', ownerId: alice.id, sourceId: 'AN', kind: 'ACTEUR_UID', value: 'PA000001' },
  })
  await prisma.externalIdentifier.create({
    data: { ownerType: 'Person', ownerId: bob.id, sourceId: 'AN', kind: 'ACTEUR_UID', value: 'PA000002' },
  })

  // Mandat ouvert (17e) + mandat clos (16e) : mandateCount = 2 pour Alice.
  await prisma.mandate.create({
    data: {
      naturalKey: 'mandate-alice-17',
      personId: alice.id,
      institutionId: institution.id,
      legislatureId: legislature17.id,
      territoryId: territory.id,
      kind: 'PARLIAMENTARY',
      startDate: new Date('2022-06-22T00:00:00Z'),
      endDate: null,
    },
  })
  await prisma.mandate.create({
    data: {
      naturalKey: 'mandate-alice-16',
      personId: alice.id,
      institutionId: institution.id,
      legislatureId: legislature16.id,
      territoryId: territory.id,
      kind: 'PARLIAMENTARY',
      startDate: new Date('2017-06-18T00:00:00Z'),
      endDate: new Date('2022-06-21T00:00:00Z'),
    },
  })
  await prisma.mandate.create({
    data: {
      naturalKey: 'mandate-bob-17',
      personId: bob.id,
      institutionId: institution.id,
      legislatureId: legislature17.id,
      territoryId: territory.id,
      kind: 'PARLIAMENTARY',
      startDate: new Date('2022-06-22T00:00:00Z'),
      endDate: null,
    },
  })

  await prisma.bodyMembership.create({
    data: {
      naturalKey: 'membership-alice-group',
      personId: alice.id,
      bodyId: group.id,
      startDate: new Date('2022-06-22T00:00:00Z'),
      endDate: null,
    },
  })
  await prisma.bodyMembership.create({
    data: {
      naturalKey: 'membership-alice-committee',
      personId: alice.id,
      bodyId: committee.id,
      startDate: new Date('2022-07-01T00:00:00Z'),
      endDate: null,
    },
  })
  await prisma.bodyMembership.create({
    data: {
      naturalKey: 'membership-bob-group',
      personId: bob.id,
      bodyId: group.id,
      startDate: new Date('2022-06-22T00:00:00Z'),
      endDate: null,
    },
  })

  // 3 scrutins de la 17e, en détail nominatif complet, Alice et Bob y votent :
  // assez pour paginer (first: 2 puis la suite).
  const ballots17: string[] = []
  for (let i = 0; i < 3; i++) {
    const ballot = await prisma.parliamentaryBallot.create({
      data: {
        naturalKey: `ballot-17-${i}`,
        legislatureId: legislature17.id,
        date: new Date(Date.UTC(2022, 6, 10 + i)),
        title: `Scrutin 17e n°${i}`,
        publicationMode: 'DecompteNominatif',
      },
    })
    ballots17.push(ballot.id)
    await prisma.ballotPosition.create({
      data: {
        naturalKey: `position-alice-17-${i}`,
        ballotId: ballot.id,
        personId: alice.id,
        position: i % 2 === 0 ? 'POUR' : 'CONTRE',
        bodyIdAtVote: group.id,
      },
    })
    // Bob est nommé sur les 3 scrutins, mais NON_VOTANT sur le dernier :
    // l'Assemblée le nomme sans qu'aucune position de fond soit enregistrée.
    // C'est la forme du cas qui faisait afficher « Taux de participation :
    // 100,00 % » sur la fiche de la présidente de l'Assemblée nationale
    // (8 341 NON_VOTANT sur 8 434 scrutins éligibles), et ce qui permet de
    // vérifier ici que l'API expose la décomposition, pas un chiffre unique.
    await prisma.ballotPosition.create({
      data: {
        naturalKey: `position-bob-17-${i}`,
        ballotId: ballot.id,
        personId: bob.id,
        position: i === 2 ? 'NON_VOTANT' : 'POUR',
        bodyIdAtVote: group.id,
      },
    })
  }

  // 1 scrutin de la 16e : seule Alice y a siégé.
  const ballot16 = await prisma.parliamentaryBallot.create({
    data: {
      naturalKey: 'ballot-16-0',
      legislatureId: legislature16.id,
      date: new Date('2018-01-15T00:00:00Z'),
      title: 'Scrutin 16e n°0',
      publicationMode: 'DecompteNominatif',
    },
  })
  await prisma.ballotPosition.create({
    data: {
      naturalKey: 'position-alice-16-0',
      ballotId: ballot16.id,
      personId: alice.id,
      position: 'ABSTENTION',
      bodyIdAtVote: null,
    },
  })

  // Financement : Alice a un compte rapproché, Bob n'en a aucun — c'est
  // cette différence que le point 2 de la tâche exige de rendre explicite.
  const election = await prisma.election.create({
    data: {
      naturalKey: 'legislatives-2022',
      type: 'LEGISLATIVE',
      label: 'Élections législatives 2022',
      year: 2022,
      secondRoundDate: new Date('2022-06-19T00:00:00Z'),
    },
  })
  const candidacy = await prisma.candidacy.create({
    data: {
      naturalKey: 'candidacy-alice-2022',
      electionId: election.id,
      personId: alice.id,
      territoryId: territory.id,
      displayName: 'Alice DUPONT',
      nuance: 'ECO',
    },
  })
  await prisma.campaignAccount.create({
    data: {
      candidacyId: candidacy.id,
      currency: 'EURO',
      declaredExpenses: '1000.00',
      declaredIncome: '1200.00',
      declaredDonations: '50.00',
    },
  })

  // Une seconde candidature (2024, DATA_GOUV), avec résultats officiels —
  // pour distinguer, côté test GraphQL, une candidature que cette source a
  // décrite (voix et pourcentages présents) d'une candidature CNCCFP qui ne
  // l'a pas (round/votes/pourcentages restant `null`, jamais `0`).
  const election2024 = await prisma.election.create({
    data: {
      naturalKey: 'legislatives-2024',
      type: 'LEGISLATIVE',
      label: 'Élections législatives 2024',
      year: 2024,
      secondRoundDate: new Date('2024-07-07T00:00:00Z'),
    },
  })
  await prisma.candidacy.create({
    data: {
      naturalKey: 'legislatives-2024|2|01-1|1|alice|dupont',
      electionId: election2024.id,
      personId: alice.id,
      territoryId: territory.id,
      displayName: 'Alice DUPONT',
      nuance: 'ECO',
      round: 2,
      votes: 33889,
      votePctRegistered: '39.02',
      votePctExpressed: '56.48',
      elected: true,
    },
  })

  // Provenance jusqu'au bronze : une ligne d'entité (Person) et une ligne
  // de champ (birthDate), toutes deux pointant vers la même ligne
  // an_acteur_raw réellement présente en bronze.
  await prisma.anActeurRaw.create({
    data: { importRunId: run.id, entryName: 'PA000001.json', uid: 'PA000001', payload: {} },
  })
  await prisma.provenance.create({
    data: {
      entityType: 'Person',
      entityId: alice.id,
      field: null,
      importRunId: run.id,
      bronzeTable: 'an_acteur_raw',
      bronzeRef: 'PA000001',
      status: 'OFFICIAL',
    },
  })
  await prisma.provenance.create({
    data: {
      entityType: 'Person',
      entityId: alice.id,
      field: 'birthDate',
      importRunId: run.id,
      bronzeTable: 'an_acteur_raw',
      bronzeRef: 'PA000001',
      status: 'OFFICIAL',
    },
  })

  await closeImportRun(prisma, run, { created: 2, updated: 0, unchanged: 0, rejected: 0, pending: 0 })

  return {
    alice: { id: alice.id, anId: 'PA000001', slug: 'pa000001-alice-dupont' },
    bob: { id: bob.id, anId: 'PA000002', slug: 'pa000002-bob-martin' },
    group: group.id,
    committee: committee.id,
    ballots17,
    ballot16: ballot16.id,
    importRunId: run.id,
  }
}
