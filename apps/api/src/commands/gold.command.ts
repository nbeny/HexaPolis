import { Injectable } from '@nestjs/common'
import { Command, CommandRunner } from 'nest-commander'
import { getPrisma } from '@poligraph/db'
import { refreshGold } from '@poligraph/ingestion'

const ACTIONS = ['refresh'] as const

@Injectable()
@Command({
  name: 'gold',
  arguments: '<action>',
  description:
    'Rafraîchit les vues matérialisées gold (gold.deputy_card, gold.deputy_vote) depuis silver',
})
export class GoldCommand extends CommandRunner {
  async run(passedParams: string[]): Promise<void> {
    const [action] = passedParams

    if (!action || !(ACTIONS as readonly string[]).includes(action)) {
      console.error(`Action inconnue : ${action ?? '(aucune)'}`)
      console.error(`Actions disponibles : ${ACTIONS.join(', ')}`)
      process.exitCode = 1
      return
    }

    const prisma = getPrisma()
    try {
      const results = await refreshGold(prisma)
      console.log('--- Rafraîchissement des vues gold ---')
      const width = Math.max(...results.map((r) => r.view.length))
      for (const result of results) {
        console.log(
          `${result.view.padEnd(width)} : ${result.rows} lignes en ${result.durationMs} ms`,
        )
      }
    } finally {
      await prisma.$disconnect()
    }
  }
}
