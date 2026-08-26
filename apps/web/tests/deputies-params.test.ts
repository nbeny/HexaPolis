import { describe, expect, it } from 'vitest'
import {
  buildListHref,
  hasActiveFilters,
  readListParams,
} from '@/lib/deputies-params'

describe('readListParams', () => {
  it('lit les trois filtres et le curseur depuis la query string', () => {
    expect(
      readListParams({
        legislature: '17',
        groupId: 'grp-1',
        departmentCode: '75',
        after: 'b2Zmc2V0OjI1',
      }),
    ).toEqual({
      legislature: 17,
      groupId: 'grp-1',
      departmentCode: '75',
      after: 'b2Zmc2V0OjI1',
    })
  })

  it('rend null pour un paramètre absent ou vide', () => {
    expect(readListParams({ departmentCode: '' })).toEqual({
      legislature: null,
      groupId: null,
      departmentCode: null,
      after: null,
    })
  })

  it("traite une législature illisible comme absente, jamais comme zéro", () => {
    // `legislature: 0` renverrait une page vide de l'API, ce qui affirmerait
    // à tort qu'aucun député ne correspond.
    expect(readListParams({ legislature: 'abc' }).legislature).toBeNull()
    expect(readListParams({ legislature: '17.5' }).legislature).toBeNull()
  })

  it('retient la première valeur quand un paramètre est répété', () => {
    expect(readListParams({ departmentCode: ['75', '13'] }).departmentCode).toBe('75')
  })
})

describe('buildListHref', () => {
  const filtres = {
    legislature: 17,
    groupId: 'grp-1',
    departmentCode: '75',
    after: null,
  }

  it('conserve les filtres actifs dans le lien « page suivante »', () => {
    // Le défaut que ce test existe pour empêcher : un lien de pagination qui
    // ne porterait que le curseur. La page 2 montrerait alors les députés
    // suivants de la liste complète en prétendant filtrer sur Paris.
    const href = buildListHref(filtres, { after: 'b2Zmc2V0OjI1' })
    const query = new URLSearchParams(href.slice(href.indexOf('?') + 1))

    expect(href.startsWith('/deputes?')).toBe(true)
    expect(query.get('legislature')).toBe('17')
    expect(query.get('groupId')).toBe('grp-1')
    expect(query.get('departmentCode')).toBe('75')
    expect(query.get('after')).toBe('b2Zmc2V0OjI1')
  })

  it('omet le curseur pour revenir à la première page sans perdre les filtres', () => {
    const href = buildListHref({ ...filtres, after: 'b2Zmc2V0OjI1' }, { after: null })
    expect(href).not.toContain('after=')
    expect(href).toContain('departmentCode=75')
  })

  it('rend une URL nue quand aucun filtre n’est actif', () => {
    expect(
      buildListHref({ legislature: null, groupId: null, departmentCode: null, after: null }),
    ).toBe('/deputes')
  })

  it('échappe les valeurs plutôt que de les concaténer', () => {
    const href = buildListHref({
      legislature: null,
      groupId: 'a&b=c',
      departmentCode: null,
      after: null,
    })
    expect(href).toBe('/deputes?groupId=a%26b%3Dc')
  })
})

describe('hasActiveFilters', () => {
  it('ne compte pas la pagination comme un filtre', () => {
    expect(
      hasActiveFilters({
        legislature: null,
        groupId: null,
        departmentCode: null,
        after: 'b2Zmc2V0OjI1',
      }),
    ).toBe(false)
    expect(
      hasActiveFilters({
        legislature: null,
        groupId: null,
        departmentCode: '75',
        after: null,
      }),
    ).toBe(true)
  })
})
