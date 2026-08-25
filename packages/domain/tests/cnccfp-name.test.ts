import { describe, expect, it } from 'vitest'
import { splitCnccfpName } from '../src/cnccfp-name.js'

describe('splitCnccfpName', () => {
  it('sépare civilité, patronyme et prénom', () => {
    expect(splitCnccfpName('Mme ARMENJON Eliane')).toEqual({
      civility: 'Mme',
      lastName: 'ARMENJON',
      firstName: 'Eliane',
    })
  })

  it('garde un patronyme à particule en un seul morceau', () => {
    // Cas réels : « DE NICOLAY », « DE BOYSSON ».
    expect(splitCnccfpName('Mme DE NICOLAY Axelle')).toEqual({
      civility: 'Mme',
      lastName: 'DE NICOLAY',
      firstName: 'Axelle',
    })
  })

  it('accepte les accents dans le patronyme', () => {
    expect(splitCnccfpName('M. GUÉRAUD Sébastien')).toEqual({
      civility: 'M.',
      lastName: 'GUÉRAUD',
      firstName: 'Sébastien',
    })
  })

  it('accepte un prénom composé', () => {
    expect(splitCnccfpName('M. CUENOT Guy-Olivier')).toEqual({
      civility: 'M.',
      lastName: 'CUENOT',
      firstName: 'Guy-Olivier',
    })
  })

  it('tolère l’absence de civilité', () => {
    expect(splitCnccfpName('MARTIN Alexandra')).toEqual({
      civility: null,
      lastName: 'MARTIN',
      firstName: 'Alexandra',
    })
  })

  it('renvoie null pour une ligne corrompue', () => {
    // Le fichier 2022 contient deux lignes dont tous les champs valent « 0 ».
    expect(splitCnccfpName('0')).toBeNull()
    expect(splitCnccfpName('')).toBeNull()
    expect(splitCnccfpName('M.')).toBeNull()
  })
})
