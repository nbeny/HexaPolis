import { describe, expect, it } from 'vitest'
import { anIdFromSlug, buildDeputySlug } from '../src/graphql/common/slug.js'

describe('buildDeputySlug', () => {
  it('bâtit le slug sur l’identifiant AN en minuscules, suivi du nom', () => {
    expect(buildDeputySlug('PA330008', 'Xavier Breton')).toBe('pa330008-xavier-breton')
  })

  it('retire les diacritiques et normalise la ponctuation', () => {
    expect(buildDeputySlug('PA123456', "Béatrice d'Arcy-Dupont")).toBe(
      'pa123456-beatrice-d-arcy-dupont',
    )
  })
})

describe('anIdFromSlug', () => {
  it('extrait le préfixe AN en majuscules', () => {
    expect(anIdFromSlug('pa330008-xavier-breton')).toBe('PA330008')
  })

  it('reste indifférent au reste du slug — deux homonymes ne se confondent jamais sur ce préfixe', () => {
    // Cas réel : deux Jean Besson dans la base. Le préfixe AN, pas le nom,
    // distingue les fiches.
    expect(anIdFromSlug('pa000001-jean-besson')).toBe('PA000001')
    expect(anIdFromSlug('pa000002-jean-besson')).toBe('PA000002')
  })

  it('retourne une chaîne vide sur un slug vide', () => {
    expect(anIdFromSlug('')).toBe('')
  })
})
