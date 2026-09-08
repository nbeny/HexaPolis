/**
 * Jumeau navigateur de `graphql-fetch.ts`.
 *
 * Deux différences, et deux seulement : l'URL vient de
 * `NEXT_PUBLIC_POLIGRAPH_API_URL` (le nom de service Docker du module serveur
 * n'est évidemment pas résoluble depuis un navigateur), et il n'y a pas
 * d'option `next.revalidate`, qui n'existe que côté serveur.
 *
 * Toute la valeur du module reste la même : GraphQL répond volontiers
 * `200 OK` avec `{ data: null, errors: [...] }`, et lire `body.data` sans
 * regarder `body.errors` transforme une panne en page vide.
 */
const ENDPOINT = process.env.NEXT_PUBLIC_POLIGRAPH_API_URL ?? 'http://127.0.0.1:30001/graphql'

interface GraphQLResponse<T> {
  data?: T | null
  errors?: { message: string; path?: (string | number)[] }[]
}

export class GraphqlError extends Error {}

export async function graphqlFetchClient<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new GraphqlError(
      `L'API PoliGraph a répondu ${response.status} (${ENDPOINT}) : ${await response.text()}`,
    )
  }

  const body = (await response.json()) as GraphQLResponse<T>

  if (body.errors?.length) {
    throw new GraphqlError(`Erreur GraphQL : ${body.errors.map((e) => e.message).join(' · ')}`)
  }

  if (body.data === undefined || body.data === null) {
    throw new GraphqlError(
      `Réponse GraphQL sans données ni erreurs — l'API est probablement mal configurée (${ENDPOINT}).`,
    )
  }

  return body.data
}
