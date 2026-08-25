import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor } from '../src/graphql/common/cursor.js'

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
