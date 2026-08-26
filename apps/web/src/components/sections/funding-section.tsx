import { Absent } from '@/components/absent'
import { SectionCard, type SectionSource } from '@/components/section-card'
import type { DeputyQuery } from '@/gql/generated'
import { formatAmount } from '@/lib/format'

type Deputy = NonNullable<DeputyQuery['deputy']>
type Candidacy = NonNullable<Deputy['candidacies'][number]>

/**
 * Les propriétés sont dérivées du type généré, jamais réécrites : un champ
 * renommé dans `apps/api/schema.gql` casse la compilation ici au lieu de
 * dériver en silence vers un affichage faux.
 */
export type FundingCandidacy = Pick<
  Candidacy,
  'id' | 'electionLabel' | 'electionYear' | 'territoryLabel' | 'account'
>

type Account = NonNullable<FundingCandidacy['account']>

/**
 * La CNCCFP publie la monnaie sous ses propres libellés (`EURO`, `CFP`) et non
 * en ISO 4217. `Intl.NumberFormat` refuse un code de plus de trois lettres et
 * lèverait une `RangeError` sur `EURO` : on traduit donc le libellé en code,
 * ce qui change l'étiquette de la monnaie, jamais le montant. Un libellé
 * inconnu n'est pas deviné — le nombre est rendu suivi du libellé publié.
 */
const ISO_CURRENCY: Record<string, string> = {
  EURO: 'EUR',
  EUR: 'EUR',
  CFP: 'XPF',
  XPF: 'XPF',
}

const PLAIN_NUMBER = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatAccountAmount(value: number | null, currency: string): string | null {
  const iso = ISO_CURRENCY[currency.toUpperCase()]
  if (iso) return formatAmount(value, iso)
  if (value === null) return null
  return `${PLAIN_NUMBER.format(value)} ${currency}`
}

/** Libellés repris tels quels de la nomenclature CNCCFP. */
function accountRows(account: Account): { label: string; value: string | null }[] {
  const amount = (value: number | null) => formatAccountAmount(value, account.currency)
  return [
    { label: 'Dépenses déclarées', value: amount(account.declaredExpenses) },
    { label: 'Recettes déclarées', value: amount(account.declaredIncome) },
    { label: 'Dons déclarés', value: amount(account.declaredDonations) },
    { label: 'Apport personnel', value: amount(account.personalFunds) },
    { label: 'Dépenses retenues par la CNCCFP', value: amount(account.retainedExpenses) },
    { label: 'Recettes retenues par la CNCCFP', value: amount(account.retainedIncome) },
    // Le code de décision est affiché brut : PoliGraph n'a pas de table de
    // correspondance publiée pour ces sigles, et en inventer une reviendrait à
    // attribuer à la CNCCFP une décision qu'elle n'a pas formulée ainsi.
    { label: 'Code de décision publié par la CNCCFP', value: account.decisionCode },
  ]
}

export function FundingSection({
  candidacies,
  sources,
}: {
  candidacies: FundingCandidacy[]
  sources: SectionSource[]
}) {
  const funded = candidacies
    .filter((candidacy): candidacy is FundingCandidacy & { account: Account } => candidacy.account !== null)
    .sort((a, b) => b.electionYear - a.electionYear)

  return (
    <SectionCard title="Financement de campagne" sources={sources}>
      {funded.length === 0 ? (
        <Absent
          what="Compte de campagne"
          why="La CNCCFP publie les comptes de campagne par vagues, longtemps après le scrutin : seuls ceux des législatives de 2022 sont importés à ce jour. Aucune candidature connue de cette personne n'est rattachée à un compte publié."
          officialUrl="https://www.cnccfp.fr/"
          officialLabel="CNCCFP"
        />
      ) : (
        <div className="space-y-5">
          {funded.map((candidacy) => (
            <article key={candidacy.id}>
              <h3 className="text-sm font-medium text-stone-900">
                {candidacy.electionLabel}
                {candidacy.territoryLabel ? ` — ${candidacy.territoryLabel}` : ''}
              </h3>
              <ul className="mt-2 space-y-1">
                {accountRows(candidacy.account).map((row) => (
                  // Libellé et valeur tiennent dans un seul élément : un montant
                  // non déclaré doit se lire « Dons déclarés — non déclaré » et
                  // pas comme une case vide en face d'une étiquette.
                  <li
                    key={row.label}
                    className={
                      row.value === null
                        ? 'text-sm text-stone-500 italic'
                        : 'text-sm text-stone-800'
                    }
                  >
                    {row.label} — {row.value ?? 'non déclaré'}
                  </li>
                ))}
              </ul>
            </article>
          ))}
          <p className="text-xs text-stone-500">
            Montants publiés par la Commission nationale des comptes de campagne et des
            financements politiques, repris sans arrondi ni recalcul. Un montant à 0 € est une
            déclaration ; « non déclaré » signifie que la CNCCFP n'a rien publié pour cette ligne.
          </p>
        </div>
      )}
    </SectionCard>
  )
}
