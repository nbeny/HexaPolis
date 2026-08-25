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
import { normalizeAn } from './normalize.js'
import { stageActeurs } from './stage-acteurs.js'
import { stageOrganes } from './stage-organes.js'

const AMO10_URL =
  'https://data.assemblee-nationale.fr/static/openData/repository/17/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip'

const AMO30_URL =
  'https://data.assemblee-nationale.fr/static/openData/repository/17/amo/tous_acteurs_mandats_organes_xi_legislature/AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip'

export class AnActeursAdapter implements SourceAdapter {
  readonly source = 'AN' as const

  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: AssembleeNationaleClient,
  ) {}

  async discover(): Promise<ResourceDescriptor[]> {
    return [
      {
        sourceKey: 'AN',
        datasetExternalId: 'amo10-17',
        datasetTitle: 'Députés actifs, mandats actifs et organes — 17e législature',
        resourceExternalId: 'AMO10_deputes_actifs_mandats_actifs_organes.json.zip',
        url: AMO10_URL,
        format: 'zip',
      },
      // Sans les députés historiques, les scrutins des législatures antérieures
      // à la 17e n'auraient personne à qui rattacher leurs positions de vote.
      {
        sourceKey: 'AN',
        datasetExternalId: 'amo30-historique',
        datasetTitle: 'Tous les acteurs, mandats et organes depuis la XIe législature',
        resourceExternalId: 'AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip',
        url: AMO30_URL,
        format: 'zip',
      },
    ]
  }

  fetch(descriptor: ResourceDescriptor): Promise<FetchedFile> {
    return this.client.fetch(descriptor)
  }

  async stage(file: FetchedFile, run: ImportRunRef): Promise<StageReport> {
    const organes = await stageOrganes(this.prisma, file.localPath, run)
    const acteurs = await stageActeurs(this.prisma, file.localPath, run)
    return {
      staged: organes.staged + acteurs.staged,
      rejected: organes.rejected + acteurs.rejected,
    }
  }

  normalize(run: ImportRunRef): Promise<NormalizeReport> {
    return normalizeAn(this.prisma, run)
  }
}
