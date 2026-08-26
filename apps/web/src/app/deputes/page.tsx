import type { Metadata } from 'next'
import Link from 'next/link'
import type { DeputiesQuery, DeputiesQueryVariables } from '@/gql/generated'
import {
  CURRENT_LEGISLATURE,
  PAGE_SIZE,
  buildListHref,
  hasActiveFilters,
  readListParams,
  type DeputyListParams,
  type RawSearchParams,
} from '@/lib/deputies-params'
import { loadFilterOptions, type FilterOptions } from '@/lib/filter-options'
import { formatInteger } from '@/lib/format'
import { graphqlFetch } from '@/lib/graphql-fetch'
import { DEPUTIES_QUERY } from '@/lib/queries'

export const metadata: Metadata = {
  title: 'Députés — PoliGraph',
  description:
    "Liste des députés de la 17e législature, filtrable par groupe parlementaire et par département.",
}

type DeputyRow = NonNullable<DeputiesQuery['deputies']['edges'][number]>['node']

/**
 * Un filtre inactif est *omis* des variables, jamais envoyé à `null`.
 *
 * En GraphQL, une variable absente laisse l'argument non fourni, tandis qu'un
 * `null` explicite est une valeur transmise. La nuance n'est pas théorique :
 * l'API décide qu'un filtre de législature est actif en testant
 * `legislature !== undefined` (`GoldRepository.listCards`), si bien qu'un
 * `legislature: null` explicite lui fait rendre `totalCount: 0` — une liste
 * vide, sans erreur, alors que 567 députés existent. Omettre exprime aussi
 * plus fidèlement l'intention : « pas de filtre » n'est pas « filtre à null ».
 */
function listVariables(params: DeputyListParams): Partial<DeputiesQueryVariables> {
  return {
    ...(params.legislature !== null && { legislature: params.legislature }),
    ...(params.groupId !== null && { groupId: params.groupId }),
    ...(params.departmentCode !== null && { departmentCode: params.departmentCode }),
    ...(params.after !== null && { after: params.after }),
    first: PAGE_SIZE,
  }
}

/**
 * Aucun `try`/`catch` : une panne de l'API doit remonter en page d'erreur.
 * Une liste vide affirmerait qu'aucun député ne correspond au filtre, ce qui
 * serait faux.
 */
async function loadDeputies(params: DeputyListParams): Promise<DeputiesQuery['deputies']> {
  const data = await graphqlFetch<DeputiesQuery>(DEPUTIES_QUERY, listVariables(params))
  return data.deputies
}

/**
 * Formulaire en GET, sans JavaScript : le navigateur sérialise lui-même les
 * champs dans la query string, et l'URL reste la seule source de vérité des
 * filtres. Un `onChange` en React aurait produit un état parallèle, non
 * partageable et invisible du serveur.
 */
function FilterForm({
  params,
  options,
}: {
  params: DeputyListParams
  options: FilterOptions
}) {
  return (
    <form
      method="get"
      action="/deputes"
      className="mb-6 rounded-lg border border-stone-200 bg-white p-5"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-stone-500">Législature</span>
          <select
            name="legislature"
            defaultValue={params.legislature === null ? '' : String(params.legislature)}
            className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-stone-900"
          >
            <option value="">Toutes</option>
            {/*
              La V1 n'a chargé que la 17e législature (spec §2) : c'est la
              seule valeur qui rende des résultats, et l'API répond une page
              vide pour toute autre. Proposer un champ libre laisserait croire
              que les législatures précédentes sont interrogeables.
            */}
            <option value={CURRENT_LEGISLATURE}>{CURRENT_LEGISLATURE}e législature</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-stone-500">Groupe parlementaire</span>
          <select
            name="groupId"
            defaultValue={params.groupId ?? ''}
            className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-stone-900"
          >
            <option value="">Tous les groupes</option>
            {options.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-stone-500">Département</span>
          <select
            name="departmentCode"
            defaultValue={params.departmentCode ?? ''}
            className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-stone-900"
          >
            <option value="">Tous les départements</option>
            {options.departments.map((department) => (
              <option key={department.code} value={department.code}>
                {department.code} — {department.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-3 text-xs text-stone-500">
        Les groupes et les départements proposés ici sont ceux réellement portés par les députés
        en base : aucune liste n&apos;est écrite en dur dans le site.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          className="rounded bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
        >
          Filtrer
        </button>
        {hasActiveFilters(params) && (
          <Link href="/deputes" className="text-sm text-stone-600 underline underline-offset-2">
            Réinitialiser
          </Link>
        )}
      </div>
    </form>
  )
}

/**
 * `totalCount` est un dénombrement de lignes de `gold.deputy_card`, pas un
 * agrégat : il n'appelle pas de `ComputedBadge`, réservé aux chiffres calculés
 * qui pourraient passer pour officiels.
 *
 * L'accord se fait sur le compte réel, zéro compris — « 0 député correspond »
 * et non « 0 députés correspondent ».
 */
function countSentence(total: number, filtered: boolean): string {
  const formatted = formatInteger(total) ?? String(total)
  const noun = total <= 1 ? 'député' : 'députés'
  if (!filtered) return `${formatted} ${noun} en base.`
  const verb = total <= 1 ? 'correspond' : 'correspondent'
  return `${formatted} ${noun} ${verb} aux filtres actifs.`
}

function DeputyRowItem({ deputy }: { deputy: DeputyRow }) {
  return (
    <li className="border-b border-stone-100 py-3 last:border-b-0">
      <Link
        href={`/deputes/${deputy.slug}`}
        className="text-sm font-medium text-stone-900 underline-offset-2 hover:underline"
      >
        {deputy.displayName}
      </Link>
      <p className="mt-0.5 text-xs text-stone-600">
        {deputy.constituencyLabel ?? 'Circonscription non publiée'}
        {' · '}
        {deputy.currentGroupShortLabel ? (
          <span className="inline-flex items-center gap-1.5">
            {deputy.currentGroupColor && (
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full align-middle"
                style={{ backgroundColor: deputy.currentGroupColor }}
              />
            )}
            {deputy.currentGroupShortLabel}
          </span>
        ) : (
          'Groupe non publié'
        )}
      </p>
    </li>
  )
}

export default async function DeputiesPage({
  searchParams,
}: {
  // `searchParams` est une promesse depuis Next 15, comme `params`.
  searchParams: Promise<RawSearchParams>
}) {
  const params = readListParams(await searchParams)
  const [connection, options] = await Promise.all([loadDeputies(params), loadFilterOptions()])

  const rows = connection.edges.map((edge) => edge.node)

  // Le lien de page suivante repart des filtres actifs : voir
  // `lib/deputies-params.ts` et son test — perdre un filtre ici serait
  // silencieux.
  const nextHref =
    connection.pageInfo.hasNextPage && connection.pageInfo.endCursor !== null
      ? buildListHref(params, { after: connection.pageInfo.endCursor })
      : null
  const firstPageHref = params.after === null ? null : buildListHref(params, { after: null })

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900">Députés</h1>
        <p className="mt-1 text-sm text-stone-600">
          {countSentence(connection.totalCount, hasActiveFilters(params))}
        </p>
      </header>

      <FilterForm params={params} options={options} />

      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-stone-300 bg-stone-100/60 p-4 text-sm text-stone-700">
          Aucun député ne correspond à ces filtres. Seuls les députés de la{' '}
          {CURRENT_LEGISLATURE}e législature figurent en base : un filtre portant sur une autre
          législature ne rend donc aucun résultat.
        </p>
      ) : (
        <ul className="rounded-lg border border-stone-200 bg-white px-5">
          {rows.map((deputy) => (
            <DeputyRowItem key={deputy.id} deputy={deputy} />
          ))}
        </ul>
      )}

      {(nextHref || firstPageHref) && (
        <nav className="mt-6 flex items-center justify-between text-sm">
          {/*
            Pagination par liens, pas par défilement infini : un lien porte
            son état dans l'URL, se met en favori et survit au bouton retour.
          */}
          <span>
            {firstPageHref && (
              <Link href={firstPageHref} className="text-stone-600 underline underline-offset-2">
                ← Première page
              </Link>
            )}
          </span>
          <span>
            {nextHref && (
              <Link href={nextHref} className="text-stone-600 underline underline-offset-2">
                Page suivante →
              </Link>
            )}
          </span>
        </nav>
      )}
    </section>
  )
}
