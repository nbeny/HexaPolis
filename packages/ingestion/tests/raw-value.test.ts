import { describe, expect, it } from 'vitest'
import { rawString } from '../src/adapters/an/raw-value.js'

describe('rawString', () => {
  it('laisse passer une chaîne telle quelle', () => {
    expect(rawString('RN')).toBe('RN')
  })

  it('convertit un nombre en sa forme chaîne', () => {
    expect(rawString(4)).toBe('4')
  })

  it('convertit un booléen en sa forme chaîne', () => {
    expect(rawString(true)).toBe('true')
    expect(rawString(false)).toBe('false')
  })

  it('convertit la forme xsi:nil en null', () => {
    expect(rawString({ '@xsi:nil': 'true' })).toBeNull()
  })

  it('convertit null et undefined en null', () => {
    expect(rawString(null)).toBeNull()
    expect(rawString(undefined)).toBeNull()
  })

  it('convertit un objet ou un tableau en null', () => {
    expect(rawString({ code: '83', libelle: 'Var' })).toBeNull()
    expect(rawString(['a', 'b'])).toBeNull()
  })
})
