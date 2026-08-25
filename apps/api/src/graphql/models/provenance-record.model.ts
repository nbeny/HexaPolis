import { Field, ID, ObjectType } from '@nestjs/graphql'
import { FactStatus } from '../common/fact-status.enum.js'
import { SourceRef } from './source-ref.model.js'

/**
 * Descend jusqu'à la ligne bronze (spec §8.2) : `bronzeTable` + `bronzeRef`
 * identifient la ligne de staging exacte d'où vient le fait, `importRunId`
 * l'exécution d'import qui l'a écrite.
 */
@ObjectType()
export class ProvenanceRecord {
  @Field()
  entityType!: string

  @Field(() => ID)
  entityId!: string

  @Field({ nullable: true })
  field?: string

  @Field(() => ID)
  importRunId!: string

  @Field()
  bronzeTable!: string

  @Field()
  bronzeRef!: string

  @Field(() => FactStatus)
  status!: FactStatus

  @Field(() => SourceRef, { nullable: true })
  source?: SourceRef
}
