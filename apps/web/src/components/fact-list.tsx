export interface Fact {
  label: string
  /** `null` déclenche l'affichage d'absence — voir `lib/format.ts`. */
  value: string | null
  /** Motif d'absence, obligatoire dès lors que `value` peut être `null`. */
  absentWhy?: string
  badge?: React.ReactNode
}

export function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,14rem)_1fr]">
      {facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="text-sm text-stone-500">{fact.label}</dt>
          <dd className="text-sm text-stone-900">
            {fact.value === null ? (
              <span className="text-stone-500 italic">
                {fact.absentWhy ?? 'Donnée non disponible'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                {fact.value}
                {fact.badge}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
