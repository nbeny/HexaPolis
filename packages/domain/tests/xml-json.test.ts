import { describe, expect, it } from 'vitest'
import { asArray, nilToNull, textOf } from '../src/xml-json.js'

describe('asArray', () => {
  it('enveloppe un objet unique dans un tableau', () => {
    expect(asArray({ uid: 'PM1' })).toEqual([{ uid: 'PM1' }])
  })

  it('laisse un tableau inchangé', () => {
    expect(asArray([{ uid: 'PM1' }, { uid: 'PM2' }])).toHaveLength(2)
  })

  it('renvoie un tableau vide pour null et undefined', () => {
    expect(asArray(null)).toEqual([])
    expect(asArray(undefined)).toEqual([])
  })
})

describe('nilToNull', () => {
  it('convertit une valeur xsi:nil en null', () => {
    expect(nilToNull({ '@xsi:nil': 'true' })).toBeNull()
  })

  it("laisse un xsi:nil à 'false' inchangé (présent, non nul)", () => {
    expect(nilToNull({ '@xsi:nil': 'false' })).toEqual({ '@xsi:nil': 'false' })
  })

  it('laisse une chaîne inchangée', () => {
    expect(nilToNull('2025-09-28')).toBe('2025-09-28')
  })

  it('laisse un objet ordinaire inchangé', () => {
    expect(nilToNull({ codeQualite: 'membre' })).toEqual({ codeQualite: 'membre' })
  })
})

describe('textOf', () => {
  it("extrait le contenu textuel d'un noeud typé", () => {
    expect(textOf({ '@xsi:type': 'IdActeur_type', '#text': 'PA368' })).toBe('PA368')
  })

  it('renvoie une chaîne telle quelle', () => {
    expect(textOf('PA368')).toBe('PA368')
  })

  it('renvoie null pour une valeur absente', () => {
    expect(textOf(null)).toBeNull()
  })

  it('coerce un #text numérique en chaîne', () => {
    expect(textOf({ '#text': 42 })).toBe('42')
  })

  it("renvoie null quand la clé #text est absente de l'objet", () => {
    expect(textOf({})).toBeNull()
  })
})
