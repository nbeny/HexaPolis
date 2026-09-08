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
    expect(resolveOffset({ after: undefined, before: undefined, pageSize: 25 })).toBe(0)
  })

  it('part de zéro quand les deux curseurs sont `null` (comme `undefined`)', () => {
    expect(resolveOffset({ after: null, before: null, pageSize: 25 })).toBe(0)
  })

  it('avance à la position du curseur `after`', () => {
    expect(resolveOffset({ after: encodeCursor(50), before: undefined, pageSize: 25 })).toBe(50)
  })

  it('recule d’une page complète depuis `before`', () => {
    expect(resolveOffset({ after: undefined, before: encodeCursor(50), pageSize: 25 })).toBe(25)
  })

  it('borne le recul à zéro plutôt que de produire un offset négatif', () => {
    expect(resolveOffset({ after: undefined, before: encodeCursor(10), pageSize: 25 })).toBe(0)
  })

  it('recule exactement à zéro quand le curseur vaut une page pleine', () => {
    expect(resolveOffset({ after: undefined, before: encodeCursor(25), pageSize: 25 })).toBe(0)
  })

  it('refuse `after` et `before` ensemble : la page demandée serait ambiguë', () => {
    expect(() =>
      resolveOffset({ after: encodeCursor(10), before: encodeCursor(50), pageSize: 25 }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/ensemble/),
        extensions: expect.objectContaining({ code: 'BAD_USER_INPUT' }),
      }),
    )
  })

  it('un `before` illisible lève une erreur plutôt que d’être traité comme une absence', () => {
    expect(() =>
      resolveOffset({ after: undefined, before: 'n-importe-quoi', pageSize: 25 }),
    ).toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: 'BAD_USER_INPUT' }) }),
    )
  })
})
