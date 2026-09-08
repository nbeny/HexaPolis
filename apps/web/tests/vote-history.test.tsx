import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoteHistory } from '@/components/vote-history'

/**
 * `VoteHistory` est le premier composant client du projet : c'est lui qui
 * porte tout le risque nouveau (chargement, erreurs réseau, pagination par
 * curseurs opaques). Ces tests couvrent les trois états, le round-trip
 * `after`/`before`, la garantie « jamais les deux ensemble », et le délai qui
 * empêche « Chargement… » de devenir un état terminal.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 })
}

/** Extrait les `variables` GraphQL envoyées par un appel `fetch` capturé par un mock. */
function variablesOf(call: unknown[] | undefined): Record<string, unknown> {
  if (!call) {
    throw new Error(
      "Aucun appel fetch à cet index — l'hypothèse du test sur le nombre d'appels est fausse.",
    )
  }
  const init = call[1] as RequestInit
  return JSON.parse(init.body as string).variables
}

function ballotNode(id: string, title: string) {
  return {
    id,
    ballotDate: '2024-10-15',
    ballotTitle: title,
    ballotNumber: '1',
    legislatureNumber: 17,
    position: 'POUR',
    byDelegation: false,
    groupShortLabelAtVote: null,
    publicationMode: 'DecompteNominatif',
  }
}

function connectionResponse(opts: {
  edges: { id: string; title: string }[]
  totalCount: number
  startCursor: string | null
  endCursor: string | null
  hasNextPage: boolean
  hasPreviousPage: boolean
}) {
  return {
    data: {
      deputy: {
        ballotPositions: {
          totalCount: opts.totalCount,
          pageInfo: {
            startCursor: opts.startCursor,
            endCursor: opts.endCursor,
            hasNextPage: opts.hasNextPage,
            hasPreviousPage: opts.hasPreviousPage,
          },
          edges: opts.edges.map((e) => ({ node: ballotNode(e.id, e.title) })),
        },
      },
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('VoteHistory', () => {
  it('affiche le chargement puis la liste quand l’API répond', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          connectionResponse({
            edges: [{ id: 'v1', title: 'Scrutin unique' }],
            totalCount: 1,
            startCursor: 'S0',
            endCursor: 'E0',
            hasNextPage: false,
            hasPreviousPage: false,
          }),
        ),
      ),
    )

    render(<VoteHistory slug="pa000001-test" />)
    expect(screen.getByText('Chargement des positions de vote…')).toBeInTheDocument()

    await screen.findByText('Scrutin unique')
    expect(screen.getByText(/1-1 sur 1/)).toBeInTheDocument()
  })

  it("passe en état « introuvable » explicite quand l'API ne renvoie aucun député, au lieu de rester en chargement indéfiniment", async () => {
    // Réponse réelle observée en pointant l'API avec un mauvais slug :
    // `{ data: { deputy: null } }`. `graphqlFetchClient` ne lève pas dans ce
    // cas (`data` n'est ni `undefined` ni `null`) — c'est à `VoteHistory` de
    // reconnaître l'absence de député.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: { deputy: null } })))

    render(<VoteHistory slug="pa000002-test" />)
    await screen.findByText(/n'a pas pu être retrouvé/)
    expect(screen.queryByText('Chargement des positions de vote…')).not.toBeInTheDocument()
  })

  it("affiche une erreur avec un moyen d'y revenir quand une page intermédiaire échoue, plutôt qu'un cul-de-sac", async () => {
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          connectionResponse({
            edges: [{ id: 'v1', title: 'Scrutin page 1' }],
            totalCount: 30,
            startCursor: 'S0',
            endCursor: 'E0',
            hasNextPage: true,
            hasPreviousPage: false,
          }),
        ),
      )
      .mockRejectedValueOnce(new Error('502 Bad Gateway'))
    vi.stubGlobal('fetch', fetchMock)

    render(<VoteHistory slug="pa000003-test" />)
    await screen.findByText('Scrutin page 1')

    fireEvent.click(screen.getByText('Suivant →'))

    await screen.findByText(/n'ont pas pu être chargées/)
    expect(screen.getByText('Réessayer')).toBeInTheDocument()
    expect(screen.getByText('← Revenir à la page précédente')).toBeInTheDocument()
  })

  it("ne propose pas de retour en arrière quand la toute première page échoue — il n'y a nulle part où revenir", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('panne réseau')
      }),
    )

    render(<VoteHistory slug="pa000004-test" />)
    await screen.findByText(/n'ont pas pu être chargées/)
    expect(screen.getByText('Réessayer')).toBeInTheDocument()
    expect(screen.queryByText('← Revenir à la page précédente')).not.toBeInTheDocument()
  })

  it('parcourt en avant avec `after`, en arrière avec `before`, et ne les envoie jamais ensemble', async () => {
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          connectionResponse({
            edges: [{ id: 'v1', title: 'Scrutin page 1' }],
            totalCount: 2,
            startCursor: 'S0',
            endCursor: 'E0',
            hasNextPage: true,
            hasPreviousPage: false,
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          connectionResponse({
            edges: [{ id: 'v2', title: 'Scrutin page 2' }],
            totalCount: 2,
            startCursor: 'S1',
            endCursor: 'E1',
            hasNextPage: false,
            hasPreviousPage: true,
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          connectionResponse({
            edges: [{ id: 'v1', title: 'Scrutin page 1' }],
            totalCount: 2,
            startCursor: 'S0',
            endCursor: 'E0',
            hasNextPage: true,
            hasPreviousPage: false,
          }),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    render(<VoteHistory slug="pa000005-test" />)
    await screen.findByText('Scrutin page 1')

    const firstVars = variablesOf(fetchMock.mock.calls[0])
    expect(firstVars.after).toBeUndefined()
    expect(firstVars.before).toBeUndefined()

    fireEvent.click(screen.getByText('Suivant →'))
    await screen.findByText('Scrutin page 2')

    const secondVars = variablesOf(fetchMock.mock.calls[1])
    expect(secondVars.after).toBe('E0')
    expect(secondVars.before).toBeUndefined()

    fireEvent.click(screen.getByText('← Précédent'))
    await screen.findByText('Scrutin page 1')

    const thirdVars = variablesOf(fetchMock.mock.calls[2])
    expect(thirdVars.before).toBe('S1')
    expect(thirdVars.after).toBeUndefined()

    // Sur les trois appels, aucun ne porte jamais les deux curseurs ensemble
    // — l'API les rejette en `BAD_USER_INPUT` quand elle les reçoit ainsi.
    for (const call of fetchMock.mock.calls) {
      const vars = variablesOf(call)
      expect(vars.after && vars.before).toBeFalsy()
    }
  })

  it('bascule en erreur après 15 secondes sans réponse, plutôt que de rester bloqué sur « Chargement… »', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})), // ne se résout jamais
    )

    render(<VoteHistory slug="pa000006-test" />)
    expect(screen.getByText('Chargement des positions de vote…')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(screen.getByText(/dépasse 15 secondes/)).toBeInTheDocument()
  })
})
