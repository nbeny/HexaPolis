import { Field, ID, ObjectType } from '@nestjs/graphql'
import { BallotPosition } from './ballot-position.model.js'
import { BodyMembership } from './body-membership.model.js'
import { Candidacy } from './candidacy.model.js'
import { createConnectionType } from '../common/connection.js'
import { Mandate } from './mandate.model.js'
import { SourceRef } from './source-ref.model.js'
import { VotingSummary } from './voting-summary.model.js'

/**
 * Orientée fiche, pas miroir de `silver.person` (spec §8.1). Les champs
 * `mandates`/`groupMemberships`/`committees`/`candidacies` sont résolus
 * depuis `silver` (toujours à jour) ; l'identité et les agrégats depuis
 * `gold.deputy_card` (snapshot rafraîchi en fin d'import) — voir le
 * répertoire `DeputyResolver` pour le détail de cette frontière et
 * l'auto-revue de tâche pour sa justification.
 */
@ObjectType()
export class Deputy {
  @Field(() => ID)
  id!: string

  /** Bâti sur l'identifiant AN — voir `graphql/common/slug.ts`. */
  @Field()
  slug!: string

  @Field()
  displayName!: string

  @Field()
  firstName!: string

  @Field()
  lastName!: string

  @Field({ nullable: true })
  civility?: string

  @Field({ nullable: true })
  birthDate?: Date

  @Field({ nullable: true })
  constituencyCode?: string

  @Field({ nullable: true })
  constituencyLabel?: string

  @Field({ nullable: true })
  departmentCode?: string

  @Field({ nullable: true })
  currentGroupId?: string

  @Field({ nullable: true })
  currentGroupLabel?: string

  @Field({ nullable: true })
  currentGroupShortLabel?: string

  @Field({ nullable: true })
  currentGroupColor?: string

  @Field(() => [Mandate])
  mandates!: Mandate[]

  @Field(() => [BodyMembership])
  groupMemberships!: BodyMembership[]

  @Field(() => [BodyMembership])
  committees!: BodyMembership[]

  // Résolu par un @ResolveField dédié (pagination + filtre législature) :
  // voir DeputyResolver.ballotPositions.
  @Field(() => BallotPositionConnection)
  ballotPositions!: InstanceType<typeof BallotPositionConnection>

  // Résolu par un @ResolveField dédié (argument législature) : voir
  // DeputyResolver.votingSummary.
  @Field(() => VotingSummary)
  votingSummary!: VotingSummary

  @Field(() => [Candidacy])
  candidacies!: Candidacy[]

  @Field(() => [SourceRef])
  sources!: SourceRef[]
}

export const BallotPositionConnection = createConnectionType(BallotPosition, 'BallotPosition')
export const DeputyConnection = createConnectionType(Deputy, 'Deputy')
