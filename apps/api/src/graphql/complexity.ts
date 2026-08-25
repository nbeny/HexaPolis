import depthLimit from 'graphql-depth-limit'
import { getComplexity, simpleEstimator } from 'graphql-query-complexity'
import { GraphQLError, type ValidationRule } from 'graphql'

/**
 * Garde-fous requis par la spec §8.4 : une API GraphQL publique sans limite
 * de profondeur ni de complexité est exposée au déni de service par requête
 * imbriquée. Le troisième garde-fou, le rate limiting, vit dans
 * `GqlThrottlerGuard` — une préoccupation par requête HTTP, pas par requête
 * GraphQL.
 */
export function buildDepthLimitRule(maxDepth: number): ValidationRule[] {
  return [depthLimit(maxDepth)]
}

/**
 * `graphql-query-complexity` en `validationRules` statique (comme
 * `graphql-depth-limit`) échoue sur toute requête portant des variables
 * requises : la validation GraphQL n'a normalement pas accès aux valeurs de
 * variables (elles ne sont coercées qu'à l'exécution), et cette librairie
 * retombe alors sur un objet vide pour les calculer — `getOperationVariableValues`
 * rejette alors la requête avec `Variable "$x" of required type … was not
 * provided`, même quand le client l'a bien fournie. Constaté en écrivant le
 * test d'intégration du garde-fou : toute fiche interrogée par variable
 * (`deputy(slug: $slug)`) échouait, y compris avec `$slug` fourni.
 *
 * Le contournement documenté est le pattern plugin d'Apollo Server :
 * `didResolveOperation` reçoit les variables réellement coercées de la
 * requête (`requestContext.request.variables`), qu'on passe explicitement à
 * `getComplexity`.
 */
// Pas de type de retour explicite : `@apollo/server` publie des déclarations
// de types distinctes pour ses conditions d'export `import`/`require`, et
// `@nestjs/apollo` en résout une copie différente de celle importée
// directement ici sous `moduleResolution: NodeNext` — deux nominaux nommés
// pareil mais incompatibles (« dual package hazard »). L'objet retourné
// reste structurellement un `ApolloServerPlugin` ; ne pas l'annoter évite
// une erreur de type sur une simple incompatibilité de résolution de module.
export function buildComplexityPlugin(maxComplexity: number) {
  return {
    async requestDidStart() {
      return {
        async didResolveOperation({
          schema,
          document,
          request,
          operationName,
        }: {
          schema: import('graphql').GraphQLSchema
          document: import('graphql').DocumentNode
          request: { variables?: Record<string, unknown> | null }
          operationName?: string | null
        }) {
          const complexity = getComplexity({
            schema,
            query: document,
            variables: request.variables ?? {},
            operationName: operationName ?? undefined,
            estimators: [simpleEstimator({ defaultComplexity: 1 })],
          })
          if (complexity > maxComplexity) {
            throw new GraphQLError(
              `La requête dépasse la limite de complexité (${complexity} > ${maxComplexity}).`,
              { extensions: { code: 'QUERY_TOO_COMPLEX' } },
            )
          }
        },
      }
    },
  }
}
