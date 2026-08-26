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
  participation_named_count: number | null
  participation_expressed_count: number | null
  participation_non_voting_count: number | null
  participation_expressed_rate: string | null
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
 * - Fabienne siège aussi depuis le début et l'Assemblée la nomme sur les
 *   deux scrutins éligibles — en NON_VOTANT sur les deux. C'est la forme du
 *   cas réel de Yaël Braun-Pivet (8 341 NON_VOTANT sur 8 434 scrutins
 *   éligibles), pour laquelle l'ancien `participation_rate` affichait
 *   100,00 % sous le libellé « Taux de participation ».
 * - Gaspard mélange les deux : une position exprimée sur un scrutin
 *   éligible, un NON_VOTANT sur l'autre.
 * - Chloé arrive après les deux scrutins existants : aucun scrutin éligible
 *   ne tombe dans son mandat, sa participation doit rester NULL, jamais 0.
 * - Hugo est le cas de l'écart 11 : l'Assemblée ouvre son mandat à
 *   l'ouverture de la législature (`startDate`, comme Alice et Bob) mais
 *   publie une date d'entrée en fonction postérieure aux scrutins A et B —
 *   il remplace un député en mission. Seul le scrutin C, tenu après son
 *   arrivée, peut entrer à son dénominateur. Sur les données réelles c'était
 *   Marie-Sophie Bernadeau (PA793924), entrée en fonction le 2026-07-20 et
 *   mesurée contre les 8 434 scrutins de deux ans de législature : « 4 sur
 *   8 434 — 0,05 % ».
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
  fabienne: string
  gaspard: string
  hugo: string
  ballotA: string
  ballotB: string
  ballotC: string
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
  const fabienne = await prisma.person.create({
    data: {
      displayName: 'Fabienne Nonvotante',
      firstName: 'Fabienne',
      lastName: 'Nonvotante',
      matchKey: 'fabienne|nonvotante',
    },
  })
  const gaspard = await prisma.person.create({
    data: {
      displayName: 'Gaspard Mixte',
      firstName: 'Gaspard',
      lastName: 'Mixte',
      matchKey: 'gaspard|mixte',
    },
  })
  const hugo = await prisma.person.create({
    data: {
      displayName: 'Hugo Remplaçant',
      firstName: 'Hugo',
      lastName: 'Remplaçant',
      matchKey: 'hugo|remplacant',
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
  // Fabienne et Gaspard siègent depuis le début, comme Alice et Bob : les
  // deux scrutins éligibles (A et C) tombent dans leur mandat.
  for (const [naturalKey, personId] of [
    ['mandate-fabienne', fabienne.id],
    ['mandate-gaspard', gaspard.id],
  ] as const) {
    await prisma.mandate.create({
      data: {
        naturalKey,
        personId,
        institutionId: institution.id,
        legislatureId: legislature17.id,
        territoryId: territory.id,
        kind: 'PARLIAMENTARY',
        startDate: new Date('2022-06-22T00:00:00Z'),
        endDate: null,
      },
    })
  }
  // Hugo remplace un député en mission. L'Assemblée ouvre son mandat à la
  // date d'ouverture de la législature, comme celui d'Alice et de Bob, mais
  // publie une date d'entrée en fonction postérieure : il n'est en fonction
  // que depuis le 11 juillet. Les scrutins A (10 juillet) et B (11 juillet,
  // non éligible) ne peuvent pas entrer à son dénominateur ; seul le scrutin C
  // (12 juillet) le peut. `startDate` reste `2022-06-22` : les deux dates sont
  // publiées, la seconde n'écrase pas la première.
  await prisma.mandate.create({
    data: {
      naturalKey: 'mandate-hugo',
      personId: hugo.id,
      institutionId: institution.id,
      legislatureId: legislature17.id,
      territoryId: territory.id,
      kind: 'PARLIAMENTARY',
      startDate: new Date('2022-06-22T00:00:00Z'),
      takingOfficeDate: new Date('2022-07-11T00:00:00Z'),
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
  const ballotC = await prisma.parliamentaryBallot.create({
    data: {
      naturalKey: 'ballot-c',
      legislatureId: legislature17.id,
      date: new Date('2022-07-12T00:00:00Z'),
      title: 'Scrutin C — détail nominatif complet',
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

  // Scrutin C, éligible lui aussi. Alice y vote, Bob n'y est pas nommé —
  // l'écart entre les deux ne s'écrit pas « une absence de Bob ».
  await prisma.ballotPosition.create({
    data: {
      naturalKey: 'position-alice-c',
      ballotId: ballotC.id,
      personId: alice.id,
      position: 'CONTRE',
      bodyIdAtVote: group.id,
    },
  })

  // Fabienne : nommée sur les deux scrutins éligibles, NON_VOTANT sur les
  // deux. L'ancien numérateur la comptait comme participante à 100 %.
  for (const [naturalKey, ballotId] of [
    ['position-fabienne-a', ballotA.id],
    ['position-fabienne-c', ballotC.id],
  ] as const) {
    await prisma.ballotPosition.create({
      data: {
        naturalKey,
        ballotId,
        personId: fabienne.id,
        position: 'NON_VOTANT',
        bodyIdAtVote: group.id,
      },
    })
  }

  // Gaspard : une position exprimée, un non-vote.
  await prisma.ballotPosition.create({
    data: {
      naturalKey: 'position-gaspard-a',
      ballotId: ballotA.id,
      personId: gaspard.id,
      position: 'ABSTENTION',
      bodyIdAtVote: group.id,
    },
  })
  await prisma.ballotPosition.create({
    data: {
      naturalKey: 'position-gaspard-c',
      ballotId: ballotC.id,
      personId: gaspard.id,
      position: 'NON_VOTANT',
      bodyIdAtVote: group.id,
    },
  })

  // Hugo n'a de position que sur le scrutin C, le seul tenu après son entrée
  // en fonction. Aucune sur A : l'Assemblée ne nomme pas un député sur un
  // scrutin antérieur à son arrivée, et lui en créer une ici fabriquerait un
  // fait que la source ne publie jamais.
  await prisma.ballotPosition.create({
    data: {
      naturalKey: 'position-hugo-c',
      ballotId: ballotC.id,
      personId: hugo.id,
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
    fabienne: fabienne.id,
    gaspard: gaspard.id,
    hugo: hugo.id,
    ballotA: ballotA.id,
    ballotB: ballotB.id,
    ballotC: ballotC.id,
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
    'participation_named_count',
    'participation_expressed_count',
    'participation_non_voting_count',
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
    // Alice, Bob, Chloé, Élise, Fabienne, Gaspard, Hugo : 7 députés en
    // exercice. David a quitté son mandat.
    expect(card?.rows).toBe(7)
    // Alice (2) + Bob (2) + Chloé (0) + Élise (0) + Fabienne (2) + Gaspard (2)
    // + Hugo (1) = 9.
    expect(vote?.rows).toBe(9)
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
    // Deux scrutins (A et C) portent une position d'Alice en 17e législature.
    expect(card?.vote_count).toBe(2)
    expect(card?.computed_status).toBe('COMPUTED')
  })

  it('calcule un taux de 100 % quand le député exprime une position sur tous les scrutins éligibles de son mandat', async () => {
    const { alice } = await seed()
    await refreshGold(prisma)

    const card = await cardFor(alice)
    // Deux scrutins publiés en détail nominatif complet (A et C) tombent dans
    // le mandat d'Alice, et elle y a voté : dénominateur honnête de 2.
    expect(card?.participation_ballot_count).toBe(2)
    expect(card?.participation_named_count).toBe(2)
    // Les deux positions sont POUR et CONTRE : deux positions exprimées,
    // aucun non-vote. Le taux ne vaut 100 % que dans ce cas-là.
    expect(card?.participation_expressed_count).toBe(2)
    expect(card?.participation_non_voting_count).toBe(0)
    expect(Number(card?.participation_expressed_rate)).toBeCloseTo(1)
  })

  it("ne compte plus un NON_VOTANT comme une position exprimée : le député nommé partout mais non-votant partout n'est plus à 100 %", async () => {
    const { fabienne } = await seed()
    await refreshGold(prisma)

    const card = await cardFor(fabienne)
    // C'est le défaut corrigé par 20260826174500. L'ancien numérateur
    // comptait toutes les positions, NON_VOTANT comprise : Fabienne est
    // nommée sur les 2 scrutins éligibles, donc 2/2 = « 100 % de
    // participation ». Sur les données réelles, c'était Yaël Braun-Pivet à
    // 8 434/8 434 avec 8 341 NON_VOTANT.
    expect(card?.participation_ballot_count).toBe(2)
    expect(card?.participation_named_count).toBe(2)
    expect(card?.participation_expressed_count).toBe(0)
    expect(card?.participation_non_voting_count).toBe(2)
    // Zéro est ici un fait constaté — la source la nomme, sans jamais porter
    // de position exprimée — et non un silence : il est publié, avec le
    // décompte des non-votes qui le rend lisible.
    expect(Number(card?.participation_expressed_rate)).toBeCloseTo(0)
  })

  it('décompose un député qui exprime une position sur un scrutin et est non-votant sur l’autre', async () => {
    const { gaspard } = await seed()
    await refreshGold(prisma)

    const card = await cardFor(gaspard)
    expect(card?.participation_ballot_count).toBe(2)
    expect(card?.participation_named_count).toBe(2)
    expect(card?.participation_expressed_count).toBe(1)
    expect(card?.participation_non_voting_count).toBe(1)
    expect(Number(card?.participation_expressed_rate)).toBeCloseTo(0.5)
  })

  it('publie un décompte de non-votes à zéro quand la source nomme le député sans jamais l’y porter', async () => {
    const { alice } = await seed()
    await refreshGold(prisma)

    const card = await cardFor(alice)
    // Cas témoin (Alexis Corbière sur les données réelles : 0 NON_VOTANT sur
    // 1 610 scrutins où l'AN le nomme). Zéro est observé, pas déduit d'une
    // absence de donnée : il se publie, contrairement à un numérateur absent.
    expect(card?.participation_non_voting_count).toBe(0)
    expect(card?.participation_named_count).not.toBeNull()
  })

  it("ne compte pas le vote dissident de Bob sur le scrutin B dans sa participation, mais le compte dans vote_count", async () => {
    const { bob } = await seed()
    await refreshGold(prisma)

    const card = await cardFor(bob)
    // Bob a 2 positions enregistrées (A et B) et deux scrutins éligibles
    // (A et C) : le scrutin B, publié sans détail nominatif complet, est
    // exclu du dénominateur comme du numérateur quand bien même Bob y a une
    // ligne, et le scrutin C, éligible, ne porte pas son nom.
    expect(card?.vote_count).toBe(2)
    expect(card?.participation_ballot_count).toBe(2)
    // Nommé sur A seulement : l'écart avec le dénominateur n'est pas une
    // absence constatée, c'est un silence de la source sur le scrutin C.
    expect(card?.participation_named_count).toBe(1)
    expect(card?.participation_expressed_count).toBe(1)
    expect(card?.participation_non_voting_count).toBe(0)
    expect(Number(card?.participation_expressed_rate)).toBeCloseTo(0.5)
  })

  it("laisse la participation absente (NULL) pour un député arrivé après tous les scrutins éligibles, plutôt que d'afficher un zéro trompeur", async () => {
    const { chloe } = await seed()
    await refreshGold(prisma)

    const card = await cardFor(chloe)
    expect(card).toBeDefined()
    expect(card?.mandate_count).toBe(1)
    expect(card?.vote_count).toBe(0)
    // Aucun scrutin éligible ne tombe dans son mandat (elle est arrivée
    // après les scrutins A et C, les seuls nominatifs complets) : NULL, pas 0.
    expect(card?.participation_ballot_count).toBeNull()
    expect(card?.participation_named_count).toBeNull()
    expect(card?.participation_expressed_count).toBeNull()
    expect(card?.participation_non_voting_count).toBeNull()
    expect(card?.participation_expressed_rate).toBeNull()
  })

  it("laisse le numérateur ET le taux à NULL pour un député dont le mandat couvre des scrutins éligibles mais que la source ne nomme sur aucun", async () => {
    const { elise } = await seed()
    await refreshGold(prisma)

    const card = await cardFor(elise)
    expect(card).toBeDefined()
    // Le dénominateur, lui, est un fait vérifiable : les scrutins A et C,
    // publiés en détail nominatif complet, tombent bien dans son mandat.
    expect(card?.participation_ballot_count).toBe(2)
    // Aucune position enregistrée : la source ne la nomme pas. L'import
    // conserve pourtant les positions NON_VOTANT (voir stage-scrutins.ts et
    // VOTE_CATEGORY_KEYS) — un député qui siège sans voter aurait une ligne.
    // Zéro ligne n'établit donc pas qu'elle n'a participé à aucun scrutin.
    expect(card?.vote_count).toBe(0)
    // Les trois décomptes du numérateur sont NULL ensemble : décomposer ne
    // doit pas faire réapparaître un zéro là où la règle posée par
    // 20260826150500 impose NULL.
    expect(card?.participation_named_count).toBeNull()
    expect(card?.participation_expressed_count).toBeNull()
    expect(card?.participation_non_voting_count).toBeNull()
    // C'est la contradiction corrigée par la migration
    // 20260826150500_gold_participation_numerateur_absent : le taux valait
    // 0.0000 (COALESCE du numérateur) pendant que le numérateur valait NULL.
    expect(card?.participation_expressed_rate).toBeNull()
  })

  it('ne publie jamais un taux dont l’un des deux termes est absent', async () => {
    await seed()
    await refreshGold(prisma)

    // Invariance de la vue, vérifiée sur toute la population plutôt que sur un
    // député : `participation_expressed_rate` est renseigné exactement quand
    // ses deux termes le sont. Un COALESCE réintroduit d'un côté seulement
    // casse ici.
    const [row] = await prisma.$queryRaw<{ incoherentes: bigint }[]>`
      SELECT COUNT(*) AS incoherentes
      FROM gold.deputy_card
      WHERE (participation_expressed_rate IS NULL)
        <> (participation_expressed_count IS NULL OR participation_ballot_count IS NULL)
    `
    expect(Number(row?.incoherentes)).toBe(0)
  })

  it("ne publie jamais une décomposition partielle ni un sous-décompte qui déborde son ensemble", async () => {
    await seed()
    await refreshGold(prisma)

    // Deux invariances de la décomposition, vérifiées sur toute la
    // population. La première : les trois décomptes du numérateur sont NULL
    // ensemble ou renseignés ensemble — sans quoi une fiche afficherait
    // « dont non-votant : 0 » à côté d'un numérateur introuvable, c'est-à-dire
    // un chiffre que rien n'a été observé pour soutenir.
    const [partielles] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM gold.deputy_card
      WHERE num_nulls(
        participation_named_count,
        participation_expressed_count,
        participation_non_voting_count
      ) NOT IN (0, 3)
    `
    expect(Number(partielles?.n)).toBe(0)

    // La seconde : chaque décompte tient dans celui qui l'englobe. La fiche
    // les présente comme emboîtés (« dont »), et un « dont » plus grand que
    // son tout serait une fausse affirmation sur une personne nommée.
    const [debordements] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM gold.deputy_card
      WHERE participation_named_count IS NOT NULL
        AND (
          participation_expressed_count > participation_named_count
          OR participation_non_voting_count > participation_named_count
          OR participation_named_count > participation_ballot_count
        )
    `
    expect(Number(debordements?.n)).toBe(0)
  })

  it("ouvre le dénominateur à la date d'entrée en fonction, pas à la date de début du mandat", async () => {
    const { hugo } = await seed()
    await refreshGold(prisma)

    const card = await cardFor(hugo)
    expect(card).toBeDefined()
    // C'est l'assertion qui aurait fait échouer l'écart 11. Le mandat de Hugo
    // démarre le 22 juin, avant les scrutins A (10 juillet) et C (12 juillet) :
    // l'ancienne vue lui comptait donc 2 scrutins éligibles. Il n'est en
    // fonction que depuis le 11 juillet, seul C peut entrer au dénominateur.
    expect(card?.participation_ballot_count).toBe(1)
    expect(card?.participation_named_count).toBe(1)
    expect(card?.participation_expressed_count).toBe(1)
    expect(card?.participation_non_voting_count).toBe(0)
    expect(Number(card?.participation_expressed_rate)).toBeCloseTo(1)
    // Le taux vaut 100 %, sur un seul scrutin. C'est arithmétiquement exact et
    // ce n'est pas comparable au 100 % d'Alice, calculé sur deux : la date
    // d'entrée en fonction remonte jusqu'à la vue pour que la fiche puisse
    // l'afficher à côté du dénominateur.
    expect(card?.taking_office_date).toEqual(new Date('2022-07-11T00:00:00Z'))
  })

  it("continue d'ouvrir le dénominateur à la date de début quand la source ne publie pas d'entrée en fonction", async () => {
    const { alice } = await seed()
    await refreshGold(prisma)

    const card = await cardFor(alice)
    // Alice n'a pas de `takingOfficeDate` : la vue retombe sur `start_date`
    // (22 juin), et les deux scrutins éligibles restent au dénominateur. La
    // retombée est un COALESCE explicite, jamais une date inventée — la
    // colonne reste nulle jusque dans la vue.
    expect(card?.taking_office_date).toBeNull()
    expect(card?.participation_ballot_count).toBe(2)
  })

  it("laisse toute la participation à NULL pour un député entré en fonction après le dernier scrutin éligible", async () => {
    const { hugo } = await seed()
    // Cas réel de Chantal Bouloux (PA793528), entrée en fonction le
    // 2026-08-05, après le dernier scrutin publié en décompte nominatif.
    // Avant l'écart 11, sa fiche affichait « 8 434 scrutins éligibles » et un
    // numérateur introuvable ; le dénominateur lui-même n'existe pas.
    await prisma.mandate.update({
      where: { naturalKey: 'mandate-hugo' },
      data: { takingOfficeDate: new Date('2022-09-01T00:00:00Z') },
    })
    await refreshGold(prisma)

    const card = await cardFor(hugo)
    expect(card).toBeDefined()
    expect(card?.participation_ballot_count).toBeNull()
    // Règle de 20260826150500 préservée : rien ne retombe à zéro.
    expect(card?.participation_named_count).toBeNull()
    expect(card?.participation_expressed_count).toBeNull()
    expect(card?.participation_non_voting_count).toBeNull()
    expect(card?.participation_expressed_rate).toBeNull()
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

    // Alice vote les deux scrutins éligibles (A puis C) : `votesFor` trie par
    // intitulé, donc A d'abord.
    const aliceVotes = await votesFor(alice)
    expect(aliceVotes).toHaveLength(2)
    expect(aliceVotes.map((v) => v.position)).toEqual(['POUR', 'CONTRE'])
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
