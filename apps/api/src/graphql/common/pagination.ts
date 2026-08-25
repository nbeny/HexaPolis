/**
 * Bornes de pagination. `MAX_PAGE_SIZE` est un garde-fou en soi (spec §8.4) :
 * indépendamment de la limite de complexité, aucun client ne peut demander
 * une page de plusieurs milliers de positions de vote en un seul aller-retour.
 */
export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 200

export const DEFAULT_SEARCH_LIMIT = 10
export const MAX_SEARCH_LIMIT = 50

export function clampPageSize(first: number | undefined, fallback = DEFAULT_PAGE_SIZE): number {
  const requested = first ?? fallback
  return Math.min(Math.max(requested, 1), MAX_PAGE_SIZE)
}

export function clampSearchLimit(first: number | undefined): number {
  const requested = first ?? DEFAULT_SEARCH_LIMIT
  return Math.min(Math.max(requested, 1), MAX_SEARCH_LIMIT)
}
