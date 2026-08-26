import { SectionCard, type SectionSource } from '@/components/section-card'
import type { DeputyQuery } from '@/gql/generated'
import { formatInteger, formatPercent } from '@/lib/format'

type Deputy = NonNullable<DeputyQuery['deputy']>
type Candidacy = NonNullable<Deputy['candidacies'][number]>

/** Dérivé du type généré : voir `funding-section.tsx` pour la raison. */
export type ElectionCandidacy = Pick<
  Candidacy,
  | 'id'
  | 'electionLabel'
  | 'electionYear'
  | 'round'
  | 'territoryLabel'
  | 'nuance'
  | 'partyName'
  | 'votes'
  | 'votePctExpressed'
  | 'elected'
>

function roundLabel(round: number | null): string | null {
  if (round === null) return null
  return round === 1 ? '1er tour' : `${round}e tour`
}

/**
 * Tri décroissant : élection la plus récente d'abord, puis tour le plus élevé.
 * Un tour absent passe en dernier — il n'est pas assimilé à un tour 0, qui
 * n'existe pas.
 */
function compareCandidacies(a: ElectionCandidacy, b: ElectionCandidacy): number {
  if (a.electionYear !== b.electionYear) return b.electionYear - a.electionYear
  if (a.round === b.round) return 0
  if (a.round === null) return 1
  if (b.round === null) return -1
  return b.round - a.round
}

function groupByElection(candidacies: ElectionCandidacy[]): [string, ElectionCandidacy[]][] {
  const groups = new Map<string, ElectionCandidacy[]>()
  for (const candidacy of [...candidacies].sort(compareCandidacies)) {
    const existing = groups.get(candidacy.electionLabel)
    if (existing) existing.push(candidacy)
    else groups.set(candidacy.electionLabel, [candidacy])
  }
  return [...groups.entries()]
}

export function ElectionsSection({
  candidacies,
  sources,
}: {
  candidacies: ElectionCandidacy[]
  sources: SectionSource[]
}) {
  const groups = groupByElection(candidacies)

  return (
    <SectionCard title="Élections et résultats" sources={sources}>
      {groups.length === 0 ? (
        <p className="text-sm text-stone-500 italic">
          Aucune candidature n&apos;est rattachée à cette personne dans les jeux de données
          importés.
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map(([label, rounds]) => (
            <article key={label}>
              <h3 className="text-sm font-medium text-stone-900">{label}</h3>
              <ul className="mt-2 space-y-3">
                {rounds.map((candidacy) => {
                  // Voix et pourcentage viennent ensemble ou pas du tout : leur
                  // absence conjointe signale une candidature connue par une
                  // source qui ne publie pas de résultat.
                  const hasResult =
                    candidacy.votes !== null || candidacy.votePctExpressed !== null
                  const tour = roundLabel(candidacy.round)
                  return (
                    <li key={candidacy.id}>
                      <p className="text-sm text-stone-800">
                        {tour ?? 'Tour non publié par la source'}
                        {candidacy.territoryLabel ? ` — ${candidacy.territoryLabel}` : ''}
                      </p>
                      <p className="text-xs text-stone-500">
                        {candidacy.nuance
                          ? `Nuance ${candidacy.nuance}`
                          : 'Nuance politique non publiée'}
                        {candidacy.partyName ? ` · ${candidacy.partyName}` : ''}
                      </p>
                      {hasResult ? (
                        <>
                          <p className="text-sm text-stone-900">
                            {/* Chiffres repris tels que publiés, arrondi de la source compris. */}
                            {formatInteger(candidacy.votes) ?? 'nombre de voix non publié'}
                            {' voix'}
                            {candidacy.votePctExpressed === null
                              ? ' — pourcentage non publié'
                              : ` — ${formatPercent(candidacy.votePctExpressed)} des suffrages exprimés`}
                          </p>
                          <p className="text-sm font-medium text-stone-900">
                            {candidacy.elected ? 'Élu(e)' : 'Non élu(e)'}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-stone-500 italic">
                          Résultat non importé — la source qui porte cette candidature publie le
                          dépôt, pas le nombre de voix ni l&apos;issue du scrutin. Cette absence ne
                          dit rien du résultat : elle ne vaut ni élection ni échec.
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  )
}
