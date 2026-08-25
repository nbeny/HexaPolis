export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

export function nilToNull<T>(value: T): T | null {
  if (value !== null && typeof value === 'object' && '@xsi:nil' in (value as object)) {
    return null
  }
  return value ?? null
}

export function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && '#text' in (value as object)) {
    const text = (value as { '#text': unknown })['#text']
    return typeof text === 'string' ? text : null
  }
  return null
}
