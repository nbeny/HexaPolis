import { PrismaClient } from '@prisma/client'

export * from '@prisma/client'

let client: PrismaClient | undefined

export function getPrisma(): PrismaClient {
  client ??= new PrismaClient()
  return client
}
