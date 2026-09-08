import { describe, expect, it } from 'vitest'
import {
  buildListHref,
  hasActiveFilters,
  isPastLastPage,
  listVariables,
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
      before: null,
    })
  })

  it('rend null pour un paramètre absent ou vide', () => {
    expect(readListParams({ departmentCode: '' })).toEqual({
      legislature: null,
      groupId: null,
      departmentCode: null,
      after: null,
      before: null,
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
    before: null,
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
      buildListHref({
        legislature: null,
        groupId: null,
        departmentCode: null,
        after: null,
        before: null,
      }),
    ).toBe('/deputes')
  })

  it('échappe les valeurs plutôt que de les concaténer', () => {
    const href = buildListHref({
      legislature: null,
      groupId: 'a&b=c',
      departmentCode: null,
      after: null,
      before: null,
    })
    expect(href).toBe('/deputes?groupId=a%26b%3Dc')
  })
})

describe('isPastLastPage', () => {
  const withCursor = {
    legislature: null,
    groupId: null,
    departmentCode: '33',
    after: 'b2Zmc2V0OjI1',
    before: null,
  }

  // Cas réel de l'écart 4 : `?departmentCode=33&after=b2Zmc2V0OjI1` sur 12
  // résultats — la page est vide, mais les filtres, eux, correspondent
  // toujours à quelque chose.
  it('vrai quand le curseur dépasse la fin d’une liste non vide', () => {
    expect(isPastLastPage(withCursor, 0, 12)).toBe(true)
  })

  it('faux quand la page contient des résultats', () => {
    expect(isPastLastPage(withCursor, 5, 12)).toBe(false)
  })

  it('faux quand aucun curseur n’est actif — première page vide, cause différente', () => {
    expect(isPastLastPage({ ...withCursor, after: null }, 0, 0)).toBe(false)
  })

  it('faux quand les filtres eux-mêmes ne correspondent à rien (totalCount à 0)', () => {
    // Même avec un curseur, si `totalCount` est déjà à 0 le motif est le
    // filtre, pas la pagination : le message « aucun résultat » reste vrai.
    expect(isPastLastPage(withCursor, 0, 0)).toBe(false)
  })

  // `before` est borné à zéro par `resolveOffset` côté API
  // (`apps/api/src/graphql/common/cursor.ts`) : il ne peut jamais produire un
  // offset négatif, donc jamais « dépasser le début ». Un `before` périmé ou
  // bricolé qui pointe hors de la liste se retrouve donc lui aussi au-delà de
  // la fin, comme un `after` périmé — `b2Zmc2V0OjEwMDAw` décode en
  // `offset:10000`, largement au-delà des 12 résultats de ce filtre.
  it('vrai aussi pour un `before` périmé qui pointe au-delà de la fin', () => {
    expect(isPastLastPage({ ...withCursor, after: null, before: 'b2Zmc2V0OjEwMDAw' }, 0, 12)).toBe(
      true,
    )
  })
})

describe('before', () => {
  it('lit le curseur de retour dans la query string', () => {
    expect(readListParams({ before: 'Y3Vyc2V1cg==' }).before).toBe('Y3Vyc2V1cg==')
  })

  it('rend null quand il est absent', () => {
    expect(readListParams({}).before).toBeNull()
  })

  it('sérialise `before` dans le lien, en conservant les filtres actifs', () => {
    const params = readListParams({ departmentCode: '33', after: 'QUZURVI=' })
    expect(buildListHref(params, { after: null, before: 'QkVGT1JF' })).toBe(
      '/deputes?departmentCode=33&before=QkVGT1JF',
    )
  })

  it("n'émet jamais `after` et `before` ensemble : l'API les refuse", () => {
    const params = readListParams({ after: 'QUZURVI=' })
    const href = buildListHref(params, { before: 'QkVGT1JF' })
    expect(href).not.toContain('after=')
    expect(href).toContain('before=QkVGT1JF')
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
        before: null,
      }),
    ).toBe(false)
    expect(
      hasActiveFilters({
        legislature: null,
        groupId: null,
        departmentCode: '75',
        after: null,
        before: null,
      }),
    ).toBe(true)
  })
})

describe('listVariables', () => {
  // `readListParams` lit `after` et `before` indépendamment l'un de l'autre :
  // rien n'empêche une URL bricolée à la main de porter les deux. C'est le
  // seul chemin par lequel la combinaison interdite pourrait atteindre
  // l'API et lui faire rendre un `BAD_USER_INPUT` — `buildListHref` ne
  // produit lui-même jamais les deux ensemble, donc ne le teste pas.
  it("n'envoie que `after` à l'API quand une URL porte les deux curseurs", () => {
    const params = readListParams({ after: 'QUZURVI=', before: 'QkVGT1JF' })
    const variables = listVariables(params)
    expect(variables.after).toBe('QUZURVI=')
    expect(variables.before).toBeUndefined()
  })
})
