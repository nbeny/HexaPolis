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
import { normalizeRne } from './normalize-rne.js'
import { stageRne } from './stage-rne.js'

const RNE_DEPUTES_URL =
  'https://static.data.gouv.fr/resources/repertoire-national-des-elus-1/20260811-155035/elus-depute-dep.csv'

export class RneAdapter implements SourceAdapter {
  readonly source = 'RNE' as const

  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: SourceFileClient,
  ) {}

  async discover(): Promise<ResourceDescriptor[]> {
    return [
      {
        sourceKey: 'RNE',
        datasetExternalId: 'rne-deputes',
        datasetTitle: 'Répertoire national des élus — Députés',
        resourceExternalId: 'elus-depute-dep.csv',
        url: RNE_DEPUTES_URL,
        format: 'csv',
      },
    ]
  }

  fetch(descriptor: ResourceDescriptor): Promise<FetchedFile> {
    return this.client.fetch(descriptor)
  }

  stage(file: FetchedFile, run: ImportRunRef): Promise<StageReport> {
    return stageRne(this.prisma, file.localPath, run)
  }

  normalize(run: ImportRunRef): Promise<NormalizeReport> {
    return normalizeRne(this.prisma, run)
  }
}
