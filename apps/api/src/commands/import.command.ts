import { Injectable } from '@nestjs/common'
import { Command, CommandRunner, Option } from 'nest-commander'
import { getPrisma, type PrismaClient } from '@poligraph/db'
import {
  AnActeursAdapter,
  AssembleeNationaleClient,
  openImportRun,
  closeImportRun,
  failImportRun,
  findLastSuccessfulRun,
  countRejectionsByTable,
  type ImportRunRef,
  type ResourceDescriptor,
} from '@poligraph/ingestion'

interface ImportCommandOptions {
  renormalize?: boolean
}

const TARGETS = ['an:acteurs'] as const

interface Report {
  staged: number
  created: number
  updated: number
  unchanged: number
  rejected: number
  pending: number
}

@Injectable()
@Command({
  name: 'import',
  arguments: '<target>',
  description: "Importe une ressource source vers le bronze puis normalise vers le silver",
})
export class ImportCommand extends CommandRunner {
  async run(passedParams: string[], options: ImportCommandOptions): Promise<void> {
    const [target] = passedParams

    if (target !== 'an:acteurs') {
      console.error(`Cible inconnue : ${target ?? '(aucune)'}`)
      console.error(`Cibles disponibles : ${TARGETS.join(', ')}`)
      process.exitCode = 1
      return
    }

    const prisma = getPrisma()
    const client = new AssembleeNationaleClient('.data/an')
    const adapter = new AnActeursAdapter(prisma, client)

    try {
      if (options.renormalize) {
        await this.renormalize(adapter, prisma)
      } else {
        await this.importNormally(adapter, prisma)
      }
    } finally {
      await prisma.$disconnect()
    }
  }

  @Option({
    flags: '--renormalize',
    description:
      "Rejoue la normalisation depuis le bronze déjà stagé du dernier import réussi, sans accéder au réseau",
  })
  parseRenormalize(): boolean {
    return true
  }

  private async importNormally(adapter: AnActeursAdapter, prisma: PrismaClient): Promise<void> {
    const [descriptor] = await adapter.discover()
    if (!descriptor) throw new Error('aucune ressource découverte')

    const file = await adapter.fetch(descriptor)
    const run = await openImportRun(prisma, descriptor, file.checksum)

    if (!run) {
      console.log(
        `Ressource inchangée (checksum ${file.checksum.slice(0, 12)}…) : rien à importer.`,
      )
      console.log('Pour rejouer la normalisation depuis le bronze déjà stagé, utilisez --renormalize.')
      return
    }

    try {
      const stageReport = await adapter.stage(file, run)
      const normalizeReport = await adapter.normalize(run)
      const rejected = stageReport.rejected + normalizeReport.rejected

      await closeImportRun(prisma, run, { ...normalizeReport, rejected, staged: stageReport.staged })

      await this.printReport(prisma, descriptor, run, {
        staged: stageReport.staged,
        created: normalizeReport.created,
        updated: normalizeReport.updated,
        unchanged: normalizeReport.unchanged,
        rejected,
        pending: normalizeReport.pending,
      })
    } catch (error) {
      await failImportRun(prisma, run)
      throw error
    }
  }

  private async renormalize(adapter: AnActeursAdapter, prisma: PrismaClient): Promise<void> {
    const [descriptor] = await adapter.discover()
    if (!descriptor) throw new Error('aucune ressource découverte')

    const run = await findLastSuccessfulRun(prisma, descriptor)
    if (!run) {
      console.error(
        "Aucun import réussi à rejouer pour an:acteurs. Lancez d'abord un import normal (sans --renormalize) avant de pouvoir rejouer la normalisation.",
      )
      process.exitCode = 1
      return
    }

    // Rien n'est re-stagé : le compte "stagé" affiché reste celui du dernier
    // import réussi, seul chiffre honnête puisqu'aucune ligne bronze n'a
    // bougé pendant ce rejouage (défaut C du plan).
    const previousRun = await prisma.importRun.findUniqueOrThrow({ where: { id: run.id } })
    const normalizeReport = await adapter.normalize(run)

    await closeImportRun(prisma, run, { ...normalizeReport, staged: previousRun.staged })

    console.log('Rejouage de la normalisation depuis le bronze déjà stagé (aucun accès réseau).')
    await this.printReport(prisma, descriptor, run, {
      staged: previousRun.staged,
      created: normalizeReport.created,
      updated: normalizeReport.updated,
      unchanged: normalizeReport.unchanged,
      rejected: normalizeReport.rejected,
      pending: normalizeReport.pending,
    })
  }

  private async printReport(
    prisma: PrismaClient,
    descriptor: ResourceDescriptor,
    run: ImportRunRef,
    report: Report,
  ): Promise<void> {
    const lines: [string, string][] = [
      ['Source', descriptor.sourceKey],
      ['Ressource', descriptor.resourceExternalId],
      ['Checksum', `${run.checksum.slice(0, 12)}…`],
      ['Stagé', String(report.staged)],
      ['Créés', String(report.created)],
      ['Mis à jour', String(report.updated)],
      ['Inchangés', String(report.unchanged)],
      ['Rejetés', String(report.rejected)],
      ['En attente', String(report.pending)],
    ]
    const width = Math.max(...lines.map(([label]) => label.length))
    for (const [label, value] of lines) {
      console.log(`${label.padEnd(width)} : ${value}`)
    }

    const rejectionsByTable = await countRejectionsByTable(prisma, run)
    const tables = Object.keys(rejectionsByTable)
    if (tables.length > 0) {
      console.log('Rejets par table :')
      const tableWidth = Math.max(...tables.map((table) => table.length))
      for (const table of tables.sort()) {
        console.log(`  ${table.padEnd(tableWidth)} : ${rejectionsByTable[table]}`)
      }
    }
  }
}
