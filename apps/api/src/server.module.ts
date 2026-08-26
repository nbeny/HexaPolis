import { fileURLToPath } from 'node:url'
import { APP_GUARD } from '@nestjs/core'
import { type DynamicModule, Module } from '@nestjs/common'
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo'
import { GraphQLModule } from '@nestjs/graphql'
import { ThrottlerModule } from '@nestjs/throttler'
import { buildComplexityPlugin, buildDepthLimitRule } from './graphql/complexity.js'
import { GqlThrottlerGuard } from './graphql/guards/gql-throttler.guard.js'
import { GraphqlAppModule } from './graphql/graphql-app.module.js'

export interface ServerModuleOptions {
  /** Limite de profondeur de requête (spec §8.4). Défaut : assez pour une fiche complète, pas pour une requête pathologique. */
  maxDepth?: number
  /** Limite de complexité de requête (spec §8.4). */
  maxComplexity?: number
  /** Rate limiting (spec §8.4) : fenêtre en ms et nombre de requêtes HTTP autorisées dans cette fenêtre, par IP. */
  throttle?: { ttl: number; limit: number }
}

const DEFAULT_OPTIONS: Required<ServerModuleOptions> = {
  maxDepth: 12,
  maxComplexity: 2000,
  throttle: { ttl: 60_000, limit: 120 },
}

/**
 * Module racine du serveur GraphQL, distinct d'`AppModule` (la CLI). Les
 * trois garde-fous requis par la spec §8.4 s'y assemblent : profondeur et
 * complexité via `validationRules` d'Apollo, rate limiting via
 * `ThrottlerModule` + `GqlThrottlerGuard` monté en `APP_GUARD` global.
 *
 * `forRoot` accepte des options pour que les tests puissent resserrer les
 * limites (un `maxDepth` de 12 ne se déclenche jamais sur une requête de
 * test raisonnable ; le test de garde-fou construit son propre module avec
 * une limite volontairement basse).
 */
@Module({})
export class ServerModule {
  static forRoot(options: ServerModuleOptions = {}): DynamicModule {
    const maxDepth = options.maxDepth ?? DEFAULT_OPTIONS.maxDepth
    const maxComplexity = options.maxComplexity ?? DEFAULT_OPTIONS.maxComplexity
    const throttle = options.throttle ?? DEFAULT_OPTIONS.throttle

    return {
      module: ServerModule,
      imports: [
        ThrottlerModule.forRoot([{ ttl: throttle.ttl, limit: throttle.limit }]),
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: fileURLToPath(new URL('../schema.gql', import.meta.url)),
          sortSchema: true,
          playground: false,
          introspection: true,
          validationRules: buildDepthLimitRule(maxDepth),
          plugins: [buildComplexityPlugin(maxComplexity)],
          context: ({ req, res }: { req: unknown; res: unknown }) => ({ req, res }),
        }),
        GraphqlAppModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: GqlThrottlerGuard }],
    }
  }
}
