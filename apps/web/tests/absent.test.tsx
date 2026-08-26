import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Absent } from '@/components/absent'

describe('Absent', () => {
  it('nomme la donnée manquante et la source qui devrait la porter', () => {
    render(
      <Absent
        what="Compte de campagne"
        why="La CNCCFP n'a pas encore publié les comptes des législatives de 2024."
        officialUrl="https://www.cnccfp.fr/"
        officialLabel="CNCCFP"
      />,
    )
    expect(screen.getByText(/donnée non disponible/i)).toBeInTheDocument()
    expect(screen.getByText(/CNCCFP n'a pas encore publié/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /CNCCFP/ })
    expect(link).toHaveAttribute('href', 'https://www.cnccfp.fr/')
  })

  it("n'affiche jamais zéro à la place d'une absence", () => {
    render(<Absent what="Taux de participation" why="Dénominateur invérifiable." />)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByText('0 %')).not.toBeInTheDocument()
  })
})
