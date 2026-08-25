import type { PrismaClient } from '@poligraph/db'
import type { ImportRunRef, NormalizeReport, ResourceDescriptor } from '../contract.js'

const SOURCE_LABELS: Record<string, string> = {
  AN: 'Assemblée nationale',
  DATA_GOUV: 'data.gouv.fr',
  CNCCFP: 'CNCCFP',
  RNE: 'Répertoire national des élus',
}

export async function openImportRun(
  prisma: PrismaClient,
  descriptor: ResourceDescriptor,
  checksum: string,
): Promise<ImportRunRef | null> {
  const source = await prisma.source.upsert({
    where: { id: descriptor.sourceKey },
    update: {},
    create: {
      id: descriptor.sourceKey,
      label: SOURCE_LABELS[descriptor.sourceKey] ?? descriptor.sourceKey,
    },
  })

  const dataset = await prisma.dataset.upsert({
    where: {
      sourceId_externalId: { sourceId: source.id, externalId: descriptor.datasetExternalId },
    },
    update: { title: descriptor.datasetTitle },
    create: {
      sourceId: source.id,
      externalId: descriptor.datasetExternalId,
      title: descriptor.datasetTitle,
    },
  })

  const resource = await prisma.datasetResource.upsert({
    where: {
      datasetId_externalId: {
        datasetId: dataset.id,
        externalId: descriptor.resourceExternalId,
      },
    },
    update: { url: descriptor.url, format: descriptor.format },
    create: {
      datasetId: dataset.id,
      externalId: descriptor.resourceExternalId,
      url: descriptor.url,
      format: descriptor.format,
    },
  })

  const already = await prisma.importRun.findFirst({
    where: { resourceId: resource.id, checksum, status: 'SUCCEEDED' },
  })
  if (already) return null

  const run = await prisma.importRun.create({
    data: { resourceId: resource.id, checksum },
  })
  return { id: run.id, resourceId: resource.id, checksum }
}

export async function closeImportRun(
  prisma: PrismaClient,
  run: ImportRunRef,
  report: NormalizeReport & { staged?: number },
): Promise<void> {
  await prisma.importRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      status: 'SUCCEEDED',
      staged: report.staged ?? 0,
      created: report.created,
      updated: report.updated,
      unchanged: report.unchanged,
      rejected: report.rejected,
      pending: report.pending,
    },
  })
}

export async function failImportRun(prisma: PrismaClient, run: ImportRunRef): Promise<void> {
  await prisma.importRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), status: 'FAILED' },
  })
}

/**
 * Retrouve le dernier import réussi pour une ressource, sans en créer un
 * nouveau ni toucher à la base (contrairement à `openImportRun`). Sert à
 * rejouer la normalisation depuis le bronze déjà stagé (`--renormalize`),
 * par exemple après correction d'un bug de parsing, sans retélécharger ni
 * re-staginger la ressource. Renvoie `null` si la ressource ou un run réussi
 * n'existe pas encore.
 */
export async function findLastSuccessfulRun(
  prisma: PrismaClient,
  descriptor: ResourceDescriptor,
): Promise<ImportRunRef | null> {
  const resource = await prisma.datasetResource.findFirst({
    where: {
      externalId: descriptor.resourceExternalId,
      dataset: {
        externalId: descriptor.datasetExternalId,
        sourceId: descriptor.sourceKey,
      },
    },
  })
  if (!resource) return null

  const run = await prisma.importRun.findFirst({
    where: { resourceId: resource.id, status: 'SUCCEEDED' },
    orderBy: { startedAt: 'desc' },
  })
  if (!run) return null

  return { id: run.id, resourceId: run.resourceId, checksum: run.checksum }
}

/**
 * Ventile les rejets d'un run par table bronze, pour un rapport qui ne
 * confond pas un acteur rejeté avec un mandat rejeté.
 */
export async function countRejectionsByTable(
  prisma: PrismaClient,
  run: ImportRunRef,
): Promise<Record<string, number>> {
  const groups = await prisma.importRejection.groupBy({
    by: ['bronzeTable'],
    where: { importRunId: run.id },
    _count: { _all: true },
  })

  const counts: Record<string, number> = {}
  for (const group of groups) {
    counts[group.bronzeTable] = group._count._all
  }
  return counts
}

export async function recordRejection(
  prisma: PrismaClient,
  run: ImportRunRef,
  rejection: { bronzeTable: string; bronzeRef?: string; code: string; message: string },
): Promise<void> {
  await prisma.importRejection.create({
    data: {
      importRunId: run.id,
      bronzeTable: rejection.bronzeTable,
      bronzeRef: rejection.bronzeRef ?? null,
      code: rejection.code,
      message: rejection.message,
    },
  })
}
