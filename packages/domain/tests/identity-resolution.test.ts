import { describe, expect, it } from 'vitest'
import { resolveIdentity, type IdentityCandidate, type KnownPerson } from '../src/identity-resolution.js'

const macron: KnownPerson = {
  personId: 'p-macron',
  matchKey: 'emmanuel|macron',
  birthDate: '1977-12-21',
  externalIds: [{ source: 'AN', kind: 'ACTEUR_UID', value: 'PA1592' }],
  districtCodes: ['80-03'],
}

const rousseauEco: KnownPerson = {
  personId: 'p-rousseau-eco',
  matchKey: 'sandrine|rousseau',
  birthDate: null,
  externalIds: [],
  districtCodes: ['75-09'],
}

const rousseauDvd: KnownPerson = {
  personId: 'p-rousseau-dvd',
  matchKey: 'sandrine|rousseau',
  birthDate: null,
  externalIds: [],
  districtCodes: ['75-09'],
}

describe('resolveIdentity', () => {
  it('niveau 1 : un identifiant externe déjà connu confirme sans ambiguïté', () => {
    const candidat: IdentityCandidate = {
      matchKey: 'emmanuel|macron',
      birthDate: null,
      externalIds: [{ source: 'AN', kind: 'ACTEUR_UID', value: 'PA1592' }],
      districtCode: null,
    }
    const verdict = resolveIdentity(candidat, [macron])

    expect(verdict.confidence).toBe('CONFIRMED')
    expect(verdict.personId).toBe('p-macron')
    expect(verdict.autoMergeable).toBe(true)
    expect(verdict.evidence).toContain('EXTERNAL_ID')
  })

  it('niveau 2 : nom et date de naissance identiques confirment', () => {
    const candidat: IdentityCandidate = {
      matchKey: 'emmanuel|macron',
      birthDate: '1977-12-21',
      externalIds: [],
      districtCode: null,
    }
    const verdict = resolveIdentity(candidat, [macron])

    expect(verdict.confidence).toBe('CONFIRMED')
    expect(verdict.autoMergeable).toBe(true)
    expect(verdict.evidence).toContain('BIRTH_DATE')
  })

  it('sépare deux homonymes par leur date de naissance', () => {
    // Cas réel : deux députées nommées Alexandra Martin, nées en 1968 et 1976.
    const aînée: KnownPerson = { personId: 'p-1968', matchKey: 'alexandra|martin', birthDate: '1968-10-25', externalIds: [], districtCodes: [] }
    const cadette: KnownPerson = { personId: 'p-1976', matchKey: 'alexandra|martin', birthDate: '1976-07-28', externalIds: [], districtCodes: [] }

    const verdict = resolveIdentity(
      { matchKey: 'alexandra|martin', birthDate: '1976-07-28', externalIds: [], districtCode: null },
      [aînée, cadette],
    )

    expect(verdict.confidence).toBe('CONFIRMED')
    expect(verdict.personId).toBe('p-1976')
  })

  it('niveau 3 : sans date de naissance, la circonscription rend le rapprochement probable', () => {
    const verdict = resolveIdentity(
      { matchKey: 'emmanuel|macron', birthDate: null, externalIds: [], districtCode: '80-03' },
      [macron],
    )

    expect(verdict.confidence).toBe('PROBABLE')
    expect(verdict.autoMergeable).toBe(false)
    expect(verdict.evidence).toContain('DISTRICT')
  })

  it('niveau 4 : le nom seul ne donne qu’un rapprochement possible', () => {
    const verdict = resolveIdentity(
      { matchKey: 'emmanuel|macron', birthDate: null, externalIds: [], districtCode: null },
      [macron],
    )

    expect(verdict.confidence).toBe('POSSIBLE')
    expect(verdict.autoMergeable).toBe(false)
  })

  it('ne fusionne JAMAIS deux homonymes que rien ne départage', () => {
    // Cas réel : deux Sandrine Rousseau, même circonscription, même scrutin.
    const verdict = resolveIdentity(
      { matchKey: 'sandrine|rousseau', birthDate: null, externalIds: [], districtCode: '75-09' },
      [rousseauEco, rousseauDvd],
    )

    expect(verdict.autoMergeable).toBe(false)
    expect(verdict.confidence).toBe('AMBIGUOUS')
    expect(verdict.personId).toBeNull()
    expect(verdict.alternatives).toHaveLength(2)
  })

  it('signale une contradiction quand un identifiant connu désigne une autre date de naissance', () => {
    const verdict = resolveIdentity(
      {
        matchKey: 'emmanuel|macron',
        birthDate: '1980-01-01',
        externalIds: [{ source: 'AN', kind: 'ACTEUR_UID', value: 'PA1592' }],
        districtCode: null,
      },
      [macron],
    )

    expect(verdict.confidence).toBe('CONFLICT')
    expect(verdict.autoMergeable).toBe(false)
    expect(verdict.evidence).toContain('BIRTH_DATE_MISMATCH')
  })

  it('rend UNMATCHED quand aucune personne ne correspond', () => {
    const verdict = resolveIdentity(
      { matchKey: 'inconnu|personne', birthDate: null, externalIds: [], districtCode: null },
      [macron],
    )

    expect(verdict.confidence).toBe('UNMATCHED')
    expect(verdict.personId).toBeNull()
  })

  it('une date de naissance discordante écarte un homonyme au lieu de le rapprocher', () => {
    const verdict = resolveIdentity(
      { matchKey: 'alexandra|martin', birthDate: '1990-01-01', externalIds: [], districtCode: null },
      [{ personId: 'p-1968', matchKey: 'alexandra|martin', birthDate: '1968-10-25', externalIds: [], districtCodes: [] }],
    )

    expect(verdict.confidence).toBe('UNMATCHED')
    expect(verdict.personId).toBeNull()
  })

  it('confirme sur le seul homonyme dont la date correspond, même si un autre a une date nulle', () => {
    const verdict = resolveIdentity(
      { matchKey: 'alexandra|martin', birthDate: '1976-07-28', externalIds: [], districtCode: null },
      [
        { personId: 'p-1976', matchKey: 'alexandra|martin', birthDate: '1976-07-28', externalIds: [], districtCodes: [] },
        { personId: 'p-inconnue', matchKey: 'alexandra|martin', birthDate: null, externalIds: [], districtCodes: [] },
      ],
    )

    expect(verdict.confidence).toBe('CONFIRMED')
    expect(verdict.personId).toBe('p-1976')
  })

  it('écarte l’homonyme réfuté par sa date de naissance et ne garde que celui de date inconnue', () => {
    const verdict = resolveIdentity(
      { matchKey: 'alexandra|martin', birthDate: '1990-01-01', externalIds: [], districtCode: null },
      [
        { personId: 'p-1968', matchKey: 'alexandra|martin', birthDate: '1968-10-25', externalIds: [], districtCodes: [] },
        { personId: 'p-inconnue', matchKey: 'alexandra|martin', birthDate: null, externalIds: [], districtCodes: [] },
      ],
    )

    expect(verdict.confidence).toBe('POSSIBLE')
    expect(verdict.personId).toBe('p-inconnue')
    expect(verdict.alternatives).not.toContain('p-1968')
  })

  it('écarte deux homonymes réfutés et ne garde que le survivant de date inconnue', () => {
    const verdict = resolveIdentity(
      { matchKey: 'alexandra|martin', birthDate: '1990-01-01', externalIds: [], districtCode: null },
      [
        { personId: 'p-1968', matchKey: 'alexandra|martin', birthDate: '1968-10-25', externalIds: [], districtCodes: [] },
        { personId: 'p-1976', matchKey: 'alexandra|martin', birthDate: '1976-07-28', externalIds: [], districtCodes: [] },
        { personId: 'p-inconnue', matchKey: 'alexandra|martin', birthDate: null, externalIds: [], districtCodes: [] },
      ],
    )

    expect(verdict.confidence).toBe('POSSIBLE')
    expect(verdict.personId).toBe('p-inconnue')
    expect(verdict.alternatives).toHaveLength(0)
  })

  it('rend UNMATCHED quand tous les homonymes sont réfutés par leur date de naissance', () => {
    const verdict = resolveIdentity(
      { matchKey: 'alexandra|martin', birthDate: '1990-01-01', externalIds: [], districtCode: null },
      [
        { personId: 'p-1968', matchKey: 'alexandra|martin', birthDate: '1968-10-25', externalIds: [], districtCodes: [] },
        { personId: 'p-1976', matchKey: 'alexandra|martin', birthDate: '1976-07-28', externalIds: [], districtCodes: [] },
      ],
    )

    expect(verdict.confidence).toBe('UNMATCHED')
    expect(verdict.personId).toBeNull()
  })
})
