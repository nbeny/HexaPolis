import { Field, Float, ObjectType } from '@nestjs/graphql'

/**
 * Aucun montant n'est estimé, arrondi ou recalculé (spec §5.4) : chaque
 * champ nullable reste `null` quand la CNCCFP ne l'a pas déclaré, plutôt que
 * `0` — la même règle d'absence que `VotingSummary.participationRate`.
 */
@ObjectType()
export class CampaignAccount {
  @Field()
  currency!: string

  @Field(() => Float, { nullable: true })
  declaredExpenses?: number | null

  @Field(() => Float, { nullable: true })
  declaredIncome?: number | null

  @Field(() => Float, { nullable: true })
  declaredDonations?: number | null

  @Field(() => Float, { nullable: true })
  personalFunds?: number | null

  @Field(() => Float, { nullable: true })
  retainedExpenses?: number | null

  @Field(() => Float, { nullable: true })
  retainedIncome?: number | null

  @Field({ nullable: true })
  decisionCode?: string
}
