import { Args, ID, Query, Resolver } from '@nestjs/graphql'
import { ProvenanceRecord } from '../models/provenance-record.model.js'
import { SourceRef } from '../models/source-ref.model.js'
import { SilverRepository } from '../repositories/silver.repository.js'

/**
 * Requête dédiée du niveau « champ » de la provenance (spec §8.2) : descend
 * jusqu'à la ligne bronze (`bronzeTable` + `bronzeRef`), là où
 * `Deputy.sources` ne donne que la liste dédupliquée des sources d'un objet.
 */
@Resolver()
export class ProvenanceResolver {
  constructor(private readonly silverRepository: SilverRepository) {}

  @Query(() => [ProvenanceRecord])
  async provenance(
    @Args('entityType', { type: () => String }) entityType: string,
    @Args('entityId', { type: () => ID }) entityId: string,
    @Args('field', { type: () => String, nullable: true }) field: string | undefined,
  ): Promise<ProvenanceRecord[]> {
    const rows = await this.silverRepository.provenanceFor(entityType, entityId, field)
    return rows.map((row) => {
      const record = new ProvenanceRecord()
      record.entityType = row.entityType
      record.entityId = row.entityId
      record.field = row.field ?? undefined
      record.importRunId = row.importRunId
      record.bronzeTable = row.bronzeTable
      record.bronzeRef = row.bronzeRef
      record.status = row.status
      record.source = row.source ? Object.assign(new SourceRef(), row.source) : undefined
      return record
    })
  }
}
