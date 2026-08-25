import { PrismaClient } from '@poligraph/db'

export function testPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL_TEST
  if (!url) throw new Error('DATABASE_URL_TEST doit être défini pour les tests d’intégration')
  return new PrismaClient({ datasources: { db: { url } } })
}

/**
 * Vide toutes les tables métier. Utilisé par chaque suite d'intégration :
 * il n'y a qu'un seul endroit à mettre à jour quand une table est ajoutée.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE bronze.an_acteur_raw, bronze.an_mandat_raw, bronze.an_organe_raw RESTART IDENTITY CASCADE',
  )
  await prisma.$executeRawUnsafe(
    'TRUNCATE silver.import_rejection, silver.import_run, silver.dataset_resource, silver.dataset, silver.source RESTART IDENTITY CASCADE',
  )
  await prisma.$executeRawUnsafe(
    'TRUNCATE silver.provenance, silver.mandate, silver.body_membership, silver.body, silver.territory, silver.legislature, silver.institution, silver.external_identifier, silver.person_name_variant, silver.person RESTART IDENTITY CASCADE',
  )
}
