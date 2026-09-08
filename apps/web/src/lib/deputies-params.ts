/**
 * Les filtres de `/deputes` vivent dans la query string, jamais dans un état
 * React : une liste filtrée doit pouvoir se copier-coller, s'envoyer par
 * courriel et se recharger à l'identique, et elle doit être rendue par le
 * serveur (spec du plan, tâche 7).
 *
 * Tout le module tient dans deux fonctions parce que la pagination est le
 * point où l'on perd silencieusement un filtre : si le lien « page suivante »
 * ne porte que `?after=<curseur>`, la page 2 affiche les 25 députés suivants
 * de la liste *complète* au lieu des 25 suivants du département demandé, sans
 * aucun message d'erreur. La deuxième page ment alors sur ce qu'elle montre.
 * D'où `buildListHref`, qui repart systématiquement des filtres actifs, et
 * son test dédié.
 */

import type { DeputiesQueryVariables } from '@/gql/generated'

/** La 17e législature est le seul périmètre de la V1 (spec §2). */
export const CURRENT_LEGISLATURE = 17

/** Assez pour parcourir une liste, assez peu pour que la page reste lisible. */
export const PAGE_SIZE = 25

export interface DeputyListParams {
  /** Numéro de législature demandé, ou `null` si aucun filtre. */
  legislature: number | null
  groupId: string | null
  departmentCode: string | null
  /** Curseur opaque rendu par `pageInfo.endCursor`. */
  after: string | null
  /** Curseur opaque rendu par `pageInfo.startCursor`, pour reculer d'une page. */
  before: string | null
}

/** Ce que Next passe à une page pour `searchParams`, une fois la promesse attendue. */
export type RawSearchParams = Record<string, string | string[] | undefined>

/**
 * Next rend `string[]` quand un paramètre apparaît plusieurs fois
 * (`?departmentCode=75&departmentCode=13`). On retient la première valeur
 * plutôt que d'échouer : une URL bricolée à la main ne doit pas casser la page.
 */
function readOne(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function readListParams(searchParams: RawSearchParams): DeputyListParams {
  const legislature = readOne(searchParams.legislature)
  const parsed = legislature === null ? Number.NaN : Number(legislature)

  return {
    // Une législature illisible (`?legislature=abc`) est traitée comme absente.
    // La transformer en `0` ferait remonter une page vide à l'API, ce qui
    // affirmerait à tort qu'aucun député ne correspond.
    legislature: Number.isInteger(parsed) ? parsed : null,
    groupId: readOne(searchParams.groupId),
    departmentCode: readOne(searchParams.departmentCode),
    after: readOne(searchParams.after),
    before: readOne(searchParams.before),
  }
}

/**
 * Construit une URL de `/deputes`. `overrides` sert aux liens de pagination
 * (`{ after: cursor }`) et à la remise à zéro (`{ after: null }`) : le reste
 * des filtres est conservé par construction, pas par recopie manuelle.
 */
export function buildListHref(
  params: DeputyListParams,
  overrides: Partial<DeputyListParams> = {},
): string {
  const merged = { ...params, ...overrides }
  const query = new URLSearchParams()

  if (merged.legislature !== null) query.set('legislature', String(merged.legislature))
  if (merged.groupId !== null) query.set('groupId', merged.groupId)
  if (merged.departmentCode !== null) query.set('departmentCode', merged.departmentCode)
  // `after` et `before` s'excluent : l'API rejette les deux ensemble en
  // BAD_USER_INPUT. Un `before` demandé chasse donc l'`after` hérité des
  // paramètres courants, plutôt que de produire une URL que l'API refusera.
  // `!= null` (et non `!== null`) est délibéré : la plupart des appels (ex.
  // `nextHref`, qui ne passe que `{ after: cursor }`) ne mentionnent pas
  // `before` du tout, donc `overrides.before` vaut `undefined`, pas `null`.
  // Un `!== null` laisserait passer ce cas et écrirait `before=undefined`
  // dans l'URL au lieu de laisser la priorité à `merged.after` ci-dessous.
  if (overrides.before != null) {
    query.set('before', overrides.before)
  } else if (merged.after !== null) {
    query.set('after', merged.after)
  } else if (merged.before !== null) {
    query.set('before', merged.before)
  }

  const serialized = query.toString()
  return serialized === '' ? '/deputes' : `/deputes?${serialized}`
}

/**
 * Construit les variables GraphQL de la requête `Deputies` à partir des
 * paramètres de l'URL. Un filtre inactif est *omis*, jamais envoyé à `null`.
 *
 * En GraphQL, une variable absente laisse l'argument non fourni, tandis qu'un
 * `null` explicite est une valeur transmise. La nuance n'est pas théorique :
 * l'API décide qu'un filtre de législature est actif en testant
 * `legislature !== undefined` (`GoldRepository.listCards`), si bien qu'un
 * `legislature: null` explicite lui fait rendre `totalCount: 0` — une liste
 * vide, sans erreur, alors que 567 députés existent. Omettre exprime aussi
 * plus fidèlement l'intention : « pas de filtre » n'est pas « filtre à null ».
 *
 * Exportée (et non gardée locale à la page) parce que c'est le seul endroit
 * où l'exclusion `after`/`before` compte vraiment : `buildListHref` ne
 * produit jamais les deux à la fois, mais rien n'empêche une URL bricolée à
 * la main de les porter tous les deux — c'est alors `listVariables`, pas
 * `buildListHref`, qui empêche la combinaison interdite d'atteindre l'API et
 * de lui faire rendre un `BAD_USER_INPUT`.
 */
export function listVariables(params: DeputyListParams): Partial<DeputiesQueryVariables> {
  return {
    ...(params.legislature !== null && { legislature: params.legislature }),
    ...(params.groupId !== null && { groupId: params.groupId }),
    ...(params.departmentCode !== null && { departmentCode: params.departmentCode }),
    // `after` et `before` s'excluent côté API : les fournir ensemble est
    // rejeté en BAD_USER_INPUT. Nos propres liens n'émettent jamais les deux
    // à la fois (voir `buildListHref`), mais une URL bricolée à la main le
    // pourrait — `after` l'emporte alors, par cohérence avec `buildListHref`.
    ...(params.after !== null
      ? { after: params.after }
      : params.before !== null
        ? { before: params.before }
        : {}),
    first: PAGE_SIZE,
  }
}

/** Vrai dès qu'au moins un filtre est actif — la pagination n'en est pas un. */
export function hasActiveFilters(params: DeputyListParams): boolean {
  return (
    params.legislature !== null || params.groupId !== null || params.departmentCode !== null
  )
}

/**
 * Une page de liste vide a deux causes que le texte affiché ne doit jamais
 * confondre : soit aucun député ne correspond aux filtres (`totalCount ===
 * 0`), soit un curseur — `after` ou `before` — forgé ou périmé pointe hors
 * d'une liste qui, elle, a des résultats. La seconde ne dit rien des
 * filtres — écart 4 du plan p6, tâche 8 : `/deputes?departmentCode=33&after=…`
 * affichait « 12 députés correspondent aux filtres actifs » suivi d'un
 * message qui prétendait le contraire.
 *
 * `before` retombe dans le même cas que `after`, et pas seulement par
 * analogie : `resolveOffset` (`apps/api/src/graphql/common/cursor.ts`) borne
 * `before` à zéro, donc un `before` ne peut jamais produire un offset négatif
 * — il ne peut pas « dépasser le début ». Un `before` hors bornes se retrouve
 * donc lui aussi au-delà de la fin, exactement comme l'`after` périmé de
 * l'écart 4. Ce n'est atteignable que par une URL bricolée ou périmée
 * (`previousHref` ne construit un `before` qu'à partir d'un `startCursor`
 * réellement rendu par l'API).
 */
export function isPastLastPage(params: DeputyListParams, rowCount: number, totalCount: number): boolean {
  return rowCount === 0 && (params.after !== null || params.before !== null) && totalCount > 0
}
