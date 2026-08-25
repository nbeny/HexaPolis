import type { PrismaClient } from '@poligraph/db'

/**
 * Vues matérialisées `gold`, dans l'ordre où elles sont rafraîchies.
 * `deputy_card` d'abord : elle est nettement plus petite (une ligne par
 * député en exercice) et sert de vérification rapide avant d'attaquer
 * `deputy_vote`, dont le volume dépend directement des 2,46 millions de
 * positions de vote en silver.
 */
const GOLD_VIEWS = ['gold.deputy_card', 'gold.deputy_vote'] as const

export interface GoldRefreshResult {
  view: (typeof GOLD_VIEWS)[number]
  rows: number
  durationMs: number
}

/**
 * Rafraîchit les vues `gold` depuis leur définition SQL (voir la migration
 * `gold_views`). Rafraîchissement PLEIN, pas `CONCURRENTLY`, malgré l'index
 * unique que porte chaque vue (`person_id` pour `deputy_card`,
 * `ballot_position_id` pour `deputy_vote`), et qui suffirait techniquement à
 * l'autoriser.
 *
 * Mesuré sur les données réelles (2,46 millions de positions, dont 1,73
 * million entrent dans `deputy_vote`) : `CONCURRENTLY` calcule un diff ligne
 * à ligne contre le contenu existant, et ce calcul domine largement le coût
 * du rafraîchissement lui-même — 14,7 s + 110,5 s = 125,1 s au total, contre
 * 10,1 s + 34,9 s = 45,0 s en rafraîchissement plein. `CONCURRENTLY` a
 * exactement l'intérêt inverse de celui recherché ici : il ne bloque pas les
 * lectures pendant le rafraîchissement, au prix d'être 2 à 3 fois plus lent
 * — alors que `refreshGold` tourne en fin d'import, une opération de lot peu
 * fréquente, pas sous une charge de lecture concurrente constante. Choisir
 * `CONCURRENTLY` ici aurait fait passer `deputy_vote` seul au-dessus de la
 * minute (110 s), le seuil au-delà duquel une vue trop lente à rafraîchir
 * finit par ne plus l'être. Les index uniques restent en place : ils
 * documentent l'invariance d'unicité de chaque vue et permettraient de
 * revenir à `CONCURRENTLY` si le profil d'usage change (import déclenché
 * pendant qu'une API sert des lectures en continu).
 */
export async function refreshGold(prisma: PrismaClient): Promise<GoldRefreshResult[]> {
  const results: GoldRefreshResult[] = []

  for (const view of GOLD_VIEWS) {
    const startedAt = Date.now()
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW ${view}`)
    const durationMs = Date.now() - startedAt

    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM ${view}`,
    )
    results.push({ view, rows: Number(rows[0]?.count ?? 0n), durationMs })
  }

  return results
}
