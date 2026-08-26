/**
 * PostgreSQL rend les `COUNT(*)` en `bigint` (Prisma les expose en `BigInt`
 * JS — `1n !== 1`) et les colonnes `numeric` en `Prisma.Decimal`. Aucun des
 * deux ne sérialise correctement dans une réponse GraphQL `Int`/`Float`.
 * Cette fonction convertit les deux, et laisse `null`/`undefined` intacts —
 * c'est précisément la distinction (absence vs zéro) que l'API doit
 * préserver jusqu'au bout : ne jamais transformer un `NULL` de
 * `gold.deputy_card.participation_expressed_rate` en `0`.
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number') return value
  if (
    typeof value === 'object' &&
    'toNumber' in value &&
    typeof (value as { toNumber: unknown }).toNumber === 'function'
  ) {
    return (value as { toNumber(): number }).toNumber()
  }
  return Number(value)
}
