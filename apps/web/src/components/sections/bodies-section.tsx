import { SectionCard, type SectionSource } from '@/components/section-card'
import type { DeputyQuery } from '@/gql/generated'
import { formatDate } from '@/lib/format'

type Deputy = NonNullable<DeputyQuery['deputy']>

/**
 * `groupMemberships` et `committees` sortent du même type `BodyMembership`,
 * mais la fiche n'en sélectionne pas les mêmes champs : on garde donc les deux
 * types de tableau générés séparément plutôt qu'un type commun réécrit.
 */
type GroupMembership = NonNullable<Deputy['groupMemberships'][number]>
type Committee = NonNullable<Deputy['committees'][number]>

/**
 * `quality` distingue un président d'un simple membre ; il est publié tel quel
 * par l'AN (« Président », « Vice-Président », « Membre »...) et affiché sans
 * reformulation.
 */
function period(startDate: string | null, endDate: string | null): string {
  const start = formatDate(startDate)
  const end = formatDate(endDate)
  if (start && end) return `Du ${start} au ${end}`
  if (start) return `Depuis le ${start}`
  if (end) return `Jusqu'au ${end}`
  return 'Période non publiée'
}

function byStartDateDesc(
  a: { startDate: string | null },
  b: { startDate: string | null },
): number {
  if (a.startDate === b.startDate) return 0
  if (a.startDate === null) return 1
  if (b.startDate === null) return -1
  return a.startDate < b.startDate ? 1 : -1
}

export function BodiesSection({
  groupMemberships,
  committees,
  sources,
}: {
  groupMemberships: Deputy['groupMemberships']
  committees: Deputy['committees']
  sources: SectionSource[]
}) {
  const groups: GroupMembership[] = [...groupMemberships].sort(byStartDateDesc)
  const bodies: Committee[] = [...committees].sort(byStartDateDesc)

  return (
    <SectionCard title="Groupe et commissions" sources={sources}>
      <h3 className="text-sm font-medium text-stone-900">Groupes parlementaires</h3>
      {groups.length === 0 ? (
        <p className="mt-1 text-sm text-stone-500 italic">
          Aucune appartenance de groupe publiée pour cette personne.
        </p>
      ) : (
        <ul className="mt-1 space-y-2">
          {groups.map((membership) => (
            <li key={membership.id}>
              <p className="text-sm text-stone-900">
                {membership.bodyLabel}
                {membership.bodyShortLabel ? ` (${membership.bodyShortLabel})` : ''}
                {membership.quality ? ` — ${membership.quality}` : ''}
              </p>
              <p className="text-xs text-stone-500">
                {period(membership.startDate, membership.endDate)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-4 text-sm font-medium text-stone-900">Commissions</h3>
      {bodies.length === 0 ? (
        <p className="mt-1 text-sm text-stone-500 italic">
          Aucune appartenance de commission publiée pour cette personne.
        </p>
      ) : (
        <ul className="mt-1 space-y-2">
          {bodies.map((committee) => (
            <li key={committee.id}>
              <p className="text-sm text-stone-900">
                {committee.bodyLabel}
                {committee.quality ? ` — ${committee.quality}` : ''}
              </p>
              <p className="text-xs text-stone-500">
                {period(committee.startDate, committee.endDate)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
