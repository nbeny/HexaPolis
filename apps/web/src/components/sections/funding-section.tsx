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

/**
 * Année du seul scrutin dont les comptes de campagne sont importés : la
 * CNCCFP publie un fichier par élection et l'adaptateur n'en télécharge qu'un,
 * celui des législatives de 2022 (`CNCCFP_LEGISLATIVES_2022_URL`,
 * `packages/ingestion/src/adapters/cnccfp/cnccfp.adapter.ts`).
 */
const ANNEE_COMPTES_IMPORTES = 2022

/**
 * Motif de l'absence de compte de campagne.
 *
 * La rédaction précédente attribuait cette absence au calendrier de
 * publication de la CNCCFP. C'est vrai d'un député entré en fonction en 2024
 * et qui ne s'est pas présenté en 2022 ; c'est faux d'un député dont le
 * compte de 2022 est bel et bien en base mais n'est rattaché à personne,
 * faute d'avoir su rapprocher la forme de nom publiée par la CNCCFP de celle
 * de l'Assemblée nationale. Dire « la CNCCFP ne l'a pas encore publié » quand
 * le fichier est dans notre propre base est une affirmation fausse.
 *
 * La section ne peut pas distinguer ces deux causes : elle ne reçoit que les
 * candidatures DÉJÀ rattachées, donc une candidature non rattachée lui est
 * indiscernable d'une candidature inexistante. Elle énonce donc ce qu'elle
 * observe — le périmètre importé, et l'absence de candidature rattachée pour
 * l'année couverte — et laisse les deux causes possibles ouvertes au lieu
 * d'en désigner une.
 */
function motifAbsenceDeCompte(candidacies: FundingCandidacy[]): string {
  // Branche mesurée à 0 fiche sur 577 au 26 août 2026 : toutes les
  // candidatures de 2022 en base viennent de la CNCCFP et portent donc un
  // compte. Elle est écrite quand même — le jour où une candidature de 2022
  // arriverait d'une autre source, l'autre rédaction affirmerait à tort
  // qu'aucune n'est rattachée.
  if (candidacies.some((candidacy) => candidacy.electionYear === ANNEE_COMPTES_IMPORTES)) {
    return (
      `Une candidature de cette personne aux législatives de ${ANNEE_COMPTES_IMPORTES} est bien ` +
      `rattachée, mais aucun compte de campagne ne lui est associé dans le fichier CNCCFP importé. ` +
      `Les comptes des législatives de 2024 ne sont pas importés à ce jour.`
    )
  }
  return (
    `Seuls les comptes des législatives de ${ANNEE_COMPTES_IMPORTES} sont importés à ce jour ; ceux ` +
    `des législatives de 2024 ne le sont pas. Aucune candidature de ${ANNEE_COMPTES_IMPORTES} n'est ` +
    `rattachée à cette personne : soit elle ne s'est pas présentée à ce scrutin, soit son compte y ` +
    `figure sous une forme de nom que le rapprochement n'a pas encore reliée à elle. PoliGraph ne ` +
    `peut pas trancher entre ces deux cas, et ne prétend donc pas que la donnée n'existe pas.`
  )
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
          why={motifAbsenceDeCompte(candidacies)}
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
