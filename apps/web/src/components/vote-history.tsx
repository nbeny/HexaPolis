'use client'

import { useEffect, useRef, useState } from 'react'
import type { VoteHistoryQuery } from '@/gql/generated'
import { VoteRow } from '@/components/vote-row'
import { graphqlFetchClient } from '@/lib/graphql-fetch-client'
import { formatInteger } from '@/lib/format'
import { VOTES_QUERY } from '@/lib/queries'

/** Même taille de page que la liste des députés : une seule valeur à retenir. */
const PAGE_SIZE = 25

/**
 * Au-delà de ce délai sans réponse — API indisponible, JS bloqué par un
 * réseau défaillant — l'attente bascule en erreur explicite. « Chargement… »
 * ne doit jamais être un état terminal : un visiteur qui le lit toujours
 * après 15 secondes ne doit pas se demander s'il regarde une page figée.
 */
const TIMEOUT_MS = 15_000

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

/**
 * Fiche du député sur le site de l'Assemblée nationale, pour le repli
 * `<noscript>`. Le préfixe du slug (avant le premier `-`) est l'identifiant
 * AN — voir `buildDeputySlug`/`anIdFromSlug` dans
 * `apps/api/src/graphql/common/slug.ts`, dont cette fonction reprend la même
 * lecture, côté navigateur cette fois.
 */
function anProfileUrl(slug: string): string {
  const anId = (slug.split('-')[0] ?? '').toUpperCase()
  return `https://www.assemblee-nationale.fr/dyn/deputes/${anId}`
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
  /**
   * L'API a répondu sans erreur mais sans député (`{ data: { deputy: null
   * } }`) : le slug ne résout plus personne, par ex. un ré-import entre le
   * rendu serveur de la fiche et cette requête client. Un état nommé, pas un
   * retour muet qui laisserait « Chargement… » s'afficher indéfiniment — la
   * panne que ce module existe pour éviter (voir `graphql-fetch.ts`).
   */
  | { status: 'not-found' }
  | { status: 'ready'; connection: Connection }

export function VoteHistory({ slug }: { slug: string }) {
  const [page, setPage] = useState<Page>({ offset: 0 })
  const [state, setState] = useState<State>({ status: 'loading' })
  /**
   * Dernière page effectivement chargée avec succès. Sert de point de
   * retour quand une page suivante échoue : sans lui, un échec sur la page
   * 40 serait un cul-de-sac, la liste ayant déjà oublié le curseur de la
   * page 39 au moment où l'erreur s'affiche.
   */
  const lastGoodPageRef = useRef<Page>({ offset: 0 })

  useEffect(() => {
    let abandonne = false
    setState({ status: 'loading' })

    const delaiDepasse = setTimeout(() => {
      abandonne = true
      setState({
        status: 'error',
        message: `le chargement dépasse ${TIMEOUT_MS / 1000} secondes : l'API est probablement indisponible.`,
      })
    }, TIMEOUT_MS)

    const { offset: _offset, ...cursor } = page
    graphqlFetchClient<VoteHistoryQuery>(VOTES_QUERY, {
      slug,
      first: PAGE_SIZE,
      ...cursor,
    })
      .then((data) => {
        if (abandonne) return
        clearTimeout(delaiDepasse)
        if (!data.deputy) {
          setState({ status: 'not-found' })
          return
        }
        lastGoodPageRef.current = page
        setState({ status: 'ready', connection: data.deputy.ballotPositions })
      })
      .catch((error: unknown) => {
        if (abandonne) return
        clearTimeout(delaiDepasse)
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
      clearTimeout(delaiDepasse)
    }
  }, [slug, page])

  let content: React.ReactNode

  if (state.status === 'loading') {
    content = <p className="mt-2 text-sm text-stone-600">Chargement des positions de vote…</p>
  } else if (state.status === 'not-found') {
    content = (
      <p className="mt-2 rounded border border-dashed border-stone-300 bg-stone-100/60 p-4 text-sm text-stone-700">
        L&apos;historique de vote de ce député n&apos;a pas pu être retrouvé. Rechargez la page ;
        si le problème persiste, contactez PoliGraph.
      </p>
    )
  } else if (state.status === 'error') {
    // `page.offset` égal à celui de la dernière page réussie signifie qu'il
    // n'y a nulle part de sensé où revenir (première requête jamais réussie,
    // ou nouvel échec sur la page déjà affichée) : le bouton de retour ne
    // sert à rien dans ce cas, et n'est pas montré.
    const peutRevenir = lastGoodPageRef.current.offset !== page.offset
    content = (
      <div className="mt-2 rounded border border-dashed border-stone-300 bg-stone-100/60 p-4 text-sm text-stone-700">
        <p>Les positions de vote n&apos;ont pas pu être chargées : {state.message}</p>
        <div className="mt-3 flex gap-4">
          <button
            type="button"
            className="underline underline-offset-2 hover:text-stone-900"
            onClick={() => setPage({ ...page })}
          >
            Réessayer
          </button>
          {peutRevenir && (
            <button
              type="button"
              className="underline underline-offset-2 hover:text-stone-900"
              onClick={() => setPage(lastGoodPageRef.current)}
            >
              ← Revenir à la page précédente
            </button>
          )}
        </div>
      </div>
    )
  } else {
    const { edges, pageInfo, totalCount } = state.connection

    if (totalCount === 0) {
      content = (
        <p className="mt-2 text-sm text-stone-500 italic">
          Aucune position de vote n&apos;est rattachée à ce député, toutes législatures
          confondues.
        </p>
      )
    } else {
      content = (
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
  }

  return (
    <>
      {/*
        Sans JavaScript, aucun des états ci-dessus ne s'exécute jamais :
        React n'hydrate pas, `content` reste éternellement le rendu serveur
        de l'état « loading ». Ce `<noscript>` est la seule chose qu'un
        navigateur sans JS affichera réellement — le HTML natif s'en charge,
        aucune logique React n'est nécessaire pour le montrer ou le cacher.
      */}
      <noscript>
        <p className="mt-2 text-sm text-stone-600">
          L&apos;historique de vote de ce député nécessite JavaScript pour s&apos;afficher ici.
          Consultez-le directement sur sa fiche, sur le site de l&apos;Assemblée nationale :{' '}
          <a
            className="underline underline-offset-2"
            href={anProfileUrl(slug)}
            rel="noreferrer noopener"
            target="_blank"
          >
            {anProfileUrl(slug)}
          </a>
        </p>
      </noscript>
      {content}
    </>
  )
}
