import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphqlError, graphqlFetchClient } from '@/lib/graphql-fetch-client'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

describe('graphqlFetchClient', () => {
  it('rend les données quand la réponse est saine', async () => {
    stubFetch(200, { data: { ok: true } })
    await expect(graphqlFetchClient('{ ok }', {})).resolves.toEqual({ ok: true })
  })

  it('lève sur `errors`, même avec un statut 200 — c’est le défaut de GraphQL', async () => {
    stubFetch(200, { data: null, errors: [{ message: 'Curseur invalide' }] })
    await expect(graphqlFetchClient('{ ok }', {})).rejects.toThrow(GraphqlError)
  })

  it('lève sur un statut HTTP en échec', async () => {
    stubFetch(500, {})
    await expect(graphqlFetchClient('{ ok }', {})).rejects.toThrow(GraphqlError)
  })

  it('lève quand la réponse ne porte ni données ni erreurs', async () => {
    stubFetch(200, {})
    await expect(graphqlFetchClient('{ ok }', {})).rejects.toThrow(/mal configurée/)
  })
})
