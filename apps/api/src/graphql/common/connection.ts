import { Field, Int, ObjectType } from '@nestjs/graphql'
import type { Type } from '@nestjs/common'
import { encodeCursor } from './cursor.js'

@ObjectType()
export class PageInfo {
  /** Position AVANT le premier élément de la page. Symétrique de `endCursor`. */
  @Field({ nullable: true })
  startCursor?: string

  @Field({ nullable: true })
  endCursor?: string

  @Field()
  hasNextPage!: boolean

  @Field()
  hasPreviousPage!: boolean
}

export interface Edge<T> {
  cursor: string
  node: T
}

export interface Connection<T> {
  edges: Edge<T>[]
  pageInfo: PageInfo
  totalCount: number
}

/**
 * Fabrique la connexion Relay d'une page déjà lue.
 *
 * Ce calcul était recopié à l'identique dans les deux résolveurs paginés de
 * `deputy.resolver.ts`. Le centraliser n'est pas une coquetterie : c'est la
 * seule façon d'avoir la garantie que `deputies` et `ballotPositions`
 * répondent la même chose sur les bornes, aujourd'hui et après le prochain
 * champ ajouté à `PageInfo`.
 *
 * Le curseur d'une arête vaut `offset + index + 1`, c'est-à-dire la position
 * APRÈS l'élément — d'où `startCursor = encodeCursor(offset)`, qui désigne la
 * position avant le premier, et l'égalité `startCursor(page n+1) ===
 * endCursor(page n)`.
 */
export function buildConnection<TRow, TNode>(
  rows: readonly TRow[],
  offset: number,
  totalCount: number,
  toNode: (row: TRow) => TNode,
): Connection<TNode> {
  const edges = rows.map((row, index) => ({
    cursor: encodeCursor(offset + index + 1),
    node: toNode(row),
  }))

  return {
    edges,
    pageInfo: {
      startCursor: encodeCursor(offset),
      endCursor: edges.at(-1)?.cursor,
      hasNextPage: offset + rows.length < totalCount,
      hasPreviousPage: offset > 0,
    },
    totalCount,
  }
}

/**
 * Nest GraphQL (code-first) ne traduit pas les génériques TypeScript en SDL :
 * chaque connexion Relay a besoin de sa propre classe concrète. Cette
 * fabrique évite de dupliquer `Edge`/`Connection`/`PageInfo` pour chaque type
 * paginé (`DeputyConnection`, `BallotPositionConnection`) — pattern
 * documenté par NestJS lui-même pour ce cas exact.
 */
export function createConnectionType<T>(nodeType: Type<T>, typeName: string) {
  @ObjectType(`${typeName}Edge`)
  class EdgeType implements Edge<T> {
    @Field(() => String)
    cursor!: string

    @Field(() => nodeType)
    node!: T
  }

  @ObjectType(`${typeName}Connection`)
  class ConnectionType implements Connection<T> {
    @Field(() => [EdgeType])
    edges!: EdgeType[]

    @Field(() => PageInfo)
    pageInfo!: PageInfo

    @Field(() => Int)
    totalCount!: number
  }

  return ConnectionType
}
