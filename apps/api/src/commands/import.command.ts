import { Injectable } from '@nestjs/common'
import { Command, CommandRunner, Option } from 'nest-commander'
import { getPrisma, type PrismaClient } from '@poligraph/db'
import {
  AnActeursAdapter,
  AnScrutinsAdapter,
  RneAdapter,
  CnccfpAdapter,
  SourceFileClient,
  LEGISLATURES_DISPONIBLES,
  openImportRun,
  closeImportRun,
  failImportRun,
  findLastSuccessfulRun,
  countRejectionsByTable,
  type ImportRunRef,
  type ResourceDescriptor,
  type SourceAdapter,
} from '@poligraph/ingestion'

interface ImportCommandOptions {
  renormalize?: boolean
  legislature?: number[]
}

const TARGETS = ['an:acteurs', 'an:scrutins', 'rne:deputes', 'cnccfp:comptes'] as const

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

    if (!target || !(TARGETS as readonly string[]).includes(target)) {
      console.error(`Cible inconnue : ${target ?? '(aucune)'}`)
      console.error(`Cibles disponibles : ${TARGETS.join(', ')}`)
      process.exitCode = 1
      return
    }

    const prisma = getPrisma()
    const adapter = this.buildAdapter(target, prisma, options)

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

  @Option({
    flags: '--legislature <liste>',
    description:
      'Législatures à importer pour an:scrutins, séparées par des virgules (défaut : 14,15,16,17)',
  })
  parseLegislature(value: string): number[] {
    const parsed = value
      .split(',')
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((n) => !Number.isNaN(n))

    const inconnues = parsed.filter((n) => !LEGISLATURES_DISPONIBLES.includes(n as never))
    if (parsed.length === 0 || inconnues.length > 0) {
      throw new Error(
        `Législatures invalides : ${value}. Valeurs acceptées : ${LEGISLATURES_DISPONIBLES.join(', ')}.`,
      )
    }
    return parsed
  }

  private buildAdapter(
    target: string,
    prisma: PrismaClient,
    options: ImportCommandOptions,
  ): SourceAdapter {
    if (target === 'rne:deputes') {
      return new RneAdapter(prisma, new SourceFileClient('.data/rne'))
    }
    if (target === 'cnccfp:comptes') {
      return new CnccfpAdapter(prisma, new SourceFileClient('.data/cnccfp'))
    }

    const client = new SourceFileClient('.data/an')
    if (target === 'an:scrutins') {
      return new AnScrutinsAdapter(prisma, client, options.legislature ?? LEGISLATURES_DISPONIBLES)
    }
    return new AnActeursAdapter(prisma, client)
  }

  private async importNormally(adapter: SourceAdapter, prisma: PrismaClient): Promise<void> {
    const descriptors = await adapter.discover()
    if (descriptors.length === 0) throw new Error('aucune ressource découverte')

    for (const descriptor of descriptors) {
      console.log(`\n=== ${descriptor.datasetTitle} ===`)
      const file = await adapter.fetch(descriptor)
      const run = await openImportRun(prisma, descriptor, file.checksum)

      if (!run) {
        console.log(
          `Ressource inchangée (checksum ${file.checksum.slice(0, 12)}…) : rien à importer.`,
        )
        console.log(
          'Pour rejouer la normalisation depuis le bronze déjà stagé, utilisez --renormalize.',
        )
        continue
      }

      try {
        const stageReport = await adapter.stage(file, run)
        const normalizeReport = await adapter.normalize(run)
        const rejected = stageReport.rejected + normalizeReport.rejected

        await closeImportRun(prisma, run, {
          ...normalizeReport,
          rejected,
          staged: stageReport.staged,
        })

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
  }

  private async renormalize(adapter: SourceAdapter, prisma: PrismaClient): Promise<void> {
    const descriptors = await adapter.discover()
    if (descriptors.length === 0) throw new Error('aucune ressource découverte')

    let rejouee = false

    for (const descriptor of descriptors) {
      console.log(`\n=== ${descriptor.datasetTitle} ===`)
      const run = await findLastSuccessfulRun(prisma, descriptor)
      if (!run) {
        console.error(
          `Aucun import réussi à rejouer pour ${descriptor.datasetTitle}. Lancez d'abord un import normal (sans --renormalize) avant de pouvoir rejouer la normalisation.`,
        )
        continue
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
      rejouee = true
    }

    if (!rejouee) {
      process.exitCode = 1
    }
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
