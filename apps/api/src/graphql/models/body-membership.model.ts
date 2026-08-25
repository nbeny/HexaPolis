import { Field, ID, ObjectType } from '@nestjs/graphql'

/**
 * Sert à la fois `Deputy.groupMemberships` et `Deputy.committees` — l'AN
 * publie déjà groupes et commissions comme des « organes » de même forme
 * (spec §5.2), et `silver.body`/`silver.body_membership` les modélisent avec
 * les mêmes tables.
 */
@ObjectType()
export class BodyMembership {
  @Field(() => ID)
  id!: string

  @Field()
  bodyType!: string

  @Field()
  bodyLabel!: string

  @Field({ nullable: true })
  bodyShortLabel?: string

  @Field({ nullable: true })
  bodyColor?: string

  @Field({ nullable: true })
  quality?: string

  @Field({ nullable: true })
  startDate?: Date

  @Field({ nullable: true })
  endDate?: Date
}
