import { Field, ID, Int, ObjectType } from '@nestjs/graphql'
import { CampaignAccount } from './campaign-account.model.js'

/**
 * `account` reste `null` quand la candidature n'a pas de compte de campagne
 * rapproché : c'est l'absence explicite requise par le point 2 de la tâche
 * pour la section financement, pas un `CampaignAccount` aux montants à 0.
 */
@ObjectType()
export class Candidacy {
  @Field(() => ID)
  id!: string

  @Field()
  electionLabel!: string

  @Field(() => Int)
  electionYear!: number

  @Field({ nullable: true })
  territoryCode?: string

  @Field({ nullable: true })
  territoryLabel?: string

  @Field({ nullable: true })
  partyName?: string

  @Field({ nullable: true })
  nuance?: string

  @Field()
  displayName!: string

  @Field(() => CampaignAccount, { nullable: true })
  account?: CampaignAccount | null
}
