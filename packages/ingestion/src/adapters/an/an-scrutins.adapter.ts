import type { PrismaClient } from '@poligraph/db'
import type {
  FetchedFile,
  ImportRunRef,
  NormalizeReport,
  ResourceDescriptor,
  SourceAdapter,
  StageReport,
} from '../../contract.js'
import { AssembleeNationaleClient } from '../../http/an-client.js'
import { normalizeScrutins } from './normalize-scrutins.js'
import { stageScrutins } from './stage-scrutins.js'

const BASE = 'https://data.assemblee-nationale.fr/static/openData/repository'

/**
 * Le nom du fichier change selon la législature : suffixe romain pour les 14e
 * et 15e, aucun suffixe ensuite. Vérifié sur les archives publiées.
 */
const FICHIERS: Record<number, string> = {
  14: 'Scrutins_XIV.json.zip',
  15: 'Scrutins_XV.json.zip',
  16: 'Scrutins.json.zip',
  17: 'Scrutins.json.zip',
}

export const LEGISLATURES_DISPONIBLES = [14, 15, 16, 17] as const

export class AnScrutinsAdapter implements SourceAdapter {
  readonly source = 'AN' as const

  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: AssembleeNationaleClient,
    private readonly legislatures: readonly number[] = LEGISLATURES_DISPONIBLES,
  ) {}

  async discover(): Promise<ResourceDescriptor[]> {
    return this.legislatures.map((legislature) => {
      const fichier = FICHIERS[legislature]
      if (!fichier) throw new Error(`Législature non couverte : ${legislature}`)
      return {
        sourceKey: 'AN' as const,
        datasetExternalId: `scrutins-${legislature}`,
        datasetTitle: `Scrutins — ${legislature}e législature`,
        resourceExternalId: `${legislature}-${fichier}`,
        url: `${BASE}/${legislature}/loi/scrutins/${fichier}`,
        format: 'zip',
      }
    })
  }

  fetch(descriptor: ResourceDescriptor): Promise<FetchedFile> {
    return this.client.fetch(descriptor)
  }

  stage(file: FetchedFile, run: ImportRunRef): Promise<StageReport> {
    return stageScrutins(this.prisma, file.localPath, run)
  }

  normalize(run: ImportRunRef): Promise<NormalizeReport> {
    return normalizeScrutins(this.prisma, run)
  }
}
