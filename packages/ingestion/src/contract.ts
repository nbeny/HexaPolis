export type SourceKey = 'AN' | 'DATA_GOUV' | 'CNCCFP' | 'RNE'

export interface ResourceDescriptor {
  sourceKey: SourceKey
  datasetExternalId: string
  datasetTitle: string
  resourceExternalId: string
  url: string
  format: string
}

export interface FetchedFile {
  descriptor: ResourceDescriptor
  localPath: string
  checksum: string
  bytes: number
}

export interface ImportRunRef {
  id: string
  resourceId: string
  checksum: string
}

export interface StageReport {
  staged: number
  rejected: number
}

export interface NormalizeReport {
  created: number
  updated: number
  unchanged: number
  rejected: number
  pending: number
}

export interface SourceAdapter {
  readonly source: SourceKey
  discover(): Promise<ResourceDescriptor[]>
  fetch(descriptor: ResourceDescriptor): Promise<FetchedFile>
  stage(file: FetchedFile, run: ImportRunRef): Promise<StageReport>
  normalize(run: ImportRunRef): Promise<NormalizeReport>
}
