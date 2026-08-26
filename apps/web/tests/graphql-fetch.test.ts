import { afterEach, describe, expect, it, vi } from 'vitest'
import { graphqlFetch } from '@/lib/graphql-fetch'

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('graphqlFetch', () => {
  it('rend `data` quand la réponse est saine', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { data: { deputy: { displayName: 'Untel' } } }))
    const data = await graphqlFetch<{ deputy: { displayName: string } }>('query { deputy }', {})
    expect(data.deputy.displayName).toBe('Untel')
  })

  it('lève quand la réponse porte des erreurs GraphQL, même en HTTP 200', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, { data: null, errors: [{ message: 'Depth limit exceeded' }] }),
    )
    await expect(graphqlFetch('query { deputy }', {})).rejects.toThrow(/Depth limit exceeded/)
  })

  it('lève quand le transport échoue', async () => {
    vi.stubGlobal('fetch', mockFetch(502, { message: 'Bad Gateway' }))
    await expect(graphqlFetch('query { deputy }', {})).rejects.toThrow(/502/)
  })

  it("lève quand la réponse ne porte ni données ni erreurs", async () => {
    vi.stubGlobal('fetch', mockFetch(200, {}))
    await expect(graphqlFetch('query { deputy }', {})).rejects.toThrow()
  })
})
