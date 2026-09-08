import type { PrismaClient } from '@poligraph/db'
import type { ImportRunRef, NormalizeReport } from '../../contract.js'
import { codeGeoDepuisCirconscription } from './codes.js'

const BRONZE_TABLE = 'geo_circonscription_raw'

/**
 * Même forme que `recordProvenance` dans `an/normalize.ts`, avec `field` en
 * plus : un `Territory` peut recevoir d'autres provenances (son rattachement
 * AN, par exemple), et `field: 'geometry'` est ce qui distingue celle du
 * contour. Sans `field` dans le `where` de la vérification d'existence,
 * l'idempotence serait fausse — un deuxième import écrirait une seconde
 * provenance non-géométrie ou masquerait la géométrie derrière une autre.
 */
async function recordGeometryProvenance(
  prisma: PrismaClient,
  run: ImportRunRef,
  territoryId: string,
  bronzeRef: string,
): Promise<boolean> {
  const existing = await prisma.provenance.findFirst({
    where: { entityType: 'Territory', entityId: territoryId, field: 'geometry', importRunId: run.id, bronzeRef },
  })
  if (existing) return false
  await prisma.provenance.create({
    data: {
      entityType: 'Territory',
      entityId: territoryId,
      field: 'geometry',
      importRunId: run.id,
      bronzeTable: BRONZE_TABLE,
      bronzeRef,
      status: 'OFFICIAL',
    },
  })
  return true
}

/**
 * Rattache à chaque `silver.territory` de type CIRCONSCRIPTION la ligne
 * bronze qui porte son contour, sous forme d'une provenance
 * `field: 'geometry'`. La géométrie elle-même reste en bronze — voir
 * `emit-geo.ts` (tâche 5) pour l'asset qui la sert.
 *
 * Les territoires que `codeGeoDepuisCirconscription` traduit en `null` ne
 * reçoivent aucune provenance : c'est un fait sur la source (18 sièges non
 * cartographiés), pas une erreur. Ils ne comptent donc dans aucune des
 * colonnes du rapport.
 */
export async function normalizeGeo(prisma: PrismaClient, run: ImportRunRef): Promise<NormalizeReport> {
  const report: NormalizeReport = { created: 0, updated: 0, unchanged: 0, rejected: 0, pending: 0 }

  const lignes = await prisma.geoCirconscriptionRaw.findMany({ where: { importRunId: run.id } })
  const parCodeGeo = new Map<string, (typeof lignes)[number]>()
  for (const ligne of lignes) {
    if (ligne.codeCirconscription) parCodeGeo.set(ligne.codeCirconscription, ligne)
  }

  const territoires = await prisma.territory.findMany({ where: { type: 'CIRCONSCRIPTION' } })
  const codesReclames = new Set<string>()

  for (const territoire of territoires) {
    const codeGeo = codeGeoDepuisCirconscription(territoire.code)
    if (codeGeo === null) continue // territoire que la source ne cartographie pas : rien à écrire

    const ligne = parCodeGeo.get(codeGeo)
    if (!ligne) {
      // On attendait un contour pour ce territoire et la source de ce run
      // ne le porte pas.
      report.pending++
      continue
    }

    codesReclames.add(codeGeo)
    const cree = await recordGeometryProvenance(prisma, run, territoire.id, String(ligne.ligne))
    if (cree) report.created++
    else report.unchanged++
  }

  for (const ligne of lignes) {
    if (!ligne.codeCirconscription || !codesReclames.has(ligne.codeCirconscription)) {
      report.rejected++
    }
  }

  return report
}
