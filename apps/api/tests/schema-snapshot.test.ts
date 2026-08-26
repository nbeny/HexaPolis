import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Test } from '@nestjs/testing'
import { GRAPHQL_SDL_FILE_HEADER, GraphQLSchemaHost } from '@nestjs/graphql'
import { lexicographicSortSchema, printSchema } from 'graphql'
import { describe, expect, it } from 'vitest'
import { ServerModule } from '../src/server.module.js'
import { PRISMA_CLIENT } from '../src/graphql/prisma.provider.js'

const SCHEMA_PATH = fileURLToPath(new URL('../schema.gql', import.meta.url))

describe('schema.gql', () => {
  it('est à jour vis-à-vis des résolveurs', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ServerModule.forRoot()] })
      .overrideProvider(PRISMA_CLIENT)
      .useValue({})
      .compile()
    const app = moduleRef.createNestApplication()
    await app.init()

    const { schema } = app.get(GraphQLSchemaHost)
    const committed = await readFile(SCHEMA_PATH, 'utf-8')

    // `GraphQLSchemaBuilder` (le code interne de Nest qui écrit
    // `autoSchemaFile` sur disque) préfixe systématiquement le SDL par
    // `GRAPHQL_SDL_FILE_HEADER` et trie le schéma avant de l'imprimer
    // (`sortSchema: true`) — le schéma renvoyé par `GraphQLSchemaHost`, lui,
    // n'a ni l'un ni l'autre. On reproduit exactement les deux étapes ici
    // pour comparer ce que Nest écrit réellement, pas juste le SDL brut.
    //
    // Comparaison insensible aux fins de ligne : le dépôt est cloné sous
    // Windows comme sous Linux, et git peut réécrire les CRLF.
    const generated = GRAPHQL_SDL_FILE_HEADER + printSchema(lexicographicSortSchema(schema))
    expect(generated.replace(/\r\n/g, '\n').trim()).toBe(
      committed.replace(/\r\n/g, '\n').trim(),
    )

    await app.close()
  })
})
