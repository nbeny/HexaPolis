import { describe, expect, it } from 'vitest'
import { bodyTypeFromOrganeCode, mandateTypeFromTypeOrgane } from '../src/an-codes.js'

describe('bodyTypeFromOrganeCode', () => {
  it('reconnaît un groupe parlementaire', () => {
    expect(bodyTypeFromOrganeCode('GP')).toBe('PARLIAMENTARY_GROUP')
  })

  it('reconnaît une commission permanente', () => {
    expect(bodyTypeFromOrganeCode('COMPER')).toBe('COMMITTEE')
  })

  it('reconnaît une commission non législative', () => {
    expect(bodyTypeFromOrganeCode('COMNL')).toBe('COMMITTEE')
  })

  it('reconnaît une délégation', () => {
    expect(bodyTypeFromOrganeCode('DELEG')).toBe('DELEGATION')
  })

  it('renvoie null pour une circonscription, qui est un territoire et non un organe', () => {
    expect(bodyTypeFromOrganeCode('CIRCONSCRIPTION')).toBeNull()
  })

  it('renvoie null pour un code inconnu plutôt que de lever une exception', () => {
    expect(bodyTypeFromOrganeCode('CODE_QUI_NEXISTE_PAS')).toBeNull()
  })
})

describe('mandateTypeFromTypeOrgane', () => {
  it('reconnaît le mandat parlementaire', () => {
    expect(mandateTypeFromTypeOrgane('ASSEMBLEE')).toBe('PARLIAMENTARY')
  })

  it('classe le rattachement à un parti à part', () => {
    expect(mandateTypeFromTypeOrgane('PARPOL')).toBe('PARTY_AFFILIATION')
  })

  it('classe groupe et commissions comme appartenance à un organe', () => {
    expect(mandateTypeFromTypeOrgane('GP')).toBe('BODY_MEMBERSHIP')
    expect(mandateTypeFromTypeOrgane('COMPER')).toBe('BODY_MEMBERSHIP')
  })

  it('renvoie null pour un code inconnu', () => {
    expect(mandateTypeFromTypeOrgane('XXX')).toBeNull()
  })
})
