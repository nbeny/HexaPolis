import { nilToNull } from '@poligraph/domain'

/**
 * Règle bronze : un scalaire publié est conservé sous forme de chaîne, une
 * valeur absente ou nil devient null, et rien n'est jamais interprété.
 */
export function rawString(value: unknown): string | null {
  const cleaned = nilToNull(value)
  if (cleaned === null) return null
  if (typeof cleaned === 'string') return cleaned
  if (typeof cleaned === 'number' || typeof cleaned === 'boolean') return String(cleaned)
  return null
}
