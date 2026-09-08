import { Catch, type ExceptionFilter } from '@nestjs/common'
import { GraphQLError } from 'graphql'

/**
 * `ExternalExceptionFilter` de NestJS logge toute `Error` qui n'est pas une
 * `IntrinsicException` — pile comprise. Une `GraphQLError` portant un code
 * comme `BAD_USER_INPUT` décrit une requête malformée : Apollo la rendra
 * telle quelle au client, et l'exploitant n'a rien à en faire. Ce filtre la
 * relaie intacte sans l'écrire dans les logs d'erreur ; toute autre
 * exception continue d'être loggée normalement.
 *
 * Le filtre porte sur la classe, pas sur le code : toute `GraphQLError`
 * levée depuis un résolveur racine échappe désormais au log. C'est
 * volontaire — une `GraphQLError` explicite est un refus délibéré, pas une
 * panne — mais une panne serveur doit donc être levée en `Error` nu ou en
 * exception Nest, jamais en `GraphQLError`.
 *
 * Portée réelle, vérifiée empiriquement (voir la tâche qui a introduit ce
 * fichier) : NestJS n'applique les filtres (globaux ou non) aux résolveurs
 * de champ (`@ResolveField`, ex. `Deputy.ballotPositions`) que si
 * `fieldResolverEnhancers` liste `'filters'` dans la config `GraphQLModule` —
 * ce que ce dépôt ne fait pas. Ce filtre agit donc sur les requêtes racine
 * (`Query.deputies`), là où la pile était bien loggée avant lui ; les
 * résolveurs de champ ne passaient déjà par aucun filtre, donc aucune pile
 * n'y était loggée avant ce fichier — il y est simplement sans effet.
 */
@Catch(GraphQLError)
export class GraphqlErrorFilter implements ExceptionFilter {
  catch(exception: GraphQLError): never {
    throw exception
  }
}
