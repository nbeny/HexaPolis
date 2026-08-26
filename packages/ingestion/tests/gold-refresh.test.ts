import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { refreshGold } from '../src/gold/refresh.js'
import { resetDatabase, testPrisma } from './helpers/db.js'

const prisma = testPrisma()

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

interface DeputyCardRow {
  person_id: string
  display_name: string
  constituency_code: string | null
  department_code: string | null
  current_group_id: string | null
  current_group_label: string | null
  mandate_count: number
  committee_count: number
  vote_count: number
  participation_ballot_count: number | null
  participation_vote_count: number | null
  participation_rate: string | null
  computed_status: string
}

interface DeputyVoteRow {
  ballot_position_id: string
  person_id: string
  ballot_title: string | null
  position: string
  publication_mode: string | null
  group_label_at_vote: string | null
}

/**
 * Un petit jeu de données couvrant les trois points sensibles de la tâche :
 *
 * - Alice et Bob siègent depuis le début de la législature : leur
 *   participation se calcule sur les deux scrutins ouverts pendant leur
 *   mandat.
 * - Chloé arrive après les deux scrutins existants : aucun scrutin éligible
 *   ne tombe dans son mandat, sa participation doit rester NULL, jamais 0.
 * - Élise siège depuis le début de la législature — le scrutin A, éligible,
 *   tombe donc dans son mandat — mais la source ne la nomme sur aucun
 *   scrutin : elle n'a aucune position enregistrée. Dénominateur connu,
 *   numérateur absent. C'est le cas réel de Chantal Bouloux (PA793528).
 * - David a quitté son mandat (ancien député) : bien qu'il ait une position
 *   de vote enregistrée, il ne doit apparaître dans aucune des deux vues —
 *   ce ne sont pas des fiches pour des députés qui ne siègent plus.
 * - Le scrutin B est publié sans détail nominatif complet : seul Bob, un
 *   dissident, y a une ligne de position. C'est exactement le cas que
 *   publication_mode doit permettre de distinguer d'une absence.
 */
async function seed(): Promise<{
  alice: string
  bob: string
  chloe: string
  david: string
  elise: string
  ballotA: string
  ballotB: string
  group: string
}> {
  const institution = await prisma.institution.create({
    data: { code: 'ASSEMBLEE_NATIONALE', label: 'Assemblée nationale' },
  })
  const legislature17 = await prisma.legislature.create({ data: { number: 17 } })
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
      matchKey: 'alice|dupont',
    },
  })
  const bob = await prisma.person.create({
    data: { displayName: 'Bob Martin', firstName: 'Bob', lastName: 'Martin', matchKey: 'bob|martin' },
  })
  const chloe = await prisma.person.create({
    data: {
      displayName: 'Chloé Retard',
      firstName: 'Chloé',
      lastName: 'Retard',
      matchKey: 'chloe|retard',
    },
  })
  const david = await prisma.person.create({
    data: {
      displayName: 'David Ancien',
      firstName: 'David',
      lastName: 'Ancien',
      matchKey: 'david|ancien',
    },
  })
  const elise = await prisma.person.create({
    data: {
      displayName: 'Élise Innommée',
      firstName: 'Élise',
      lastName: 'Innommée',
      matchKey: 'elise|innommee',
    },
  })

  // Alice et Bob siègent depuis le début de la législature.
  await prisma.mandate.create({
    data: {
      naturalKey: 'mandate-alice',
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
      naturalKey: 'mandate-bob',
      personId: bob.id,
      institutionId: institution.id,
      legislatureId: legislature17.id,
      territoryId: territory.id,
      kind: 'PARLIAMENTARY',
      startDate: new Date('2022-06-22T00:00:00Z'),
      endDate: null,
    },
  })
  // Chloé arrive après les deux scrutins du jeu de données (élection partielle tardive).
  await prisma.mandate.create({
    data: {
      naturalKey: 'mandate-chloe',
      personId: chloe.id,
      institutionId: institution.id,
      legislatureId: legislature17.id,
      territoryId: territory.id,
      kind: 'PARLIAMENTARY',
      startDate: new Date('2022-08-01T00:00:00Z'),
      endDate: null,
    },
  })
  // Élise siège depuis le début, comme Alice et Bob : le scrutin A tombe donc
  // dans son mandat. Aucune position ne sera créée pour elle — la source ne la
  // nomme nulle part.
  await prisma.mandate.create({
    data: {
      naturalKey: 'mandate-elise',
      personId: elise.id,
      institutionId: institution.id,
      legislatureId: legislature17.id,
      territoryId: territory.id,
      kind: 'PARLIAMENTARY',
      startDate: new Date('2022-06-22T00:00:00Z'),
      endDate: null,
    },
  })
  // David a quitté son mandat : nommé au gouvernement, remplacé.
  await prisma.mandate.create({
    data: {
      naturalKey: 'mandate-david',
      personId: david.id,
      institutionId: institution.id,
      legislatureId: legislature17.id,
      territoryId: territory.id,
      kind: 'PARLIAMENTARY',
      startDate: new Date('2022-06-22T00:00:00Z'),
      endDate: new Date('2022-07-05T00:00:00Z'),
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
      naturalKey: 'membership-bob-group',
      personId: bob.id,
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

  const ballotA = await prisma.parliamentaryBallot.create({
    data: {
      naturalKey: 'ballot-a',
      legislatureId: legislature17.id,
      date: new Date('2022-07-10T00:00:00Z'),
      title: 'Scrutin A — détail nominatif complet',
      publicationMode: 'DecompteNominatif',
    },
  })
  const ballotB = await prisma.parliamentaryBallot.create({
    data: {
      naturalKey: 'ballot-b',
      legislatureId: legislature17.id,
      date: new Date('2022-07-11T00:00:00Z'),
      title: 'Scrutin B — dissidents et position de groupe',
      publicationMode: 'DecompteDissidentsPositionGroupe',
    },
  })

  // Scrutin A : détail nominatif complet, Alice et Bob y ont chacun une position.
  await prisma.ballotPosition.create({
    data: {
      naturalKey: 'position-alice-a',
      ballotId: ballotA.id,
      personId: alice.id,
      position: 'POUR',
      bodyIdAtVote: group.id,
    },
  })
  await prisma.ballotPosition.create({
    data: {
      naturalKey: 'position-bob-a',
      ballotId: ballotA.id,
      personId: bob.id,
      position: 'POUR',
      bodyIdAtVote: group.id,
    },
  })
  // David a voté le scrutin A avant son départ — ne doit pourtant apparaître nulle part.
  await prisma.ballotPosition.create({
    data: {
      naturalKey: 'position-david-a',
      ballotId: ballotA.id,
      personId: david.id,
      position: 'POUR',
      bodyIdAtVote: group.id,
    },
  })

  // Scrutin B : seul Bob, dissident, y est nommé — c'est le mode de publication
  // qui explique l'absence d'Alice, pas une absence réelle.
  await prisma.ballotPosition.create({
    data: {
      naturalKey: 'position-bob-b',
      ballotId: ballotB.id,
      personId: bob.id,
      position: 'CONTRE',
      bodyIdAtVote: group.id,
    },
  })

  return {
    alice: alice.id,
    bob: bob.id,
    chloe: chloe.id,
    david: david.id,
    elise: elise.id,
    ballotA: ballotA.id,
    ballotB: ballotB.id,
    group: group.id,
  }
}

// Les identifiants Prisma sont des colonnes `text`, même lorsqu'ils sont
// générés sous forme d'UUID : les caster en `::uuid` produit
// « operator does not exist: text = uuid ».
/**
 * PostgreSQL rend les `COUNT(*)` en `bigint`, que Prisma expose en `BigInt`
 * JavaScript : `1n` n'est pas égal à `1`. Les compteurs sont ramenés à des
 * nombres ici, pour que les assertions portent sur la valeur et non sur sa
 * représentation.
 */
function toNumbers(row: DeputyCardRow): DeputyCardRow {
  const compteurs = [
    'mandate_count',
    'committee_count',
    'vote_count',
    'participation_ballot_count',
    'participation_vote_count',
  ] as const
  const converti = { ...row }
  for (const cle of compteurs) {
    const valeur = converti[cle] as unknown
    if (typeof valeur === 'bigint') {
      ;(converti as Record<string, unknown>)[cle] = Number(valeur)
    }
  }
  return converti
}

async function cardFor(personId: string): Promise<DeputyCardRow | undefined> {
  const rows = await prisma.$queryRaw<DeputyCardRow[]>`
    SELECT * FROM gold.deputy_card WHERE person_id = ${personId}::text
  `
  return rows[0] ? toNumbers(rows[0]) : undefined
}

async function votesFor(personId: string): Promise<DeputyVoteRow[]> {
  return prisma.$queryRaw<DeputyVoteRow[]>`
    SELECT * FROM gold.deputy_vote WHERE person_id = ${personId}::text ORDER BY ballot_title
  `
}

describe('refreshGold', () => {
  it('rafraîchit les deux vues et rapporte leur nombre de lignes', async () => {
    await seed()

    const results = await refreshGold(prisma)

    expect(results.map((r) => r.view)).toEqual(['gold.deputy_card', 'gold.deputy_vote'])
    for (const result of results) {
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    }
    const card = results.find((r) => r.view === 'gold.deputy_card')
    const vote = results.find((r) => r.view === 'gold.deputy_vote')
    // Alice, Bob, Chloé, Élise : 4 députés en exercice. David a quitté son
    // mandat.
    expect(card?.rows).toBe(4)
    // Alice (1 position) + Bob (2 positions) + Chloé (0) + Élise (0) = 3.
    expect(vote?.rows).toBe(3)
  })

  it('place un député en exercice dans deputy_card avec ses agrégats', async () => {
    const { alice, group } = await seed()
    await refreshGold(prisma)

    const card = await cardFor(alice)
    expect(card).toBeDefined()
    expect(card?.display_name).toBe('Alice Dupont')
    expect(card?.constituency_code).toBe('01-1')
    expect(card?.department_code).toBe('01')
    expect(card?.current_group_id).toBe(group)
    expect(card?.current_group_label).toBe('Groupe Test')
    expect(card?.mandate_count).toBe(1)
    expect(card?.committee_count).toBe(1)
    // Un seul scrutin (A) porte une position d'Alice en 17e législature.
    expect(card?.vote_count).toBe(1)
    expect(card?.computed_status).toBe('COMPUTED')
  })

  it('calcule une participation de 100 % quand le député a voté tous les scrutins éligibles de son mandat', async () => {
    const { alice } = await seed()
    await refreshGold(prisma)

    const card = await cardFor(alice)
    // Un seul scrutin publié en détail nominatif complet (A) tombe dans le
    // mandat d'Alice, et elle y a voté : dénominateur honnête de 1.
    expect(card?.participation_ballot_count).toBe(1)
    expect(card?.participation_vote_count).toBe(1)
    expect(Number(card?.participation_rate)).toBeCloseTo(1)
  })

  it("ne compte pas le vote dissident de Bob sur le scrutin B dans sa participation, mais le compte dans vote_count", async () => {
    const { bob } = await seed()
    await refreshGold(prisma)

    const card = await cardFor(bob)
    // Bob a 2 positions enregistrées (A et B) mais un seul scrutin éligible
    // (A) : le scrutin B, publié sans détail nominatif complet, est exclu du
    // calcul de participation quand bien même Bob y a une ligne.
    expect(card?.vote_count).toBe(2)
    expect(card?.participation_ballot_count).toBe(1)
    expect(card?.participation_vote_count).toBe(1)
    expect(Number(card?.participation_rate)).toBeCloseTo(1)
  })

  it("laisse la participation absente (NULL) pour un député arrivé après tous les scrutins éligibles, plutôt que d'afficher un zéro trompeur", async () => {
    const { chloe } = await seed()
    await refreshGold(prisma)

    const card = await cardFor(chloe)
    expect(card).toBeDefined()
    expect(card?.mandate_count).toBe(1)
    expect(card?.vote_count).toBe(0)
    // Aucun scrutin éligible ne tombe dans son mandat (elle est arrivée
    // après le scrutin A, seul scrutin nominatif complet) : NULL, pas 0.
    expect(card?.participation_ballot_count).toBeNull()
    expect(card?.participation_vote_count).toBeNull()
    expect(card?.participation_rate).toBeNull()
  })

  it("laisse le numérateur ET le taux à NULL pour un député dont le mandat couvre des scrutins éligibles mais que la source ne nomme sur aucun", async () => {
    const { elise } = await seed()
    await refreshGold(prisma)

    const card = await cardFor(elise)
    expect(card).toBeDefined()
    // Le dénominateur, lui, est un fait vérifiable : le scrutin A, publié en
    // détail nominatif complet, tombe bien dans son mandat.
    expect(card?.participation_ballot_count).toBe(1)
    // Aucune position enregistrée : la source ne la nomme pas. L'import
    // conserve pourtant les positions NON_VOTANT (voir stage-scrutins.ts et
    // VOTE_CATEGORY_KEYS) — un député qui siège sans voter aurait une ligne.
    // Zéro ligne n'établit donc pas qu'elle n'a participé à aucun scrutin.
    expect(card?.vote_count).toBe(0)
    expect(card?.participation_vote_count).toBeNull()
    // C'est la contradiction corrigée par la migration
    // 20260826150500_gold_participation_numerateur_absent : le taux valait
    // 0.0000 (COALESCE du numérateur) pendant que le numérateur valait NULL.
    expect(card?.participation_rate).toBeNull()
  })

  it('ne publie jamais un taux dont l’un des deux termes est absent', async () => {
    await seed()
    await refreshGold(prisma)

    // Invariance de la vue, vérifiée sur toute la population plutôt que sur un
    // député : `participation_rate` est renseigné exactement quand ses deux
    // termes le sont. Un COALESCE réintroduit d'un côté seulement casse ici.
    const [row] = await prisma.$queryRaw<{ incoherentes: bigint }[]>`
      SELECT COUNT(*) AS incoherentes
      FROM gold.deputy_card
      WHERE (participation_rate IS NULL)
        <> (participation_vote_count IS NULL OR participation_ballot_count IS NULL)
    `
    expect(Number(row?.incoherentes)).toBe(0)
  })

  it("exclut un ancien député (mandat terminé) des deux vues gold, même s'il a des positions de vote enregistrées", async () => {
    const { david } = await seed()
    await refreshGold(prisma)

    expect(await cardFor(david)).toBeUndefined()
    expect(await votesFor(david)).toHaveLength(0)
  })

  it('rend les votes de chaque député dans deputy_vote, avec le mode de publication de leur scrutin', async () => {
    const { alice, bob } = await seed()
    await refreshGold(prisma)

    const aliceVotes = await votesFor(alice)
    expect(aliceVotes).toHaveLength(1)
    expect(aliceVotes[0]?.position).toBe('POUR')
    expect(aliceVotes[0]?.publication_mode).toBe('DecompteNominatif')
    expect(aliceVotes[0]?.group_label_at_vote).toBe('Groupe Test')

    const bobVotes = await votesFor(bob)
    expect(bobVotes).toHaveLength(2)
    const byTitle = new Map(bobVotes.map((v) => [v.ballot_title, v]))
    expect(byTitle.get('Scrutin A — détail nominatif complet')?.publication_mode).toBe(
      'DecompteNominatif',
    )
    // C'est cette ligne qui distingue « scrutin non publié nominativement »
    // (absent chez Alice, qui a suivi la position du groupe) d'un vote
    // effectivement enregistré (Bob, dissident) : le mode de publication
    // voyage jusqu'à la ligne, exactement comme l'exige la tâche.
    expect(byTitle.get('Scrutin B — dissidents et position de groupe')?.publication_mode).toBe(
      'DecompteDissidentsPositionGroupe',
    )
  })

  it('reste rafraîchissable une seconde fois sans erreur', async () => {
    await seed()
    await refreshGold(prisma)

    await expect(refreshGold(prisma)).resolves.toBeDefined()
  })
})
