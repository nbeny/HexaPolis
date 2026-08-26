import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ComputedBadge } from '@/components/computed-badge'

describe('ComputedBadge', () => {
  it('annonce en toutes lettres que le chiffre est calculé par PoliGraph', () => {
    render(<ComputedBadge />)
    expect(screen.getByText(/calculé par PoliGraph/i)).toBeInTheDocument()
  })

  it('porte une explication accessible, pas seulement une couleur', () => {
    render(<ComputedBadge />)
    // La distinction officiel/calculé doit survivre au daltonisme et aux
    // lecteurs d'écran : elle est portée par du texte, pas par une classe CSS.
    expect(screen.getByTitle(/n'est pas un chiffre publié/i)).toBeInTheDocument()
  })
})
