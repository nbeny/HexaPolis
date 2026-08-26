import { SectionCard, type SectionSource } from '@/components/section-card'
import type { DeputyQuery } from '@/gql/generated'
import { formatDate } from '@/lib/format'

type Deputy = NonNullable<DeputyQuery['deputy']>
type Mandate = NonNullable<Deputy['mandates'][number]>

/**
 * Décroissant par date de début. Une date de début absente passe en dernier :
 * la traiter comme la date zéro placerait le mandat en tête de liste, ce qui
 * serait une affirmation chronologique que la source ne porte pas.
 */
function compareMandates(a: Mandate, b: Mandate): number {
  if (a.startDate === b.startDate) return 0
  if (a.startDate === null) return 1
  if (b.startDate === null) return -1
  return a.startDate < b.startDate ? 1 : -1
}

export function MandatesSection({
  mandates,
  sources,
}: {
  mandates: Deputy['mandates']
  sources: SectionSource[]
}) {
  const sorted = [...mandates].sort(compareMandates)

  return (
    <SectionCard title="Mandats" sources={sources}>
      {sorted.length === 0 ? (
        <p className="text-sm text-stone-500 italic">
          Aucun mandat rattaché à cette personne dans les jeux de données importés.
        </p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((mandate) => {
            const start = formatDate(mandate.startDate)
            const end = formatDate(mandate.endDate)
            return (
              <li key={mandate.id}>
                <p className="text-sm font-medium text-stone-900">
                  {mandate.institutionLabel}
                  {mandate.legislatureNumber === null
                    ? ''
                    : ` — ${mandate.legislatureNumber}e législature`}
                  {/* `endDate` nulle signifie mandat en cours dans les données AN. */}
                  {mandate.endDate === null ? ' · en cours' : ''}
                </p>
                <p className="text-sm text-stone-700">
                  {mandate.territoryLabel ?? 'Territoire non publié'}
                </p>
                <p className="text-xs text-stone-500">
                  {start ? `Du ${start}` : 'Date de début non publiée'}
                  {end ? ` au ${end}` : mandate.endDate === null ? ', toujours en cours' : ''}
                  {mandate.endCause ? ` · fin : ${mandate.endCause}` : ''}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </SectionCard>
  )
}
