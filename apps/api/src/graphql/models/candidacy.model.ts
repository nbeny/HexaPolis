import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql'
import { CampaignAccount } from './campaign-account.model.js'

/**
 * `account` reste `null` quand la candidature n'a pas de compte de campagne
 * rapproché : c'est l'absence explicite requise par le point 2 de la tâche
 * pour la section financement, pas un `CampaignAccount` aux montants à 0.
 *
 * `round`, `votes`, `votePctRegistered` et `votePctExpressed` restent `null`
 * pour toute candidature que la source des résultats électoraux (DATA_GOUV,
 * plan 5) n'a pas décrite — notamment les candidatures CNCCFP 2022, qui n'ont
 * ni tour ni voix. Ce sont des faits officiels recopiés tels que publiés,
 * jamais recalculés : ne pas dériver un pourcentage depuis `votes`, même là
 * où le calcul serait trivial. `elected`, lui, n'est jamais `null` — la
 * colonne porte un défaut à `false` (voir `packages/db/prisma/schema.prisma`).
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

  @Field(() => Int, { nullable: true })
  round?: number | null

  @Field(() => Int, { nullable: true })
  votes?: number | null

  @Field(() => Float, { nullable: true })
  votePctRegistered?: number | null

  @Field(() => Float, { nullable: true })
  votePctExpressed?: number | null

  @Field()
  elected!: boolean

  @Field(() => CampaignAccount, { nullable: true })
  account?: CampaignAccount | null
}
