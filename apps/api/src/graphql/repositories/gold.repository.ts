import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type PrismaClient } from '@poligraph/db'
import { toNumber } from '../common/numeric.js'
import { PRISMA_CLIENT } from '../prisma.provider.js'

/** Ligne brute de `gold.deputy_card`, colonnes snake_case telles que Postgres les rend. */
interface DeputyCardRawRow {
  person_id: string
  an_id: string | null
  display_name: string
  first_name: string
  last_name: string
  civility: string | null
  birth_date: Date | null
  constituency_code: string | null
  constituency_label: string | null
  department_code: string | null
  current_group_id: string | null
  current_group_label: string | null
  current_group_short_label: string | null
  current_group_color: string | null
  mandate_count: unknown
  committee_count: unknown
  vote_count: unknown
  participation_ballot_count: unknown
  participation_vote_count: unknown
  participation_rate: unknown
  computed_status: string
  refreshed_at: Date
}

export interface DeputyCard {
  personId: string
  anId: string | null
  displayName: string
  firstName: string
  lastName: string
  civility: string | null
  birthDate: Date | null
  constituencyCode: string | null
  constituencyLabel: string | null
  departmentCode: string | null
  currentGroupId: string | null
  currentGroupLabel: string | null
  currentGroupShortLabel: string | null
  currentGroupColor: string | null
  mandateCount: number
  committeeCount: number
  voteCount: number
  participationBallotCount: number | null
  participationVoteCount: number | null
  participationRate: number | null
  computedStatus: string
  refreshedAt: Date
}

function mapCard(row: DeputyCardRawRow): DeputyCard {
  return {
    personId: row.person_id,
    anId: row.an_id,
    displayName: row.display_name,
    firstName: row.first_name,
    lastName: row.last_name,
    civility: row.civility,
    birthDate: row.birth_date,
    constituencyCode: row.constituency_code,
    constituencyLabel: row.constituency_label,
    departmentCode: row.department_code,
    currentGroupId: row.current_group_id,
    currentGroupLabel: row.current_group_label,
    currentGroupShortLabel: row.current_group_short_label,
    currentGroupColor: row.current_group_color,
    mandateCount: toNumber(row.mandate_count) ?? 0,
    committeeCount: toNumber(row.committee_count) ?? 0,
    voteCount: toNumber(row.vote_count) ?? 0,
    participationBallotCount: toNumber(row.participation_ballot_count),
    participationVoteCount: toNumber(row.participation_vote_count),
    participationRate: toNumber(row.participation_rate),
    computedStatus: row.computed_status,
    refreshedAt: row.refreshed_at,
  }
}

interface DeputyVoteRawRow {
  ballot_position_id: string
  person_id: string
  ballot_id: string
  ballot_date: Date | null
  ballot_title: string | null
  ballot_number: string | null
  legislature_number: number | null
  position: string
  by_delegation: boolean
  group_id_at_vote: string | null
  group_label_at_vote: string | null
  group_short_label_at_vote: string | null
  group_color_at_vote: string | null
  publication_mode: string | null
}

export interface DeputyVote {
  ballotPositionId: string
  personId: string
  ballotId: string
  ballotDate: Date | null
  ballotTitle: string | null
  ballotNumber: string | null
  legislatureNumber: number | null
  position: string
  byDelegation: boolean
  groupIdAtVote: string | null
  groupLabelAtVote: string | null
  groupShortLabelAtVote: string | null
  groupColorAtVote: string | null
  publicationMode: string | null
}

function mapVote(row: DeputyVoteRawRow): DeputyVote {
  return {
    ballotPositionId: row.ballot_position_id,
    personId: row.person_id,
    ballotId: row.ballot_id,
    ballotDate: row.ballot_date,
    ballotTitle: row.ballot_title,
    ballotNumber: row.ballot_number,
    legislatureNumber: row.legislature_number,
    position: row.position,
    byDelegation: row.by_delegation,
    groupIdAtVote: row.group_id_at_vote,
    groupLabelAtVote: row.group_label_at_vote,
    groupShortLabelAtVote: row.group_short_label_at_vote,
    groupColorAtVote: row.group_color_at_vote,
    publicationMode: row.publication_mode,
  }
}

export interface DeputyListFilters {
  groupId?: string
  departmentCode?: string
  /**
   * V1 n'expose que la 17e législature (spec §2). `gold.deputy_card` ne
   * porte pas de colonne législature — sa population EST déjà cette
   * frontière. Un filtre explicite sur une autre législature renvoie donc
   * une page vide plutôt qu'une erreur : voir `GoldRepository.listCards`.
   */
  legislature?: number
}

/**
 * Lit exclusivement les vues `gold`, jamais `silver` directement — c'est ce
 * qui rend les agrégats de fiche rapides sans les recalculer à l'affichage
 * (spec §8.3). Voir l'auto-revue de tâche pour la frontière gold/silver
 * exacte et ses conséquences sur la fraîcheur des données.
 */
@Injectable()
export class GoldRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findCardByAnIdPrefix(anIdPrefix: string): Promise<DeputyCard | null> {
    const rows = await this.prisma.$queryRaw<DeputyCardRawRow[]>`
      SELECT * FROM gold.deputy_card WHERE UPPER(an_id) = UPPER(${anIdPrefix}) LIMIT 1
    `
    return rows[0] ? mapCard(rows[0]) : null
  }

  async findCardByPersonId(personId: string): Promise<DeputyCard | null> {
    const rows = await this.prisma.$queryRaw<DeputyCardRawRow[]>`
      SELECT * FROM gold.deputy_card WHERE person_id = ${personId} LIMIT 1
    `
    return rows[0] ? mapCard(rows[0]) : null
  }

  async listCards(
    filters: DeputyListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: DeputyCard[]; totalCount: number }> {
    // gold.deputy_card ne contient que la 17e législature (voir le
    // commentaire de DeputyListFilters) : toute autre valeur demandée est
    // hors périmètre d'affichage, pas une erreur de requête.
    if (filters.legislature !== undefined && filters.legislature !== 17) {
      return { rows: [], totalCount: 0 }
    }

    const conditions: Prisma.Sql[] = []
    if (filters.groupId) conditions.push(Prisma.sql`current_group_id = ${filters.groupId}`)
    if (filters.departmentCode) {
      conditions.push(Prisma.sql`department_code = ${filters.departmentCode}`)
    }
    const where =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<DeputyCardRawRow[]>`
        SELECT * FROM gold.deputy_card ${where}
        ORDER BY last_name, first_name, person_id
        LIMIT ${limit} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM gold.deputy_card ${where}
      `,
    ])

    return {
      rows: rows.map(mapCard),
      totalCount: toNumber(countRows[0]?.count) ?? 0,
    }
  }

  async searchCards(query: string, limit: number): Promise<DeputyCard[]> {
    const pattern = `%${query}%`
    const rows = await this.prisma.$queryRaw<DeputyCardRawRow[]>`
      SELECT * FROM gold.deputy_card
      WHERE display_name ILIKE ${pattern} OR constituency_label ILIKE ${pattern}
      ORDER BY display_name
      LIMIT ${limit}
    `
    return rows.map(mapCard)
  }

  async listVotes(
    personId: string,
    legislature: number | undefined,
    limit: number,
    offset: number,
  ): Promise<{ rows: DeputyVote[]; totalCount: number }> {
    const legislatureCondition =
      legislature === undefined ? Prisma.empty : Prisma.sql`AND legislature_number = ${legislature}`

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<DeputyVoteRawRow[]>`
        SELECT * FROM gold.deputy_vote
        WHERE person_id = ${personId} ${legislatureCondition}
        ORDER BY ballot_date DESC NULLS LAST, ballot_position_id
        LIMIT ${limit} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM gold.deputy_vote
        WHERE person_id = ${personId} ${legislatureCondition}
      `,
    ])

    return {
      rows: rows.map(mapVote),
      totalCount: toNumber(countRows[0]?.count) ?? 0,
    }
  }

  /**
   * `gold.deputy_card` n'agrège que la 17e législature (voir la migration).
   * Pour une législature différente, on compte en direct sur
   * `gold.deputy_vote` — qui couvre tout l'historique du député — plutôt que
   * de recalculer une participation que `gold` ne porte pas pour cette
   * législature. `participationRate` reste `null` dans ce cas : voir
   * `DeputyResolver.votingSummary`.
   */
  async countVotesForLegislature(personId: string, legislature: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM gold.deputy_vote
      WHERE person_id = ${personId} AND legislature_number = ${legislature}
    `
    return toNumber(rows[0]?.count) ?? 0
  }
}
