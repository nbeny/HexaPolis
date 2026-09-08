import { describe, expect, it } from 'vitest'
import { codeGeoDepuisCirconscription } from '../src/adapters/geo/codes.js'

describe('codeGeoDepuisCirconscription', () => {
  it('métropole : département sur deux caractères, rang sur deux', () => {
    expect(codeGeoDepuisCirconscription('01-4')).toBe('0104')
    expect(codeGeoDepuisCirconscription('75-6')).toBe('7506')
    expect(codeGeoDepuisCirconscription('93-10')).toBe('9310')
  })

  it('Corse : le code de département reste littéral', () => {
    expect(codeGeoDepuisCirconscription('2A-1')).toBe('2A01')
    expect(codeGeoDepuisCirconscription('2B-2')).toBe('2B02')
  })

  it('outre-mer : le GeoJSON emploie les codes INSEE historiques à lettre', () => {
    expect(codeGeoDepuisCirconscription('971-1')).toBe('ZA01')
    expect(codeGeoDepuisCirconscription('972-4')).toBe('ZB04')
    expect(codeGeoDepuisCirconscription('973-2')).toBe('ZC02')
    expect(codeGeoDepuisCirconscription('974-7')).toBe('ZD07')
    expect(codeGeoDepuisCirconscription('975-1')).toBe('ZS01')
    expect(codeGeoDepuisCirconscription('976-2')).toBe('ZM02')
  })

  it('rend null pour les territoires que la source ne cartographie pas', () => {
    // Français de l'étranger : aucun territoire cartographiable, par nature.
    expect(codeGeoDepuisCirconscription('099-1')).toBeNull()
    expect(codeGeoDepuisCirconscription('099-11')).toBeNull()
    // Collectivités absentes du fichier publié.
    expect(codeGeoDepuisCirconscription('977-1')).toBeNull()
    expect(codeGeoDepuisCirconscription('986-1')).toBeNull()
    expect(codeGeoDepuisCirconscription('987-3')).toBeNull()
    expect(codeGeoDepuisCirconscription('988-2')).toBeNull()
  })

  it('rend null sur une forme qu’il ne sait pas lire, plutôt que de deviner', () => {
    expect(codeGeoDepuisCirconscription('')).toBeNull()
    expect(codeGeoDepuisCirconscription('75')).toBeNull()
    expect(codeGeoDepuisCirconscription('75-')).toBeNull()
    expect(codeGeoDepuisCirconscription('pas-un-code')).toBeNull()
  })
})
