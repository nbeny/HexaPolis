import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ElectionsSection } from '@/components/sections/elections-section'

describe('ElectionsSection', () => {
  it('affiche voix, pourcentage et issue tels que publiés', () => {
    render(
      <ElectionsSection
        candidacies={[
          {
            id: 'c1',
            electionLabel: 'Législatives 2024',
            electionYear: 2024,
            round: 2,
            territoryLabel: '1re circonscription de l’Ain',
            nuance: 'LR',
            partyName: null,
            votes: 24531,
            votePctExpressed: 52.31,
            elected: true,
          },
        ]}
        sources={[]}
      />,
    )
    expect(screen.getByText(/24 531/)).toBeInTheDocument()
    expect(screen.getByText(/52,31 %/)).toBeInTheDocument()
    expect(screen.getByText(/élu/i)).toBeInTheDocument()
    expect(screen.getByText(/2e tour/i)).toBeInTheDocument()
  })

  it("affiche l'absence de résultats sans inventer de zéro", () => {
    render(
      <ElectionsSection
        candidacies={[
          {
            id: 'c2',
            electionLabel: 'Législatives 2022',
            electionYear: 2022,
            round: null,
            territoryLabel: '1re circonscription de l’Ain',
            nuance: 'LR',
            partyName: null,
            votes: null,
            votePctExpressed: null,
            elected: false,
          },
        ]}
        sources={[]}
      />,
    )
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.getByText(/résultat non importé/i)).toBeInTheDocument()
  })
})
