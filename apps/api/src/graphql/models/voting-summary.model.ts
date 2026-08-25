import { Field, Int, Float, ObjectType } from '@nestjs/graphql'
import { FactStatus } from '../common/fact-status.enum.js'

/**
 * Agrégats de `gold.deputy_card` — jamais recalculés à l'affichage (spec
 * §8.3). `status` vaut toujours `COMPUTED` : c'est le marqueur explicite qui
 * distingue ces chiffres des faits officiels (point 1 de la tâche).
 *
 * `participationBallotCount`, `participationVoteCount` et `participationRate`
 * sont nullable et RESTENT `null` quand le dénominateur est invérifiable
 * (député arrivé après tous les scrutins éligibles, intervalle de mandat de
 * fenêtre inconnue) — jamais convertis en 0 (point 2 de la tâche). Voir le
 * commentaire de `gold.deputy_card.participation_rate` dans la migration.
 */
@ObjectType()
export class VotingSummary {
  @Field(() => FactStatus)
  status!: FactStatus

  @Field(() => Int)
  mandateCount!: number

  @Field(() => Int)
  committeeCount!: number

  @Field(() => Int)
  voteCount!: number

  @Field(() => Int, { nullable: true })
  participationBallotCount?: number | null

  @Field(() => Int, { nullable: true })
  participationVoteCount?: number | null

  @Field(() => Float, { nullable: true })
  participationRate?: number | null
}
