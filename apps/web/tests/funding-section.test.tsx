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

  // Le motif d'absence ne doit jamais imputer l'absence au calendrier de la
  // CNCCFP : un compte de 2022 peut exister en base sans être rattaché, et
  // c'est arrivé (cinq arbitrages du 26 août 2026). La rédaction doit laisser
  // les deux causes ouvertes.
  it("n'impute pas l'absence au calendrier de publication de la CNCCFP", () => {
    render(
      <FundingSection
        candidacies={[{ ...candidature2022, electionYear: 2024, account: null }]}
        sources={[]}
      />,
    )
    expect(screen.queryByText(/pas encore publié/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/par vagues/i)).not.toBeInTheDocument()
    expect(screen.getByText(/forme de nom que le rapprochement/i)).toBeInTheDocument()
    expect(screen.getByText(/ne peut pas trancher/i)).toBeInTheDocument()
  })

  it('dit que la candidature de 2022 est rattachée quand elle l’est, sans compte associé', () => {
    render(
      <FundingSection candidacies={[{ ...candidature2022, account: null }]} sources={[]} />,
    )
    expect(screen.getByText(/aucun compte de campagne ne lui est associé/i)).toBeInTheDocument()
    expect(screen.queryByText(/Aucune candidature de 2022/i)).not.toBeInTheDocument()
  })

  it("n'affiche pas 0 € pour un montant non déclaré", () => {
    render(<FundingSection candidacies={[candidature2022]} sources={[]} />)
    // `declaredDonations` est null : il ne doit apparaître ni comme 0 € ni
    // comme une ligne vide sans explication.
    expect(screen.queryByText('0,00 €')).not.toBeInTheDocument()
    expect(screen.getByText(/Dons.*non déclaré/i)).toBeInTheDocument()
  })
})
