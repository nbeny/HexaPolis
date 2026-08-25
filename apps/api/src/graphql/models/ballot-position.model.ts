import { Field, ID, Int, ObjectType } from '@nestjs/graphql'

@ObjectType()
export class BallotPosition {
  @Field(() => ID)
  id!: string

  @Field(() => ID)
  ballotId!: string

  @Field({ nullable: true })
  ballotDate?: Date

  @Field({ nullable: true })
  ballotTitle?: string

  @Field({ nullable: true })
  ballotNumber?: string

  @Field(() => Int, { nullable: true })
  legislatureNumber?: number

  @Field()
  position!: string

  @Field()
  byDelegation!: boolean

  @Field({ nullable: true })
  groupLabelAtVote?: string

  @Field({ nullable: true })
  groupShortLabelAtVote?: string

  @Field({ nullable: true })
  groupColorAtVote?: string

  /**
   * Mode de publication du scrutin par l'AN. Sur un mode autre que
   * `DecompteNominatif`, l'absence d'une ligne pour un scrutin donné signifie
   * que la source n'a pas nommé ce député — jamais qu'il était absent. Voyage
   * sans transformation depuis `gold.deputy_vote.publication_mode`.
   */
  @Field({ nullable: true })
  publicationMode?: string
}
