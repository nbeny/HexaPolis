import { describe, expect, it } from 'vitest'
import {
  collectFilterOptions,
  departmentNameFromConstituency,
} from '@/lib/filter-options'

const node = (over: Partial<Parameters<typeof collectFilterOptions>[0][number]> = {}) => ({
  departmentCode: '01',
  constituencyLabel: "1ère circonscription de l'Ain",
  currentGroupId: 'grp-dr',
  currentGroupLabel: 'Droite Républicaine',
  ...over,
})

describe('departmentNameFromConstituency', () => {
  it('retire le rang et l’article des libellés publiés par l’Assemblée', () => {
    expect(departmentNameFromConstituency("4ème circonscription de l'Ain")).toBe('Ain')
    expect(departmentNameFromConstituency('2ème circonscription des Yvelines')).toBe('Yvelines')
    expect(departmentNameFromConstituency('1ère circonscription du Tarn')).toBe('Tarn')
    expect(departmentNameFromConstituency('1ère circonscription de la Somme')).toBe('Somme')
    expect(departmentNameFromConstituency('1ère circonscription de Mayotte')).toBe('Mayotte')
    expect(
      departmentNameFromConstituency('10ème circonscription des Français établis hors de France'),
    ).toBe('Français établis hors de France')
  })

  it("ne mange pas un « de » qui appartient au nom du territoire", () => {
    expect(departmentNameFromConstituency('1ère circonscription du Territoire de Belfort')).toBe(
      'Territoire de Belfort',
    )
  })

  it('rend null sur un libellé inattendu plutôt qu’un nom deviné', () => {
    expect(departmentNameFromConstituency(null)).toBeNull()
    expect(departmentNameFromConstituency('Paris')).toBeNull()
  })
})

describe('collectFilterOptions', () => {
  it('déduplique les groupes et les départements rencontrés', () => {
    const options = collectFilterOptions([
      node(),
      node({ constituencyLabel: "2ème circonscription de l'Ain" }),
      node({
        departmentCode: '75',
        constituencyLabel: '1ère circonscription de Paris',
        currentGroupId: 'grp-soc',
        currentGroupLabel: 'Socialistes et apparentés',
      }),
    ])

    expect(options.groups).toEqual([
      { id: 'grp-dr', label: 'Droite Républicaine' },
      { id: 'grp-soc', label: 'Socialistes et apparentés' },
    ])
    expect(options.departments).toEqual([
      { code: '01', label: 'Ain' },
      { code: '75', label: 'Paris' },
    ])
  })

  it('ignore un député sans groupe sans faire disparaître son département', () => {
    const options = collectFilterOptions([
      node({ currentGroupId: null, currentGroupLabel: null, departmentCode: '99' }),
    ])
    expect(options.groups).toEqual([])
    expect(options.departments).toEqual([{ code: '99', label: 'Ain' }])
  })

  it("retombe sur le code quand le libellé de circonscription n'est pas exploitable", () => {
    const options = collectFilterOptions([node({ departmentCode: '75', constituencyLabel: null })])
    expect(options.departments).toEqual([{ code: '75', label: '75' }])
  })

  it('garde un groupe sans intitulé publié, sous son identifiant', () => {
    // Le masquer rendrait ses députés introuvables au filtre — une absence
    // d'intitulé n'est pas une absence de groupe.
    const options = collectFilterOptions([node({ currentGroupLabel: null })])
    expect(options.groups).toEqual([{ id: 'grp-dr', label: 'grp-dr' }])
  })
})
