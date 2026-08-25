import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AssembleeNationaleClient } from '../src/http/an-client.js'
import type { ResourceDescriptor } from '../src/contract.js'

let server: Server
let baseUrl: string
let cacheDir: string
let hits = 0

beforeAll(async () => {
  hits = 0
  server = createServer((_req, res) => {
    hits++
    res.writeHead(200, { 'content-type': 'application/zip' })
    res.end(Buffer.from('contenu-de-test'))
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('adresse invalide')
  baseUrl = `http://127.0.0.1:${address.port}`
  cacheDir = await mkdtemp(join(tmpdir(), 'poligraph-'))
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(cacheDir, { recursive: true, force: true })
})

function descriptor(): ResourceDescriptor {
  return {
    sourceKey: 'AN',
    datasetExternalId: 'amo10-17',
    datasetTitle: 'Députés actifs, mandats et organes',
    resourceExternalId: 'AMO10.json.zip',
    url: `${baseUrl}/AMO10.json.zip`,
    format: 'zip',
  }
}

describe('AssembleeNationaleClient', () => {
  it('télécharge et calcule un checksum sha256 stable', async () => {
    const client = new AssembleeNationaleClient(cacheDir)
    const file = await client.fetch(descriptor())
    expect(file.checksum).toHaveLength(64)
    expect(file.bytes).toBe(15)
  })

  it('ne retélécharge pas un fichier déjà en cache', async () => {
    const client = new AssembleeNationaleClient(cacheDir)
    const before = hits
    await client.fetch(descriptor())
    expect(hits).toBe(before)
  })

  it('remonte une erreur explicite sur une réponse HTTP en échec', async () => {
    const failing = createServer((_req, res) => {
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => failing.listen(0, resolve))
    const address = failing.address()
    if (typeof address === 'string' || address === null) throw new Error('adresse invalide')

    const emptyCache = await mkdtemp(join(tmpdir(), 'poligraph-'))
    const client = new AssembleeNationaleClient(emptyCache)
    const target = { ...descriptor(), url: `http://127.0.0.1:${address.port}/absent.zip` }

    await expect(client.fetch(target)).rejects.toThrow(/404/)

    await new Promise<void>((resolve) => failing.close(() => resolve()))
    await rm(emptyCache, { recursive: true, force: true })
  })
})
