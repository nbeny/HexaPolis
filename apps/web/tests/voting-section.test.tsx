import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VotingSection } from '@/components/sections/voting-section'

const resume = {
  status: 'COMPUTED' as const,
  mandateCount: 1,
  committeeCount: 2,
  voteCount: 412,
  participationBallotCount: 500,
  participationVoteCount: 412,
  participationRate: 0.824,
}

const positions = {
  totalCount: 412,
  pageInfo: { hasNextPage: true, endCursor: 'Y3Vyc29yOjI1' },
  edges: [
    {
      cursor: 'Y3Vyc29yOjE=',
      node: {
        id: 'bp1',
        ballotId: 'b1',
        ballotDate: '2024-10-15',
        ballotTitle: 'Projet de loi de finances pour 2025',
        ballotNumber: '412',
        legislatureNumber: 17,
        position: 'FOR',
        byDelegation: false,
        groupShortLabelAtVote: 'LR',
        publicationMode: 'DecompteNominatif',
      },
    },
  ],
}

describe('VotingSection', () => {
  it('marque le taux de participation comme calculé', () => {
    render(<VotingSection summary={resume} positions={positions} sources={[]} />)
    expect(screen.getByText(/82,40 %/)).toBeInTheDocument()
    expect(screen.getAllByText(/calculé par PoliGraph/i).length).toBeGreaterThan(0)
  })

  it("affiche l'absence quand le dénominateur est invérifiable, jamais 0 %", () => {
    render(
      <VotingSection
        summary={{
          ...resume,
          participationBallotCount: null,
          participationVoteCount: null,
          participationRate: null,
        }}
        positions={positions}
        sources={[]}
      />,
    )
    expect(screen.queryByText('0,00 %')).not.toBeInTheDocument()
    expect(screen.getByText(/non calculable/i)).toBeInTheDocument()
  })

  it("ne présente jamais une absence de ligne comme une absence du député", () => {
    render(<VotingSection summary={resume} positions={positions} sources={[]} />)
    // 412 positions sur 500 scrutins : les 88 restants ne sont PAS des
    // absences constatées — l'AN ne nomme les votants que sur les scrutins
    // publiés en décompte nominatif.
    expect(screen.getByText(/ne publie pas le détail nominatif/i)).toBeInTheDocument()
  })
})
