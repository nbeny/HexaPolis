/**
 * L'absence de donnée est un état de premier rang, pas un vide (spec §9).
 * Le cas le plus fréquent est le financement en 17e législature : la CNCCFP
 * n'a publié que 2022. Une section vide laisserait croire à un défaut du
 * site ; celle-ci dit ce qui manque, pourquoi, et où le vérifier.
 */
export function Absent({
  what,
  why,
  officialUrl,
  officialLabel,
}: {
  what: string
  why: string
  officialUrl?: string
  officialLabel?: string
}) {
  return (
    <div className="rounded border border-dashed border-stone-300 bg-stone-100/60 p-4 text-sm">
      <p className="font-medium text-stone-700">
        {what} — donnée non disponible
      </p>
      <p className="mt-1 text-stone-600">{why}</p>
      {officialUrl && officialLabel && (
        <p className="mt-2">
          <a
            className="text-stone-700 underline underline-offset-2 hover:text-stone-900"
            href={officialUrl}
            rel="noreferrer noopener"
            target="_blank"
          >
            Consulter la publication officielle — {officialLabel}
          </a>
        </p>
      )}
    </div>
  )
}
