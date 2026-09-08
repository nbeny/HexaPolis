import { describe, expect, it } from 'vitest'
import { buildConnection } from '../src/graphql/common/connection.js'
import { decodeCursor } from '../src/graphql/common/cursor.js'

/** `toNode` volontairement visible dans les assertions : prouve que la
 * fabrique applique bien la transformation plutôt que de renvoyer la ligne
 * brute. */
const toNode = (row: string) => row.toUpperCase()

describe('buildConnection', () => {
  it('première page : pas de précédente, une suivante', () => {
    const connection = buildConnection({
      rows: ['a', 'b'],
      offset: 0,
      totalCount: 5,
      toNode,
    })

    expect(connection.totalCount).toBe(5)
    expect(connection.edges.map((e) => e.node)).toEqual(['A', 'B'])
    expect(decodeCursor(connection.pageInfo.startCursor!)).toBe(0)
    expect(decodeCursor(connection.pageInfo.endCursor!)).toBe(2)
    expect(connection.pageInfo.hasPreviousPage).toBe(false)
    expect(connection.pageInfo.hasNextPage).toBe(true)
  })

  it('page du milieu : précédente ET suivante', () => {
    const connection = buildConnection({
      rows: ['c', 'd'],
      offset: 2,
      totalCount: 5,
      toNode,
    })

    expect(decodeCursor(connection.pageInfo.startCursor!)).toBe(2)
    expect(decodeCursor(connection.pageInfo.endCursor!)).toBe(4)
    expect(connection.pageInfo.hasPreviousPage).toBe(true)
    expect(connection.pageInfo.hasNextPage).toBe(true)
  })

  // `offset === totalCount` : un curseur `after` qui pointait juste après la
  // dernière ligne au moment où il a été émis, et que la page a depuis
  // rétréci sous lui (ou qui redemande volontairement la position finale).
  it('page vide au-delà de la fin : précédente, pas de suivante, pas de endCursor', () => {
    const connection = buildConnection({
      rows: [] as string[],
      offset: 5,
      totalCount: 5,
      toNode,
    })

    expect(connection.edges).toHaveLength(0)
    expect(decodeCursor(connection.pageInfo.startCursor!)).toBe(5)
    expect(connection.pageInfo.endCursor).toBeUndefined()
    expect(connection.pageInfo.hasPreviousPage).toBe(true)
    expect(connection.pageInfo.hasNextPage).toBe(false)
  })

  it('connexion totalement vide : ni précédente ni suivante, mais un startCursor', () => {
    const connection = buildConnection({
      rows: [] as string[],
      offset: 0,
      totalCount: 0,
      toNode,
    })

    expect(connection.edges).toHaveLength(0)
    expect(connection.totalCount).toBe(0)
    expect(decodeCursor(connection.pageInfo.startCursor!)).toBe(0)
    expect(connection.pageInfo.endCursor).toBeUndefined()
    expect(connection.pageInfo.hasPreviousPage).toBe(false)
    expect(connection.pageInfo.hasNextPage).toBe(false)
  })
})
