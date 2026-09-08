// Émet l'asset GeoJSON servi tel quel par le front, depuis les lignes bronze
// du dernier import géo réussi. Ne recompose rien : c'est le staging (tâche
// 3) qui a déjà fidèlement recopié les contours publiés, et ce script se
// contente de sélectionner les trois propriétés utiles à la carte et
// d'écrire le résultat en JSON compact.
//
// N'émet PAS le `payload` bronze entier : le front n'a besoin que du code de
// circonscription, du code de département et de son nom, et chaque propriété
// inutile alourdit le téléchargement de chaque visiteur.
//
// Import contre le `dist/` compilé de `@poligraph/ingestion` — pas son
// `src/`. Un paquet ne peut pas s'auto-importer par son nom sans champ
// `exports` dans son package.json (Node résout alors `@poligraph/ingestion`
// depuis l'intérieur de lui-même en `ERR_MODULE_NOT_FOUND`) : l'import est
// donc relatif, vers `../dist/index.js`. Reconstruire avec `pnpm --filter
// @poligraph/ingestion exec tsc -p tsconfig.json` avant de lancer ce script
// si l'adaptateur géo a changé depuis la dernière compilation.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPrisma } from '@poligraph/db'
import { findLastSuccessfulRun, GeoAdapter, SourceFileClient } from '../dist/index.js'

const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/web/public/geo/circonscriptions.json',
)

async function main(): Promise<void> {
  const prisma = getPrisma()

  try {
    // Le descripteur vient de l'adaptateur plutôt que d'être recopié ici : la
    // même chaîne (`datasetExternalId`) doit servir à ouvrir les runs et à
    // les retrouver, sans deuxième source de vérité qui pourrait diverger.
    const adapter = new GeoAdapter(prisma, new SourceFileClient('.data/geo'))
    const [descriptor] = await adapter.discover()
    if (!descriptor) throw new Error('GeoAdapter.discover() ne déclare aucune ressource')

    const run = await findLastSuccessfulRun(prisma, descriptor)
    if (!run) {
      throw new Error(
        "Aucun import géo réussi en base : lancer l'import `geo:circonscriptions` d'abord " +
          '(pnpm --filter @poligraph/api run cli import geo:circonscriptions), puis relancer ce script.',
      )
    }

    const lignes = await prisma.geoCirconscriptionRaw.findMany({
      where: { importRunId: run.id },
      orderBy: { ligne: 'asc' },
      select: {
        codeCirconscription: true,
        codeDepartement: true,
        nomDepartement: true,
        geometry: true,
      },
    })

    const collection = {
      type: 'FeatureCollection',
      features: lignes.map((ligne) => ({
        type: 'Feature',
        properties: {
          codeCirconscription: ligne.codeCirconscription,
          codeDepartement: ligne.codeDepartement,
          nomDepartement: ligne.nomDepartement,
        },
        geometry: ligne.geometry,
      })),
    }

    await mkdir(dirname(OUTPUT_PATH), { recursive: true })
    // Compact, sans indentation : voir « Écart assumé » en tête du plan pour
    // le choix du GeoJSON brut plutôt que du TopoJSON (1,55 Mo gzippé mesuré).
    await writeFile(OUTPUT_PATH, JSON.stringify(collection))

    console.log(`${collection.features.length} entités écrites dans ${OUTPUT_PATH}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
