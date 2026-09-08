import type { PrismaClient } from '@poligraph/db'
import type { ImportRunRef, NormalizeReport } from '../../contract.js'

/**
 * Placeholder — la tâche 4 du plan p8 implémente la provenance des
 * contours (rattachement `silver.territory` → `bronze.geo_circonscription_raw`
 * et comptage des 18 territoires que la source ne cartographie pas). Ce
 * module existe seulement pour que `GeoAdapter` compile avant que la tâche 4
 * ne le remplisse.
 */
export async function normalizeGeo(
  _prisma: PrismaClient,
  _run: ImportRunRef,
): Promise<NormalizeReport> {
  return { created: 0, updated: 0, unchanged: 0, rejected: 0, pending: 0 }
}
