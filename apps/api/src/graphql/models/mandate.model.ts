import { Field, ID, Int, ObjectType } from '@nestjs/graphql'

@ObjectType()
export class Mandate {
  @Field(() => ID)
  id!: string

  @Field()
  kind!: string

  @Field()
  institutionLabel!: string

  @Field(() => Int, { nullable: true })
  legislatureNumber?: number

  @Field({ nullable: true })
  territoryCode?: string

  @Field({ nullable: true })
  territoryLabel?: string

  @Field({ nullable: true })
  startDate?: Date

  @Field({ nullable: true })
  endDate?: Date

  @Field({ nullable: true })
  endCause?: string
}
