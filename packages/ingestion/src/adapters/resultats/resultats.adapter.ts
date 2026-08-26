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
import { normalizeResultats } from './normalize-resultats.js'
import { stageResultats } from './stage-resultats.js'

/**
 * Deux ressources data.gouv.fr distinctes — les fichiers ne portent même pas
 * le même nom (`circonscriptions-legislatives` au 1er tour,
 * `circonscription` au 2nd) — mesuré en téléchargeant les fichiers publiés,
 * voir plan p5.
 */
const RESULTATS_T1_URL =
  'https://static.data.gouv.fr/resources/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour/20240710-171413/resultats-definitifs-par-circonscriptions-legislatives.csv'
const RESULTATS_T2_URL =
  'https://static.data.gouv.fr/resources/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-2nd-tour/20240710-170728/resultats-definitifs-par-circonscription.csv'

/**
 * Importe les résultats officiels des élections législatives 2024, publiés
 * par le ministère de l'Intérieur sur data.gouv.fr. Deux ressources — une
 * par tour — chacune avec son propre import et son propre checksum
 * (décision de conception #4 du plan p5) : `normalizeResultats` retrouve le
 * tour d'un run depuis le `datasetExternalId` de sa ressource, jamais codé
 * en dur dans l'adaptateur.
 */
export class ResultatsAdapter implements SourceAdapter {
  readonly source = 'DATA_GOUV' as const

  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: SourceFileClient,
  ) {}

  async discover(): Promise<ResourceDescriptor[]> {
    return [
      {
        sourceKey: 'DATA_GOUV',
        datasetExternalId: 'legislatives-2024-t1',
        datasetTitle: 'Résultats définitifs — Législatives 2024, 1er tour',
        resourceExternalId: 'resultats-definitifs-par-circonscriptions-legislatives.csv',
        url: RESULTATS_T1_URL,
        format: 'csv',
      },
      {
        sourceKey: 'DATA_GOUV',
        datasetExternalId: 'legislatives-2024-t2',
        datasetTitle: 'Résultats définitifs — Législatives 2024, 2nd tour',
        resourceExternalId: 'resultats-definitifs-par-circonscription.csv',
        url: RESULTATS_T2_URL,
        format: 'csv',
      },
    ]
  }

  fetch(descriptor: ResourceDescriptor): Promise<FetchedFile> {
    return this.client.fetch(descriptor)
  }

  stage(file: FetchedFile, run: ImportRunRef): Promise<StageReport> {
    return stageResultats(this.prisma, file.localPath, run)
  }

  normalize(run: ImportRunRef): Promise<NormalizeReport> {
    return normalizeResultats(this.prisma, run)
  }
}
