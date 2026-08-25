import { describe, expect, it } from 'vitest'
import { buildDisplayName, normalizeNameForMatching } from '../src/person-name.js'

describe('normalizeNameForMatching', () => {
  it('rend identiques les variantes de casse et d’ordre', () => {
    const a = normalizeNameForMatching('Emmanuel', 'Macron')
    const b = normalizeNameForMatching('EMMANUEL', 'MACRON')
    expect(a).toBe(b)
  })

  it('supprime les accents', () => {
    expect(normalizeNameForMatching('Stéphane', 'Peu')).toBe(
      normalizeNameForMatching('Stephane', 'Peu'),
    )
  })

  it('normalise les particules et les apostrophes', () => {
    expect(normalizeNameForMatching('Charles', "d'Ornano")).toBe(
      normalizeNameForMatching('Charles', 'D Ornano'),
    )
  })

  it('traite le trait d’union comme un espace', () => {
    expect(normalizeNameForMatching('Jean-Luc', 'Mélenchon')).toBe(
      normalizeNameForMatching('Jean Luc', 'Melenchon'),
    )
  })

  it('produit une forme prénom puis nom', () => {
    expect(normalizeNameForMatching('Michel', 'Barnier')).toBe('michel|barnier')
  })

  it('ne confond pas deux personnes différentes', () => {
    expect(normalizeNameForMatching('Jean', 'Martin')).not.toBe(
      normalizeNameForMatching('Martin', 'Jean'),
    )
  })
})

describe('buildDisplayName', () => {
  it('assemble civilité, prénom et nom', () => {
    expect(buildDisplayName({ civ: 'M.', prenom: 'Michel', nom: 'Barnier' })).toBe(
      'Michel Barnier',
    )
  })

  it('tolère une civilité absente', () => {
    expect(buildDisplayName({ civ: null, prenom: 'Michel', nom: 'Barnier' })).toBe(
      'Michel Barnier',
    )
  })
})
