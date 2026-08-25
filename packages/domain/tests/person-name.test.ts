import { describe, expect, it } from 'vitest'
import { buildDisplayName, normalizeNameForMatching } from '../src/person-name.js'

const NBSP = '\u00a0'
const NARROW_NBSP = '\u202f'

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

  // Alexandra Martin (Gironde) et Alexandra Martin (Alpes-Maritimes) sont deux
  // députées réelles et distinctes de la XVIIe législature. L'Assemblée nationale
  // désambiguïse en insérant le département dans le champ `nom`, mais ce
  // qualificatif éditorial ne doit jamais faire partie de la clé de rapprochement :
  // les deux doivent produire la même clé pour forcer une arbitrage humain (statut
  // POSSIBLE), jamais un auto-merge silencieux ni deux clés orphelines.
  it('ignore un qualificatif entre parenthèses en fin de nom (homonymes réels)', () => {
    const gironde = normalizeNameForMatching('Alexandra', 'Martin (Gironde)')
    const alpesMaritimes = normalizeNameForMatching('Alexandra', 'Martin (Alpes-Maritimes)')
    expect(gironde).toBe('alexandra|martin')
    expect(alpesMaritimes).toBe('alexandra|martin')
    expect(gironde).toBe(alpesMaritimes)
  })

  it('traite le slash comme un séparateur (nom réel : Éméline K/Bidi)', () => {
    expect(normalizeNameForMatching('Éméline', 'K/Bidi')).toBe('emeline|k bidi')
  })

  it('traite un prénom composé avec espace comme équivalent à un trait d’union', () => {
    expect(normalizeNameForMatching('Jean Luc', 'Mélenchon')).toBe(
      normalizeNameForMatching('Jean-Luc', 'Melenchon'),
    )
  })

  it('translittère les lettres latines non décomposées par NFD (ex. œ)', () => {
    expect(normalizeNameForMatching('Ann', 'Sœur')).toBe('ann|soeur')
  })

  it('convertit les espaces unicode (insécable, insécable fine) en espace normal', () => {
    const withNbsp = normalizeNameForMatching(`Jean${NBSP}Luc`, 'Melenchon')
    const withNarrowNbsp = normalizeNameForMatching(`Jean${NARROW_NBSP}Luc`, 'Melenchon')
    const withPlainSpace = normalizeNameForMatching('Jean Luc', 'Melenchon')
    expect(withNbsp).toBe(withPlainSpace)
    expect(withNarrowNbsp).toBe(withPlainSpace)
    expect(withPlainSpace).toBe('jean luc|melenchon')
  })

  it('lève une erreur si le prénom et le nom sont tous deux vides après normalisation', () => {
    expect(() => normalizeNameForMatching('', '')).toThrow()
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
