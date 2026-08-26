import type { FilterOptionsQuery, FilterOptionsQueryVariables } from '@/gql/generated'
import { graphqlFetch } from '@/lib/graphql-fetch'
import { FILTER_OPTIONS_QUERY } from '@/lib/queries'

/**
 * Les options des filtres de `/deputes` sont dérivées des députés en base,
 * jamais écrites en dur.
 *
 * Le schéma GraphQL (`apps/api/schema.gql`) n'expose ni `groups` ni
 * `departments` : la seule façon honnête de peupler les listes déroulantes est
 * donc de balayer `deputies` et de dédupliquer. Une liste de groupes
 * parlementaires recopiée à la main serait une donnée sans source — exactement
 * ce que ce projet refuse — et elle survivrait telle quelle à une scission de
 * groupe, à une dissolution ou à un changement d'intitulé.
 *
 * Coût réel : 567 députés, 3 allers-retours de 200 (le maximum accepté par
 * l'API, `MAX_PAGE_SIZE`), mis en cache par `graphqlFetch`.
 */

const SCAN_PAGE_SIZE = 200

/**
 * Garde-fou de boucle. `hasNextPage` vient du serveur ; si un jour un bug le
 * laissait à `true` indéfiniment, le rendu de la page tournerait sans fin au
 * lieu d'échouer. 20 pages couvrent 4 000 députés, largement au-delà des 577
 * sièges de l'Assemblée.
 */
const MAX_SCAN_PAGES = 20

export interface GroupOption {
  id: string
  label: string
}

export interface DepartmentOption {
  code: string
  label: string
}

export interface FilterOptions {
  groups: GroupOption[]
  departments: DepartmentOption[]
}

type FilterNode = NonNullable<FilterOptionsQuery['deputies']['edges'][number]>['node']

const CONSTITUENCY_PATTERN =
  /circonscription\s+(?:de\s+la\s+|de\s+l'|de\s+l’|des\s+|du\s+|de\s+|d'|d’)?(.+)$/iu

/**
 * `constituencyLabel` est publié par l'Assemblée sous la forme
 * « 4ème circonscription de l'Ain ». On en retire le rang et l'article pour
 * obtenir le nom du département, seul élément utile dans une liste déroulante
 * de 107 entrées où « 01 » ne dit rien à personne.
 *
 * C'est une reformulation d'affichage, pas un recalcul : le libellé complet
 * reste celui de la source sur la fiche du député. Si le motif ne correspond
 * pas, on rend `null` et l'appelant se rabat sur le code — jamais sur un nom
 * deviné.
 */
export function departmentNameFromConstituency(label: string | null): string | null {
  if (!label) return null
  const name = label.match(CONSTITUENCY_PATTERN)?.[1]?.trim()
  return name === undefined || name === '' ? null : name
}

export function collectFilterOptions(nodes: readonly FilterNode[]): FilterOptions {
  const groups = new Map<string, string>()
  const departments = new Map<string, string>()

  for (const node of nodes) {
    if (node.currentGroupId !== null) {
      // Un groupe sans intitulé publié reste sélectionnable sous son
      // identifiant : le masquer rendrait ses députés introuvables au filtre.
      groups.set(node.currentGroupId, node.currentGroupLabel ?? node.currentGroupId)
    }
    if (node.departmentCode !== null && !departments.has(node.departmentCode)) {
      const name = departmentNameFromConstituency(node.constituencyLabel)
      departments.set(node.departmentCode, name ?? node.departmentCode)
    }
  }

  const collator = new Intl.Collator('fr-FR')

  return {
    groups: [...groups.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => collator.compare(a.label, b.label)),
    // Tri par code et non par nom : les codes de département sont l'ordre
    // familier (01 Ain … 976 Mayotte), et le nom du département n'est de toute
    // façon qu'une commodité d'affichage.
    departments: [...departments.entries()]
      .map(([code, label]) => ({ code, label }))
      .sort((a, b) => collator.compare(a.code, b.code)),
  }
}

export async function loadFilterOptions(): Promise<FilterOptions> {
  const nodes: FilterNode[] = []
  let after: string | null = null

  for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
    // `after` est omis sur la première page plutôt qu'envoyé à `null` : voir
    // `listVariables` dans `app/deputes/page.tsx` pour la raison.
    const variables: Partial<FilterOptionsQueryVariables> = {
      first: SCAN_PAGE_SIZE,
      ...(after !== null && { after }),
    }
    const data: FilterOptionsQuery = await graphqlFetch<FilterOptionsQuery>(
      FILTER_OPTIONS_QUERY,
      variables,
    )
    for (const edge of data.deputies.edges) nodes.push(edge.node)
    if (!data.deputies.pageInfo.hasNextPage) break
    after = data.deputies.pageInfo.endCursor
    if (after === null) break
  }

  return collectFilterOptions(nodes)
}
