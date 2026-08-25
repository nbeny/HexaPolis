import { Field, Int, ObjectType } from '@nestjs/graphql'
import type { Type } from '@nestjs/common'

@ObjectType()
export class PageInfo {
  @Field()
  hasNextPage!: boolean

  @Field({ nullable: true })
  endCursor?: string
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
