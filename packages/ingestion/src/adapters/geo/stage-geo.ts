import { readFile } from 'node:fs/promises'
import type { PrismaClient } from '@poligraph/db'
import type { ImportRunRef, StageReport } from '../../contract.js'

interface GeoFeature {
  properties?: Record<string, unknown>
  geometry?: unknown
}

/**
 * Charge les contours tels quels en bronze : codes inchangés, géométrie non
 * simplifiée, aucune traduction. C'est la normalisation qui interprète.
 *
 * Le fichier ne publie aucun identifiant d'entité stable ; le rang dans la
 * collection (1-indexé) tient lieu de référence bronze, comme la ligne pour
 * le RNE et la CNCCFP.
 *
 * Le fichier entier est lu en mémoire — 5,4 Mo, contre un flux JSON qui
 * demanderait une dépendance de plus pour un gain nul à cette taille.
 */
export async function stageGeo(
  prisma: PrismaClient,
  path: string,
  run: ImportRunRef,
): Promise<StageReport> {
  const collection = JSON.parse(await readFile(path, 'utf-8')) as { features?: GeoFeature[] }
  const features = collection.features ?? []

  let staged = 0
  let ligne = 0

  for (const feature of features) {
    ligne++
    const p = feature.properties ?? {}
    await prisma.geoCirconscriptionRaw.upsert({
      where: { importRunId_ligne: { importRunId: run.id, ligne } },
      update: {},
      create: {
        importRunId: run.id,
        ligne,
        codeCirconscription: (p.codeCirconscription as string) || null,
        codeDepartement: (p.codeDepartement as string) || null,
        nomCirconscription: (p.nomCirconscription as string) || null,
        nomDepartement: (p.nomDepartement as string) || null,
        geometry: feature.geometry as never,
        payload: p as never,
      },
    })
    staged++
  }

  return { staged, rejected: 0 }
}
