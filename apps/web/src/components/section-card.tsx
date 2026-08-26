import { formatDate } from '@/lib/format'

export interface SectionSource {
  sourceId: string
  label: string
  importedAt: string | null
}

/**
 * Chaque section porte sa provenance à côté de son contenu, pas dans un pied
 * de page global (spec §9) : sur une fiche qui agrège quatre sources, un
 * unique « sources : AN, CNCCFP, RNE, Intérieur » n'apprendrait rien.
 */
export function SectionCard({
  title,
  sources,
  children,
}: {
  title: string
  sources?: SectionSource[]
  children: React.ReactNode
}) {
  return (
    <section className="mb-6 rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="mb-3 text-base font-semibold text-stone-900">{title}</h2>
      {children}
      {sources && sources.length > 0 && (
        <p className="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-500">
          {sources
            .map((s) => {
              const date = formatDate(s.importedAt)
              return date ? `${s.label}, importé le ${date}` : s.label
            })
            .join(' · ')}
        </p>
      )}
    </section>
  )
}
