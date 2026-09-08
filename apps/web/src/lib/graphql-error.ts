/**
 * Erreur commune aux deux clients GraphQL du projet : `graphql-fetch.ts`
 * (serveur) et `graphql-fetch-client.ts` (navigateur). Partagée pour une
 * seule raison — un `instanceof GraphqlError` importé d'un module doit
 * reconnaître l'erreur levée par l'autre. Les deux clients eux-mêmes restent
 * distincts et ne doivent pas être fusionnés : leurs runtimes divergent
 * réellement (URL, présence de `next.revalidate`), voir l'en-tête de chacun.
 */
export class GraphqlError extends Error {}
