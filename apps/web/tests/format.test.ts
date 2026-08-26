import { describe, expect, it } from 'vitest'
import { formatDate, formatAmount, formatPercent, formatInteger } from '@/lib/format'

// `Intl` sépare les milliers par une espace insécable (U+202F narrow no-break
// space, parfois U+00A0) et non par une espace ordinaire. C'est correct
// typographiquement en français et doit rester dans la sortie : on normalise
// donc ici, dans le test, plutôt que de tordre l'implémentation.
function normalizeSpaces(value: string): string {
  return value.replace(/[  ]/g, ' ')
}

describe('format', () => {
  it('rend une date ISO au format français', () => {
    expect(formatDate('2024-07-07')).toBe('7 juillet 2024')
  })

  it('rend null pour une date absente, jamais une date par défaut', () => {
    expect(formatDate(null)).toBeNull()
    expect(formatDate(undefined)).toBeNull()
  })

  it('rend un montant avec sa devise, sans arrondir', () => {
    expect(normalizeSpaces(formatAmount(38150.42, 'EUR') ?? '')).toContain('38 150,42')
  })

  it('distingue zéro de absent', () => {
    // Un compte de campagne à 0 € déclaré est un fait ; l'absence n'en est pas un.
    expect(formatAmount(0, 'EUR')).toContain('0,00')
    expect(formatAmount(null, 'EUR')).toBeNull()
  })

  it('rend un pourcentage tel que fourni, sans le recalculer', () => {
    expect(formatPercent(52.31)).toBe('52,31 %')
    expect(formatPercent(null)).toBeNull()
  })

  it('sépare les milliers des entiers', () => {
    expect(normalizeSpaces(formatInteger(24_531) ?? '')).toBe('24 531')
    expect(formatInteger(null)).toBeNull()
  })
})
