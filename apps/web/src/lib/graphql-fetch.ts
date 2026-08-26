/**
 * Client GraphQL minimal, destiné aux Server Components uniquement.
 *
 * Il n'y a délibérément pas de client GraphQL complet ici : les pages sont
 * rendues sur le serveur et ne re-requêtent jamais depuis le navigateur, donc
 * ni cache normalisé ni gestion d'état ne servent à quelque chose.
 *
 * Toute la valeur du module tient dans la gestion d'erreur. GraphQL répond
 * volontiers `200 OK` avec un corps `{ data: null, errors: [...] }` : lire
 * `body.data` sans regarder `body.errors` transforme une panne en page vide,
 * ce qui est exactement le défaut que ce projet ne peut pas se permettre.
 */

const ENDPOINT = process.env.POLIGRAPH_API_URL ?? 'http://127.0.0.1:4000/graphql'

interface GraphQLResponse<T> {
  data?: T | null
  errors?: { message: string; path?: (string | number)[] }[]
}

export interface GraphqlFetchOptions {
  /** Durée de validité du cache Next, en secondes. `0` désactive le cache. */
  revalidate?: number
}

export class GraphqlError extends Error {}

export async function graphqlFetch<T>(
  query: string,
  variables: Record<string, unknown>,
  options: GraphqlFetchOptions = {},
): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: options.revalidate ?? 300 },
  })

  if (!response.ok) {
    throw new GraphqlError(
      `L'API PoliGraph a répondu ${response.status} (${ENDPOINT}) : ${await response.text()}`,
    )
  }

  const body = (await response.json()) as GraphQLResponse<T>

  if (body.errors?.length) {
    throw new GraphqlError(
      `Erreur GraphQL : ${body.errors.map((e) => e.message).join(' · ')}`,
    )
  }

  if (body.data === undefined || body.data === null) {
    throw new GraphqlError(
      `Réponse GraphQL sans données ni erreurs — l'API est probablement mal configurée (${ENDPOINT}).`,
    )
  }

  return body.data
}
