import Link from 'next/link'
import type { SearchQuery, SearchQueryVariables } from '@/gql/generated'
import { CURRENT_LEGISLATURE, type RawSearchParams } from '@/lib/deputies-params'
import { graphqlFetch } from '@/lib/graphql-fetch'
import { SEARCH_QUERY } from '@/lib/queries'

/**
 * Assez large pour montrer tous les homonymes d'un patronyme courant, bien en
 * deçà du plafond de l'API (`MAX_SEARCH_LIMIT` = 50).
 */
const SEARCH_LIMIT = 25

type SearchHit = NonNullable<SearchQuery['search'][number]>

function readQuery(searchParams: RawSearchParams): string {
  const raw = searchParams.q
  const value = Array.isArray(raw) ? raw[0] : raw
  return (value ?? '').trim()
}

/**
 * Explique le périmètre plutôt que d'annoncer une absence.
 *
 * « Aucun résultat » tout court laisserait entendre que la personne cherchée
 * n'existe pas. La vraie raison est presque toujours que PoliGraph ne contient
 * que les députés de la 17e législature (spec §2) : c'est la question que se
 * pose l'utilisateur venu chercher un sénateur, un maire ou un député battu
 * en 2024.
 */
function NoResults({ query }: { query: string }) {
  return (
    <div className="mt-6 rounded border border-dashed border-stone-300 bg-stone-100/60 p-4 text-sm">
      <p className="font-medium text-stone-700">
        Aucun résultat pour « {query} » — ce n&apos;est pas forcément une absence.
      </p>
      <p className="mt-1 text-stone-600">
        PoliGraph ne contient que les députés de la {CURRENT_LEGISLATURE}e législature de
        l&apos;Assemblée nationale. Les sénateurs, les députés européens, les maires et les
        conseillers, ainsi que les députés des législatures précédentes, n&apos;y figurent pas :
        leur absence de cette recherche ne dit rien de leur mandat.
      </p>
      <p className="mt-2">
        <Link href="/deputes" className="text-stone-700 underline underline-offset-2">
          Parcourir les députés de la {CURRENT_LEGISLATURE}e législature par groupe et par
          département
        </Link>
      </p>
    </div>
  )
}

/**
 * Quand le nombre de résultats atteint exactement la limite, la liste est
 * peut-être tronquée : on le dit plutôt que de laisser croire à un compte
 * exhaustif.
 */
function countSentence(count: number): string {
  const noun = count <= 1 ? 'député trouvé' : 'députés trouvés'
  const truncated =
    count === SEARCH_LIMIT ? ` (affichage limité à ${SEARCH_LIMIT} — affinez la recherche)` : ''
  return `${count} ${noun}${truncated}.`
}

function ResultItem({ hit }: { hit: SearchHit }) {
  return (
    <li className="border-b border-stone-100 py-3 last:border-b-0">
      <Link
        href={`/deputes/${hit.slug}`}
        className="text-sm font-medium text-stone-900 underline-offset-2 hover:underline"
      >
        {hit.displayName}
      </Link>
      <p className="mt-0.5 text-xs text-stone-600">
        {hit.constituencyLabel ?? 'Circonscription non publiée'}
        {' · '}
        {hit.currentGroupLabel ?? 'Groupe non publié'}
      </p>
    </li>
  )
}

export default async function HomePage({
  searchParams,
}: {
  // `searchParams` est une promesse depuis Next 15, comme `params`.
  searchParams: Promise<RawSearchParams>
}) {
  const query = readQuery(await searchParams)

  // Pas de requête sur un champ vide : la page d'accueil ne doit pas coûter un
  // aller-retour à l'API pour ne rien afficher.
  const hits =
    query === ''
      ? null
      : (
          await graphqlFetch<SearchQuery>(SEARCH_QUERY, {
            query,
            first: SEARCH_LIMIT,
          } satisfies SearchQueryVariables)
        ).search

  return (
    <section>
      <h1 className="text-2xl font-semibold text-stone-900">Rechercher un député</h1>
      <p className="mt-1 text-sm text-stone-600">
        Par nom ou par circonscription. Seuls les députés de la {CURRENT_LEGISLATURE}e
        législature sont en base.
      </p>

      {/*
        Formulaire en GET, résultats rendus par le serveur. Pas de saisie
        assistée en direct : ce serait un appel par frappe sur une API limitée
        à 120 requêtes par minute et par IP, et le résultat d'une recherche ne
        serait plus partageable par URL.
      */}
      <form method="get" action="/" className="mt-4 flex gap-2">
        <label className="sr-only" htmlFor="q">
          Nom ou circonscription
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Nom du député, ou nom de circonscription"
          className="w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
        />
        <button
          type="submit"
          className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
        >
          Rechercher
        </button>
      </form>

      {hits === null ? null : hits.length === 0 ? (
        <NoResults query={query} />
      ) : (
        <>
          <p className="mt-6 text-sm text-stone-600">{countSentence(hits.length)}</p>
          <ul className="mt-2 rounded-lg border border-stone-200 bg-white px-5">
            {hits.map((hit) => (
              <ResultItem key={hit.personId} hit={hit} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
