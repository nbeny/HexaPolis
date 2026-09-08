'use client'

import { useEffect, useState } from 'react'
import type { VoteHistoryQuery } from '@/gql/generated'
import { VoteRow } from '@/components/vote-row'
import { graphqlFetchClient } from '@/lib/graphql-fetch-client'
import { formatInteger } from '@/lib/format'
import { VOTES_QUERY } from '@/lib/queries'

/** Même taille de page que la liste des députés : une seule valeur à retenir. */
const PAGE_SIZE = 25

/**
 * Décrit la tranche affichée plutôt que son seul cardinal. « 25 affichés sur
 * 2 518 » ne dit pas *lesquels* : sur une liste qu'on parcourt, la position
 * est l'information utile.
 */
export function pageLabel(offset: number, pageCount: number, totalCount: number): string {
  if (totalCount === 0) return 'aucune position de vote'
  // `formatInteger` rend `string | null` pour absorber les valeurs absentes
  // du domaine. Ici les trois valeurs sont des nombres, jamais nulles : le
  // repli explicite évite qu'une régression de signature fasse afficher
  // « null » à l'écran, ce que ce projet ne se permet nulle part.
  const n = (value: number) => formatInteger(value) ?? String(value)
  const from = offset + 1
  const to = Math.min(offset + pageCount, totalCount)
  return `${n(from)}-${n(to)} sur ${n(totalCount)}`
}

type Connection = NonNullable<VoteHistoryQuery['deputy']>['ballotPositions']

/**
 * Position courante dans la liste.
 *
 * `offset` est tenu ici plutôt que déduit du curseur : les curseurs sont
 * opaques par contrat, et le front n'a aucune raison de savoir qu'ils
 * encodent un entier. Avancer ajoute une page, reculer en retire une, et le
 * plancher à zéro reflète celui que l'API applique de son côté.
 */
type Page = { offset: number; after?: string; before?: string }

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; connection: Connection }

export function VoteHistory({ slug }: { slug: string }) {
  const [page, setPage] = useState<Page>({ offset: 0 })
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let abandonne = false
    setState({ status: 'loading' })

    const { offset: _offset, ...cursor } = page
    graphqlFetchClient<VoteHistoryQuery>(VOTES_QUERY, {
      slug,
      first: PAGE_SIZE,
      ...cursor,
    })
      .then((data) => {
        if (abandonne || !data.deputy) return
        setState({ status: 'ready', connection: data.deputy.ballotPositions })
      })
      .catch((error: unknown) => {
        if (abandonne) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })

    // Deux clics rapides sur « Suivant » lancent deux requêtes ; sans ce
    // drapeau, la plus lente écraserait la plus récente et la liste
    // afficherait une page que l'utilisateur a déjà quittée.
    return () => {
      abandonne = true
    }
  }, [slug, page])

  if (state.status === 'loading') {
    return <p className="mt-2 text-sm text-stone-600">Chargement des positions de vote…</p>
  }

  if (state.status === 'error') {
    return (
      <p className="mt-2 rounded border border-dashed border-stone-300 bg-stone-100/60 p-4 text-sm text-stone-700">
        Les positions de vote n&apos;ont pas pu être chargées : {state.message}
      </p>
    )
  }

  const { edges, pageInfo, totalCount } = state.connection

  if (totalCount === 0) {
    return (
      <p className="mt-2 text-sm text-stone-500 italic">
        Aucune position de vote n&apos;est rattachée à ce député, toutes législatures
        confondues.
      </p>
    )
  }

  return (
    <div>
      <ul className="mt-2 divide-y divide-stone-100">
        {edges.map((edge) => (
          <VoteRow key={edge.node.id} vote={edge.node} />
        ))}
      </ul>
      <nav className="mt-4 flex items-center justify-between text-sm">
        <button
          type="button"
          disabled={!pageInfo.hasPreviousPage}
          onClick={() =>
            setPage({
              offset: Math.max(0, page.offset - PAGE_SIZE),
              before: pageInfo.startCursor ?? undefined,
            })
          }
          className="text-stone-600 underline underline-offset-2 disabled:text-stone-400 disabled:no-underline"
        >
          ← Précédent
        </button>
        <span className="text-stone-600">
          {pageLabel(page.offset, edges.length, totalCount)}
        </span>
        <button
          type="button"
          disabled={!pageInfo.hasNextPage}
          onClick={() =>
            setPage({
              offset: page.offset + PAGE_SIZE,
              after: pageInfo.endCursor ?? undefined,
            })
          }
          className="text-stone-600 underline underline-offset-2 disabled:text-stone-400 disabled:no-underline"
        >
          Suivant →
        </button>
      </nav>
    </div>
  )
}
