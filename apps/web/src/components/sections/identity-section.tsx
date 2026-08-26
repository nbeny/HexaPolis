import { FactList, type Fact } from '@/components/fact-list'
import { SectionCard, type SectionSource } from '@/components/section-card'
import type { DeputyQuery } from '@/gql/generated'
import { formatDate } from '@/lib/format'

type Deputy = NonNullable<DeputyQuery['deputy']>

/** Dérivé du type généré : voir `funding-section.tsx` pour la raison. */
export type IdentityDeputy = Pick<
  Deputy,
  | 'displayName'
  | 'civility'
  | 'birthDate'
  | 'constituencyCode'
  | 'constituencyLabel'
  | 'departmentCode'
  | 'currentGroupLabel'
  | 'currentGroupShortLabel'
  | 'currentGroupColor'
>

/** Une couleur venue de la base n'est posée en style que si elle est bien une couleur. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i

function GroupChip({ shortLabel, color }: { shortLabel: string; color: string | null }) {
  return (
    <span
      className="rounded border border-stone-300 px-1.5 py-0.5 text-[0.7rem] font-medium text-stone-800"
      style={color && HEX_COLOR.test(color) ? { borderColor: color } : undefined}
    >
      {shortLabel}
    </span>
  )
}

export function IdentitySection({
  deputy,
  sources,
}: {
  deputy: IdentityDeputy
  sources: SectionSource[]
}) {
  const facts: Fact[] = [
    { label: 'Nom', value: deputy.displayName },
    {
      label: 'Civilité',
      value: deputy.civility,
      absentWhy: "L'Assemblée nationale ne publie pas de civilité pour cette personne.",
    },
    {
      label: 'Date de naissance',
      // Absence connue et attendue : l'AN ne publie pas la date de naissance de
      // tous les acteurs. Elle s'affiche comme absence, pas comme case vide.
      value: formatDate(deputy.birthDate),
      absentWhy: "L'Assemblée nationale ne publie pas la date de naissance de cette personne.",
    },
    {
      label: 'Circonscription',
      value: deputy.constituencyLabel,
      absentWhy: 'Aucune circonscription rattachée au mandat en cours.',
    },
    {
      label: 'Code de circonscription',
      value: deputy.constituencyCode,
      absentWhy: 'Non publié.',
    },
    {
      label: 'Département',
      value: deputy.departmentCode,
      absentWhy: 'Non publié.',
    },
    {
      label: 'Groupe parlementaire',
      value: deputy.currentGroupLabel,
      absentWhy:
        "Aucune appartenance de groupe en cours — un député non inscrit ou en cours de rattachement n'en porte pas.",
      badge: deputy.currentGroupShortLabel ? (
        <GroupChip
          shortLabel={deputy.currentGroupShortLabel}
          color={deputy.currentGroupColor}
        />
      ) : undefined,
    },
  ]

  return (
    <SectionCard title="Identité" sources={sources}>
      <FactList facts={facts} />
    </SectionCard>
  )
}
