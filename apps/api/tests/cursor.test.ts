import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor, resolveOffset } from '../src/graphql/common/cursor.js'

describe('encodeCursor / decodeCursor', () => {
  it('fait l’aller-retour', () => {
    expect(decodeCursor(encodeCursor(0))).toBe(0)
    expect(decodeCursor(encodeCursor(42))).toBe(42)
  })

  it('rejette un curseur qui n’est pas du base64 décodable en offset', () => {
    expect(() => decodeCursor('n-importe-quoi')).toThrow()
  })

  it('rejette un curseur négatif', () => {
    expect(() => decodeCursor(encodeCursor(-1))).toThrow()
  })
})

describe('resolveOffset', () => {
  it('part de zéro quand aucun curseur n’est fourni', () => {
    expect(resolveOffset(undefined, undefined, 25)).toBe(0)
  })

  it('avance à la position du curseur `after`', () => {
    expect(resolveOffset(encodeCursor(50), undefined, 25)).toBe(50)
  })

  it('recule d’une page complète depuis `before`', () => {
    expect(resolveOffset(undefined, encodeCursor(50), 25)).toBe(25)
  })

  it('borne le recul à zéro plutôt que de produire un offset négatif', () => {
    expect(resolveOffset(undefined, encodeCursor(10), 25)).toBe(0)
  })

  it('refuse `after` et `before` ensemble : la page demandée serait ambiguë', () => {
    expect(() => resolveOffset(encodeCursor(10), encodeCursor(50), 25)).toThrow(
      /ensemble/,
    )
  })
})
