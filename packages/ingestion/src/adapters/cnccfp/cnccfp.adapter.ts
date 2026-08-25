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
import { normalizeCnccfp } from './normalize-cnccfp.js'
import { stageCnccfp } from './stage-cnccfp.js'

const CNCCFP_LEGISLATIVES_2022_URL =
  'https://static.data.gouv.fr/resources/comptes-de-campagne-elections-legislatives-generales-des-12-et-19-juin-2022/20231012-135051/publications-2022-lg.csv'

export class CnccfpAdapter implements SourceAdapter {
  readonly source = 'CNCCFP' as const

  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: SourceFileClient,
  ) {}

  async discover(): Promise<ResourceDescriptor[]> {
    return [
      {
        sourceKey: 'CNCCFP',
        datasetExternalId: 'cnccfp-legislatives-2022',
        datasetTitle: 'Comptes de campagne — Élections législatives 2022',
        resourceExternalId: 'publications-2022-lg.csv',
        url: CNCCFP_LEGISLATIVES_2022_URL,
        format: 'csv',
      },
    ]
  }

  fetch(descriptor: ResourceDescriptor): Promise<FetchedFile> {
    return this.client.fetch(descriptor)
  }

  stage(file: FetchedFile, run: ImportRunRef): Promise<StageReport> {
    return stageCnccfp(this.prisma, file.localPath, run)
  }

  normalize(run: ImportRunRef): Promise<NormalizeReport> {
    return normalizeCnccfp(this.prisma, run)
  }
}
