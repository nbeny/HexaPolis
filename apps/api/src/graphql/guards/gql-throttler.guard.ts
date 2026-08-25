import { Injectable, type ExecutionContext } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'
import { GqlExecutionContext } from '@nestjs/graphql'

/**
 * `ThrottlerGuard` lit `req`/`res` via `context.switchToHttp()`, qui ne
 * fonctionne pas pour un contexte d'exécution GraphQL (type `graphql`, pas
 * `http`) : Apollo mène toutes les requêtes vers un seul point d'entrée HTTP
 * (`POST /graphql`), et c'est ce point d'entrée, pas chaque champ résolu,
 * que le rate limiting doit compter. Pattern documenté par NestJS pour ce
 * cas exact.
 */
@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  protected override getRequestResponse(context: ExecutionContext): {
    req: Record<string, unknown>
    res: Record<string, unknown>
  } {
    const gqlContext = GqlExecutionContext.create(context)
    const ctx = gqlContext.getContext<{ req: Record<string, unknown>; res: Record<string, unknown> }>()
    return { req: ctx.req, res: ctx.res }
  }
}
