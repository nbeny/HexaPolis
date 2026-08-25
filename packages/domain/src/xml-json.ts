/** Normalise un noeud XML→JSON en tableau : `mandats.mandat` est un tableau pour plusieurs mandats mais un objet nu pour un seul. */
export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** Convertit un noeud xsi:nil explicite en null : `"dateDeces": { "@xsi:nil": "true" }` représente une valeur nulle. */
export function nilToNull<T>(value: T): T | null {
  if (
    value !== null &&
    typeof value === 'object' &&
    '@xsi:nil' in (value as object) &&
    (value as unknown as { '@xsi:nil': unknown })['@xsi:nil'] === 'true'
  ) {
    return null
  }
  return value ?? null
}

/** Extrait le contenu scalaire d'un noeud texte typé : `"uid": { "@xsi:type": "IdActeur_type", "#text": "PA368" }` enveloppe un scalaire. */
export function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && '#text' in (value as object)) {
    const text = (value as { '#text': unknown })['#text']
    if (typeof text === 'string' || typeof text === 'number' || typeof text === 'boolean') {
      return String(text)
    }
    return null
  }
  return null
}
