import { describe, expect, it } from 'vitest'
import { couleurDeGroupe, groupeMajoritaire } from '@/lib/carte-couleurs'

describe('couleurDeGroupe', () => {
  it('reprend la couleur publiée par l’Assemblée quand elle existe', () => {
    expect(couleurDeGroupe('#123456')).toBe('#123456')
  })

  it('rend une teinte neutre plutôt que d’en inventer une quand elle manque', () => {
    expect(couleurDeGroupe(null)).toBe('#d6d3d1')
    expect(couleurDeGroupe(undefined)).toBe('#d6d3d1')
  })
})

describe('groupeMajoritaire', () => {
  it('rend le groupe le plus représenté du département', () => {
    expect(groupeMajoritaire([{ id: 'a' }, { id: 'a' }, { id: 'b' }])).toBe('a')
  })

  it('rend null sur une égalité plutôt que de trancher arbitrairement', () => {
    expect(groupeMajoritaire([{ id: 'a' }, { id: 'b' }])).toBeNull()
  })

  it('rend null quand le département n’a aucun député rattaché', () => {
    expect(groupeMajoritaire([])).toBeNull()
  })

  it('rend null sur une égalité à trois groupes, pas seulement à deux', () => {
    expect(
      groupeMajoritaire([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'a' }, { id: 'b' }, { id: 'c' }]),
    ).toBeNull()
  })

  it('départage correctement quand le meneur apparaît après un groupe minoritaire', () => {
    expect(groupeMajoritaire([{ id: 'b' }, { id: 'a' }, { id: 'a' }])).toBe('a')
  })
})
