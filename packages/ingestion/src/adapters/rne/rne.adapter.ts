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
import { normalizeRne } from './normalize-rne.js'
import { stageRne } from './stage-rne.js'

const RNE_DEPUTES_URL =
  'https://static.data.gouv.fr/resources/repertoire-national-des-elus-1/20260811-155035/elus-depute-dep.csv'

/**
 * `AssembleeNationaleClient` télécharge n'importe quelle ressource HTTP en
 * mettant le résultat en cache par empreinte ; son nom vient de son premier
 * usage mais n'a rien de spécifique à l'AN. La réutiliser ici plutôt que
 * d'écrire un second client évite de dupliquer la logique de cache — mais le
 * nom devient trompeur au fil des sources qui l'emploient.
 */
export class RneAdapter implements SourceAdapter {
  readonly source = 'RNE' as const

  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: AssembleeNationaleClient,
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
