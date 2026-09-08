import type { PrismaClient } from '@poligraph/db'
import type {
  FetchedFile,
  ImportRunRef,
  NormalizeReport,
  ResourceDescriptor,
  SourceAdapter,
  StageReport,
} from '../../contract.js'
import { SourceFileClient } from '../../http/source-file-client.js'
import { normalizeGeo } from './normalize-geo.js'
import { stageGeo } from './stage-geo.js'

/**
 * « Contours géographiques des circonscriptions législatives », data.gouv.fr,
 * Licence Ouverte 2.0, publié le 13/06/2024. Version « simplifiée p20 »,
 * 5,4 Mo, 559 entités pour 577 sièges — les 18 manquants sont un fait sur la
 * source, détaillé dans la spec §4.3 et affiché sous la carte.
 */
const CONTOURS_CIRCONSCRIPTIONS_URL =
  'https://www.data.gouv.fr/api/1/datasets/r/8b681b69-739c-47eb-a96b-06e8e2d8dc08'

export class GeoAdapter implements SourceAdapter {
  readonly source = 'DATA_GOUV' as const

  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: SourceFileClient,
  ) {}

  async discover(): Promise<ResourceDescriptor[]> {
    return [
      {
        sourceKey: 'DATA_GOUV',
        datasetExternalId: 'contours-circonscriptions-legislatives',
        datasetTitle: 'Contours géographiques des circonscriptions législatives',
        resourceExternalId: 'circonscriptions-legislatives-p20.geojson',
        url: CONTOURS_CIRCONSCRIPTIONS_URL,
        format: 'geojson',
      },
    ]
  }

  fetch(descriptor: ResourceDescriptor): Promise<FetchedFile> {
    return this.client.fetch(descriptor)
  }

  stage(file: FetchedFile, run: ImportRunRef): Promise<StageReport> {
    return stageGeo(this.prisma, file.localPath, run)
  }

  normalize(run: ImportRunRef): Promise<NormalizeReport> {
    return normalizeGeo(this.prisma, run)
  }
}
