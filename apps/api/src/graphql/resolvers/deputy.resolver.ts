import { Args, ID, Int, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql'
import { anIdFromSlug, buildDeputySlug } from '../common/slug.js'
import { decodeCursor, encodeCursor } from '../common/cursor.js'
import { clampPageSize, clampSearchLimit } from '../common/pagination.js'
import { FactStatus } from '../common/fact-status.enum.js'
import { BallotPosition } from '../models/ballot-position.model.js'
import { BodyMembership } from '../models/body-membership.model.js'
import { Candidacy } from '../models/candidacy.model.js'
import { Deputy, BallotPositionConnection, DeputyConnection } from '../models/deputy.model.js'
import { Mandate } from '../models/mandate.model.js'
import { SearchHit } from '../models/search-hit.model.js'
import { SourceRef } from '../models/source-ref.model.js'
import { VotingSummary } from '../models/voting-summary.model.js'
import type { DeputyCard, DeputyVote } from '../repositories/gold.repository.js'
import { GoldRepository } from '../repositories/gold.repository.js'
import { SilverRepository } from '../repositories/silver.repository.js'

/**
 * Bâtit la coquille d'identité d'un `Deputy` depuis une ligne
 * `gold.deputy_card`. Les champs relationnels (mandats, appartenances,
 * candidatures, sources, votes, synthèse) ne sont volontairement PAS
 * renseignés ici : ce sont des `@ResolveField`, résolus seulement si le
 * client les sélectionne. `id` porte l'identifiant interne (`silver.person.id`) ;
 * `slug` est bâti sur l'identifiant AN (voir `common/slug.ts`).
 */
function cardToDeputy(card: DeputyCard): Deputy {
  const deputy = new Deputy()
  deputy.id = card.personId
  deputy.slug = buildDeputySlug(card.anId ?? card.personId, card.displayName)
  deputy.displayName = card.displayName
  deputy.firstName = card.firstName
  deputy.lastName = card.lastName
  deputy.civility = card.civility ?? undefined
  deputy.birthDate = card.birthDate ?? undefined
  deputy.constituencyCode = card.constituencyCode ?? undefined
  deputy.constituencyLabel = card.constituencyLabel ?? undefined
  deputy.departmentCode = card.departmentCode ?? undefined
  deputy.currentGroupId = card.currentGroupId ?? undefined
  deputy.currentGroupLabel = card.currentGroupLabel ?? undefined
  deputy.currentGroupShortLabel = card.currentGroupShortLabel ?? undefined
  deputy.currentGroupColor = card.currentGroupColor ?? undefined
  return deputy
}

function voteToBallotPosition(vote: DeputyVote): BallotPosition {
  const position = new BallotPosition()
  position.id = vote.ballotPositionId
  position.ballotId = vote.ballotId
  position.ballotDate = vote.ballotDate ?? undefined
  position.ballotTitle = vote.ballotTitle ?? undefined
  position.ballotNumber = vote.ballotNumber ?? undefined
  position.legislatureNumber = vote.legislatureNumber ?? undefined
  position.position = vote.position
  position.byDelegation = vote.byDelegation
  position.groupLabelAtVote = vote.groupLabelAtVote ?? undefined
  position.groupShortLabelAtVote = vote.groupShortLabelAtVote ?? undefined
  position.groupColorAtVote = vote.groupColorAtVote ?? undefined
  position.publicationMode = vote.publicationMode ?? undefined
  return position
}

@Resolver(() => Deputy)
export class DeputyResolver {
  constructor(
    private readonly goldRepository: GoldRepository,
    private readonly silverRepository: SilverRepository,
  ) {}

  @Query(() => Deputy, { nullable: true })
  async deputy(@Args('slug', { type: () => String }) slug: string): Promise<Deputy | null> {
    const anIdPrefix = anIdFromSlug(slug)
    if (!anIdPrefix) return null
    const card = await this.goldRepository.findCardByAnIdPrefix(anIdPrefix)
    return card ? cardToDeputy(card) : null
  }

  @Query(() => DeputyConnection)
  async deputies(
    @Args('legislature', { type: () => Int, nullable: true }) legislature: number | undefined,
    @Args('groupId', { type: () => ID, nullable: true }) groupId: string | undefined,
    @Args('departmentCode', { type: () => String, nullable: true }) departmentCode: string | undefined,
    @Args('first', { type: () => Int, nullable: true }) first: number | undefined,
    @Args('after', { type: () => String, nullable: true }) after: string | undefined,
  ): Promise<InstanceType<typeof DeputyConnection>> {
    const limit = clampPageSize(first)
    const offset = after ? decodeCursor(after) : 0
    const { rows, totalCount } = await this.goldRepository.listCards(
      { legislature, groupId, departmentCode },
      limit,
      offset,
    )
    const edges = rows.map((card, index) => ({
      cursor: encodeCursor(offset + index + 1),
      node: cardToDeputy(card),
    }))
    return {
      edges,
      pageInfo: {
        hasNextPage: offset + rows.length < totalCount,
        endCursor: edges.at(-1)?.cursor,
      },
      totalCount,
    }
  }

  @Query(() => [SearchHit])
  async search(
    @Args('query', { type: () => String }) query: string,
    @Args('first', { type: () => Int, nullable: true }) first: number | undefined,
  ): Promise<SearchHit[]> {
    const trimmed = query.trim()
    if (!trimmed) return []
    const limit = clampSearchLimit(first)
    const cards = await this.goldRepository.searchCards(trimmed, limit)
    return cards.map((card) => {
      const hit = new SearchHit()
      hit.personId = card.personId
      hit.slug = buildDeputySlug(card.anId ?? card.personId, card.displayName)
      hit.displayName = card.displayName
      hit.constituencyLabel = card.constituencyLabel ?? undefined
      hit.currentGroupLabel = card.currentGroupLabel ?? undefined
      return hit
    })
  }

  @ResolveField(() => [Mandate])
  async mandates(@Parent() deputy: Deputy): Promise<Mandate[]> {
    const rows = await this.silverRepository.mandatesForPerson(deputy.id)
    return rows.map((r) => Object.assign(new Mandate(), r))
  }

  @ResolveField(() => [BodyMembership])
  async groupMemberships(@Parent() deputy: Deputy): Promise<BodyMembership[]> {
    const rows = await this.silverRepository.membershipsForPerson(deputy.id, 'PARLIAMENTARY_GROUP')
    return rows.map((r) => Object.assign(new BodyMembership(), r))
  }

  @ResolveField(() => [BodyMembership])
  async committees(@Parent() deputy: Deputy): Promise<BodyMembership[]> {
    const rows = await this.silverRepository.membershipsForPerson(deputy.id, 'COMMITTEE')
    return rows.map((r) => Object.assign(new BodyMembership(), r))
  }

  @ResolveField(() => [Candidacy])
  async candidacies(@Parent() deputy: Deputy): Promise<Candidacy[]> {
    const rows = await this.silverRepository.candidaciesForPerson(deputy.id)
    return rows.map((r) => Object.assign(new Candidacy(), r))
  }

  @ResolveField(() => [SourceRef])
  async sources(@Parent() deputy: Deputy): Promise<SourceRef[]> {
    const rows = await this.silverRepository.sourcesForEntity('Person', deputy.id)
    return rows.map((r) => Object.assign(new SourceRef(), r))
  }

  @ResolveField(() => BallotPositionConnection)
  async ballotPositions(
    @Parent() deputy: Deputy,
    @Args('legislature', { type: () => Int, nullable: true }) legislature: number | undefined,
    @Args('first', { type: () => Int, nullable: true }) first: number | undefined,
    @Args('after', { type: () => String, nullable: true }) after: string | undefined,
  ): Promise<InstanceType<typeof BallotPositionConnection>> {
    const limit = clampPageSize(first)
    const offset = after ? decodeCursor(after) : 0
    const { rows, totalCount } = await this.goldRepository.listVotes(
      deputy.id,
      legislature,
      limit,
      offset,
    )
    const edges = rows.map((row, index) => ({
      cursor: encodeCursor(offset + index + 1),
      node: voteToBallotPosition(row),
    }))
    return {
      edges,
      pageInfo: {
        hasNextPage: offset + rows.length < totalCount,
        endCursor: edges.at(-1)?.cursor,
      },
      totalCount,
    }
  }

  /**
   * Point 1 de la tâche : `status` porte toujours `COMPUTED`, explicitement
   * — pas seulement déductible du nom du type. Point 2 : les champs de
   * participation restent `null` quand `gold.deputy_card` les porte `null`
   * (dénominateur invérifiable) ou quand `legislature` sort de la 17e — voir
   * `GoldRepository.countVotesForLegislature`, qui ne recalcule jamais une
   * participation que `gold` ne porte pas pour cette législature.
   */
  @ResolveField(() => VotingSummary)
  async votingSummary(
    @Parent() deputy: Deputy,
    @Args('legislature', { type: () => Int, nullable: true }) legislature: number | undefined,
  ): Promise<VotingSummary> {
    const card = await this.goldRepository.findCardByPersonId(deputy.id)
    if (!card) {
      const summary = new VotingSummary()
      summary.status = FactStatus.COMPUTED
      summary.mandateCount = 0
      summary.committeeCount = 0
      summary.voteCount = 0
      summary.participationBallotCount = null
      summary.participationVoteCount = null
      summary.participationRate = null
      return summary
    }

    const summary = new VotingSummary()
    summary.status = FactStatus.COMPUTED
    summary.mandateCount = card.mandateCount
    summary.committeeCount = card.committeeCount

    if (legislature === undefined || legislature === 17) {
      summary.voteCount = card.voteCount
      summary.participationBallotCount = card.participationBallotCount
      summary.participationVoteCount = card.participationVoteCount
      summary.participationRate = card.participationRate
    } else {
      summary.voteCount = await this.goldRepository.countVotesForLegislature(
        deputy.id,
        legislature,
      )
      summary.participationBallotCount = null
      summary.participationVoteCount = null
      summary.participationRate = null
    }

    return summary
  }
}
