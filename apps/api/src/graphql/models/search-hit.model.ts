import { Field, ID, ObjectType } from '@nestjs/graphql'

@ObjectType()
export class SearchHit {
  @Field(() => ID)
  personId!: string

  @Field()
  slug!: string

  @Field()
  displayName!: string

  @Field({ nullable: true })
  constituencyLabel?: string

  @Field({ nullable: true })
  currentGroupLabel?: string
}
