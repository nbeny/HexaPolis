import { Module } from '@nestjs/common'
import { prismaProvider } from './prisma.provider.js'
import { GoldRepository } from './repositories/gold.repository.js'
import { SilverRepository } from './repositories/silver.repository.js'
import { DeputyResolver } from './resolvers/deputy.resolver.js'
import { ProvenanceResolver } from './resolvers/provenance.resolver.js'

/**
 * Regroupe tout ce qui compose le schéma : dépôts et résolveurs. Séparé de
 * `ServerModule` (qui ajoute `GraphQLModule.forRoot` et `ThrottlerModule`)
 * pour que les tests puissent construire un module Nest de test qui
 * substitue le `PrismaClient` (jeton `PRISMA_CLIENT`) sans dupliquer le
 * câblage GraphQL/HTTP.
 */
@Module({
  providers: [prismaProvider, GoldRepository, SilverRepository, DeputyResolver, ProvenanceResolver],
  exports: [GoldRepository, SilverRepository],
})
export class GraphqlAppModule {}
