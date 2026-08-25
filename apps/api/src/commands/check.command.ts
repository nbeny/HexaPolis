import { Injectable } from '@nestjs/common'
import { Command, CommandRunner } from 'nest-commander'
import { getPrisma } from '@poligraph/db'
import { recountBallots } from '@poligraph/ingestion'

/** Au-delà, la liste devient illisible ; le total exact reste affiché. */
const MAX_LIGNES = 50

@Injectable()
@Command({
  name: 'check',
  description:
    'Recompte les positions importées et les confronte aux décomptes officiels publiés par l’AN',
})
export class CheckCommand extends CommandRunner {
  async run(): Promise<void> {
    const prisma = getPrisma()
    try {
      const report = await recountBallots(prisma)

      console.log('--- Contrôle de cohérence des scrutins ---')
      console.log(`scrutins vérifiés : ${report.checked}`)
      console.log(
        `scrutins écartés  : ${report.skipped}   (détail nominatif non publié par la source)`,
      )
      console.log(`écarts détectés   : ${report.mismatches.length}`)

      if (report.mismatches.length === 0) {
        console.log(
          '\nAucun écart : chaque scrutin vérifié recompte exactement ses décomptes officiels.',
        )
        return
      }

      console.log('')
      for (const ecart of report.mismatches.slice(0, MAX_LIGNES)) {
        const details = (['POUR', 'CONTRE', 'ABSTENTION', 'NON_VOTANT'] as const)
          .filter((c) => ecart.official[c] !== ecart.counted[c])
          .map((c) => `${c} officiel ${ecart.official[c]}, recompté ${ecart.counted[c]}`)
          .join(' | ')
        console.log(`${ecart.scrutinUid} (${ecart.legislature ?? '?'}e) : ${details}`)
      }

      if (report.mismatches.length > MAX_LIGNES) {
        console.log(
          `\n… ${report.mismatches.length - MAX_LIGNES} autres écarts non affichés (total : ${report.mismatches.length}).`,
        )
      }

      // Sortie non nulle : la commande est utilisable comme vérification automatique.
      process.exitCode = 1
    } finally {
      await prisma.$disconnect()
    }
  }
}
