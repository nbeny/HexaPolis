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
  if (merged.after !== null) query.set('after', merged.after)

  const serialized = query.toString()
  return serialized === '' ? '/deputes' : `/deputes?${serialized}`
}

/** Vrai dès qu'au moins un filtre est actif — la pagination n'en est pas un. */
export function hasActiveFilters(params: DeputyListParams): boolean {
  return (
    params.legislature !== null || params.groupId !== null || params.departmentCode !== null
  )
}
