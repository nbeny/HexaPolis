import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FundingSection } from '@/components/sections/funding-section'

const candidature2022 = {
  id: 'c1',
  electionLabel: 'Législatives 2022',
  electionYear: 2022,
  territoryLabel: '1re circonscription de l’Ain',
  account: {
    currency: 'EUR',
    declaredExpenses: 38150.42,
    declaredIncome: 40000,
    declaredDonations: null,
    personalFunds: null,
    retainedExpenses: 37900,
    retainedIncome: null,
    decisionCode: 'APPROBATION',
  },
}

describe('FundingSection', () => {
  it('affiche les montants déclarés tels quels', () => {
    render(<FundingSection candidacies={[candidature2022]} sources={[]} />)
    expect(screen.getByText(/38 150,42/)).toBeInTheDocument()
  })

  it("affiche un motif d'absence quand aucune candidature n'a de compte", () => {
    render(
      <FundingSection
        candidacies={[{ ...candidature2022, electionYear: 2024, account: null }]}
        sources={[]}
      />,
    )
    expect(screen.getByText(/donnée non disponible/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /CNCCFP/ })).toBeInTheDocument()
  })

  it("n'affiche pas 0 € pour un montant non déclaré", () => {
    render(<FundingSection candidacies={[candidature2022]} sources={[]} />)
    // `declaredDonations` est null : il ne doit apparaître ni comme 0 € ni
    // comme une ligne vide sans explication.
    expect(screen.queryByText('0,00 €')).not.toBeInTheDocument()
    expect(screen.getByText(/Dons.*non déclaré/i)).toBeInTheDocument()
  })
})
