import { describe, expect, it } from 'vitest'
import { corsOrigins } from '../src/graphql/cors.js'

describe('corsOrigins', () => {
  it("n'autorise aucune origine quand la variable est absente", () => {
    expect(corsOrigins({})).toEqual([])
  })

  it('lit une liste séparée par des virgules et retire les espaces', () => {
    expect(corsOrigins({ CORS_ALLOWED_ORIGINS: 'http://a.test, http://b.test' })).toEqual([
      'http://a.test',
      'http://b.test',
    ])
  })

  it('ignore les entrées vides plutôt que d’autoriser la chaîne vide', () => {
    expect(corsOrigins({ CORS_ALLOWED_ORIGINS: 'http://a.test,,  ' })).toEqual([
      'http://a.test',
    ])
  })

  it("n'accepte jamais le joker, même écrit explicitement", () => {
    expect(() => corsOrigins({ CORS_ALLOWED_ORIGINS: '*' })).toThrow(/joker/)
  })
})
