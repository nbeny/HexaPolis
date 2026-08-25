import type { Provider } from '@nestjs/common'
import { getPrisma, type PrismaClient } from '@poligraph/db'

/**
 * Jeton d'injection pour le `PrismaClient` partagé. Indirection volontaire
 * plutôt qu'un import direct de `getPrisma()` dans chaque dépôt : elle seule
 * permet aux tests de substituer le client de test (`DATABASE_URL_TEST`) via
 * `overrideProvider`, sans toucher au singleton du process réel.
 */
export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT')

export const prismaProvider: Provider = {
  provide: PRISMA_CLIENT,
  useFactory: (): PrismaClient => getPrisma(),
}
