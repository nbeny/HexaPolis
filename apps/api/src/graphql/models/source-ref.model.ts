import { Field, ID, ObjectType } from '@nestjs/graphql'

/**
 * Deux niveaux de provenance, spec §8.2 : chaque objet porte `sources`,
 * suffisant pour « source : Assemblée nationale, importé le 25/08/2026 » ;
 * le détail au champ, jusqu'à la ligne bronze, reste la query `provenance`
 * dédiée (voir `ProvenanceRecord`).
 */
@ObjectType()
export class SourceRef {
  @Field(() => ID)
  sourceId!: string

  @Field()
  label!: string

  @Field({ nullable: true })
  importedAt?: Date
}
