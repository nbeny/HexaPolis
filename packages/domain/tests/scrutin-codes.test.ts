import { describe, expect, it } from 'vitest'
import { VOTE_CATEGORY_KEYS, positionFromCategoryKey } from '../src/scrutin-codes.js'

describe('positionFromCategoryKey', () => {
  it('accepte le pluriel employé par les 15e et 17e législatures', () => {
    expect(positionFromCategoryKey('pours')).toBe('POUR')
    expect(positionFromCategoryKey('contres')).toBe('CONTRE')
    expect(positionFromCategoryKey('abstentions')).toBe('ABSTENTION')
    expect(positionFromCategoryKey('nonVotants')).toBe('NON_VOTANT')
  })

  it('accepte le singulier employé par la 14e et une partie de la 16e', () => {
    expect(positionFromCategoryKey('pour')).toBe('POUR')
    expect(positionFromCategoryKey('contre')).toBe('CONTRE')
    expect(positionFromCategoryKey('abstention')).toBe('ABSTENTION')
    expect(positionFromCategoryKey('nonVotant')).toBe('NON_VOTANT')
  })

  it('renvoie null pour une clé qui n’est pas une catégorie de vote', () => {
    // `decompteNominatif` porte aussi des clés qui ne sont pas des catégories.
    expect(positionFromCategoryKey('positionMajoritaire')).toBeNull()
    expect(positionFromCategoryKey('')).toBeNull()
  })

  it('expose les huit clés connues, sans doublon', () => {
    expect(new Set(VOTE_CATEGORY_KEYS).size).toBe(8)
    expect(VOTE_CATEGORY_KEYS.every((k) => positionFromCategoryKey(k) !== null)).toBe(true)
  })

  it('associe exactement deux clés à chaque position', () => {
    const parPosition = new Map<string, number>()
    for (const key of VOTE_CATEGORY_KEYS) {
      const position = positionFromCategoryKey(key)
      if (!position) throw new Error(`clé non reconnue : ${key}`)
      parPosition.set(position, (parPosition.get(position) ?? 0) + 1)
    }
    expect([...parPosition.values()]).toEqual([2, 2, 2, 2])
  })
})
