import type { Metadata } from 'next'
import Link from 'next/link'
import { Carte, type ContourDepute } from '@/components/carte'
import { codeGeoDepuisCirconscription } from '@/lib/circonscription-codes'
import { formatInteger } from '@/lib/format'
import { graphqlFetch } from '@/lib/graphql-fetch'
import type { MapDeputiesQuery, MapDeputiesQueryVariables } from '@/gql/generated'
import { MAP_DEPUTIES_QUERY } from '@/lib/queries'

export const metadata: Metadata = {
  title: 'Carte des circonscriptions — PoliGraph',
  description:
    "Où siège chaque député, sur les contours des circonscriptions législatives publiés par data.gouv.fr.",
}

/**
 * Rendu dynamique explicite. Sans cela, Next prérend cette page au build et
 * tente d'interroger l'API, qui ne tourne ni en local à ce moment-là ni en
 * CI : `next build` échoue en ECONNREFUSED. Les trois autres pages y
 * échappent par effet de bord, parce qu'elles lisent `searchParams` ou
 * `params` ; celle-ci n'a aucun paramètre, il faut donc le dire.
 */
export const dynamic = 'force-dynamic'

/** Même valeur que `loadFilterOptions` (`lib/filter-options.ts`) : 577 députés, 3 pages de 200. */
const SCAN_PAGE_SIZE = 200

/** Même garde-fou que `loadFilterOptions` : voir son commentaire pour la raison. */
const MAX_SCAN_PAGES = 20

type MapDeputyNode = NonNullable<MapDeputiesQuery['deputies']['edges'][number]>['node']

/**
 * Balaie tous les députés en base pour la carte, comme `loadFilterOptions`
 * balaie les options de filtre : le schéma GraphQL n'offre aucune requête
 * « tous les députés d'un coup » au-delà de `MAX_PAGE_SIZE` (200), et une
 * carte qui n'afficherait que les 200 premiers en tairait 377.
 */
async function loadMapDeputies(): Promise<MapDeputyNode[]> {
  const nodes: MapDeputyNode[] = []
  let after: string | null = null

  for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
    const variables: Partial<MapDeputiesQueryVariables> = {
      first: SCAN_PAGE_SIZE,
      ...(after !== null && { after }),
    }
    const data: MapDeputiesQuery = await graphqlFetch<MapDeputiesQuery>(
      MAP_DEPUTIES_QUERY,
      variables,
    )
    for (const edge of data.deputies.edges) nodes.push(edge.node)
    if (!data.deputies.pageInfo.hasNextPage) break
    after = data.deputies.pageInfo.endCursor
    if (after === null) break
  }

  return nodes
}

/**
 * Répartit les députés entre ceux que le GeoJSON peut positionner et ceux
 * qu'il ne peut pas. `codeGeoDepuisCirconscription` rend `null` pour les
 * territoires que la source ne cartographie pas (voir son commentaire) ; un
 * `departmentCode` absent est traité de la même façon, défensivement, car il
 * empêcherait de calculer le groupe majoritaire du département sur la carte
 * dézoomée.
 */
function repartir(deputies: readonly MapDeputyNode[]): {
  avecContour: ContourDepute[]
  sansContour: MapDeputyNode[]
} {
  const avecContour: ContourDepute[] = []
  const sansContour: MapDeputyNode[] = []

  for (const deputy of deputies) {
    const codeCirconscription = deputy.constituencyCode
      ? codeGeoDepuisCirconscription(deputy.constituencyCode)
      : null

    if (codeCirconscription && deputy.departmentCode) {
      avecContour.push({
        codeCirconscription,
        departmentCode: deputy.departmentCode,
        slug: deputy.slug,
        displayName: deputy.displayName,
        constituencyLabel: deputy.constituencyLabel,
        groupId: deputy.currentGroupId,
        groupShortLabel: deputy.currentGroupShortLabel,
        groupColor: deputy.currentGroupColor,
      })
    } else {
      sansContour.push(deputy)
    }
  }

  return { avecContour, sansContour }
}

export default async function CartePage() {
  const deputies = await loadMapDeputies()
  const { avecContour, sansContour } = repartir(deputies)

  const totalLabel = formatInteger(deputies.length) ?? String(deputies.length)
  const avecContourLabel = formatInteger(avecContour.length) ?? String(avecContour.length)
  const sansContourLabel = formatInteger(sansContour.length) ?? String(sansContour.length)

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900">Carte des circonscriptions</h1>
        <p className="mt-1 text-sm text-stone-600">
          {avecContourLabel} circonscriptions sur {totalLabel} sont représentées ici, coloriées par
          le groupe parlementaire du député qui y siège au moment de l&apos;import. Survolez une
          circonscription pour son nom ; cliquez pour ouvrir sa fiche.
        </p>
      </header>

      <Carte deputies={avecContour} />

      {sansContour.length > 0 && (
        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-base font-semibold text-stone-900">
            {sansContourLabel} députés que cette carte ne peut pas situer
          </h2>
          <p className="mb-3 text-sm text-stone-600">
            Le fichier de contours publié par data.gouv.fr ne couvre pas tous les territoires
            électoraux. Les circonscriptions listées ci-dessous n&apos;ont donc aucune
            représentation graphique ici, alors que leurs députés siègent au même titre que les
            autres : les faire disparaître serait aussi trompeur que de les situer à tort. Chaque
            nom pointe vers sa fiche.
          </p>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {sansContour.map((deputy) => (
              <li key={deputy.id} className="text-sm">
                <Link
                  href={`/deputes/${deputy.slug}`}
                  className="text-stone-900 underline underline-offset-2 hover:text-stone-700"
                >
                  {deputy.displayName}
                </Link>
                {deputy.constituencyLabel && (
                  <span className="text-stone-500"> — {deputy.constituencyLabel}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-6 border-t border-stone-200 pt-3 text-xs text-stone-500">
        Contours géographiques : « Contours géographiques des circonscriptions législatives »,
        data.gouv.fr, Licence Ouverte 2.0, publiés le 13/06/2024.
      </p>
    </section>
  )
}
