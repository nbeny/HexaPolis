import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SourceFileClient } from '../src/http/source-file-client.js'
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

describe('SourceFileClient', () => {
  it('télécharge et calcule un checksum sha256 stable', async () => {
    const client = new SourceFileClient(cacheDir)
    const file = await client.fetch(descriptor())
    expect(file.checksum).toHaveLength(64)
    expect(file.bytes).toBe(15)
  })

  it('ne retélécharge pas un fichier déjà en cache', async () => {
    const client = new SourceFileClient(cacheDir)
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
    const client = new SourceFileClient(emptyCache)
    const target = { ...descriptor(), url: `http://127.0.0.1:${address.port}/absent.zip` }

    await expect(client.fetch(target)).rejects.toThrow(/404/)

    await new Promise<void>((resolve) => failing.close(() => resolve()))
    await rm(emptyCache, { recursive: true, force: true })
  })

  it('retourne le même checksum et la même taille sur un hit de cache', async () => {
    const hitServer = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/zip' })
      res.end(Buffer.from('contenu-de-test'))
    })
    await new Promise<void>((resolve) => hitServer.listen(0, resolve))
    const address = hitServer.address()
    if (typeof address === 'string' || address === null) throw new Error('adresse invalide')

    const hitCache = await mkdtemp(join(tmpdir(), 'poligraph-'))
    const client = new SourceFileClient(hitCache)
    const target = { ...descriptor(), url: `http://127.0.0.1:${address.port}/AMO10.json.zip` }

    const first = await client.fetch(target)
    const second = await client.fetch(target)

    expect(second.checksum).toBe(first.checksum)
    expect(second.bytes).toBe(first.bytes)

    await new Promise<void>((resolve) => hitServer.close(() => resolve()))
    await rm(hitCache, { recursive: true, force: true })
  })

  it('rejette un fichier de cache corrompu et retélécharge', async () => {
    let corruptHits = 0
    const corruptServer = createServer((_req, res) => {
      corruptHits++
      res.writeHead(200, { 'content-type': 'application/zip' })
      res.end(Buffer.from('contenu-de-test'))
    })
    await new Promise<void>((resolve) => corruptServer.listen(0, resolve))
    const address = corruptServer.address()
    if (typeof address === 'string' || address === null) throw new Error('adresse invalide')

    const corruptCache = await mkdtemp(join(tmpdir(), 'poligraph-'))
    const client = new SourceFileClient(corruptCache)
    const target = { ...descriptor(), url: `http://127.0.0.1:${address.port}/AMO10.json.zip` }

    const first = await client.fetch(target)
    expect(corruptHits).toBe(1)

    const binPath = join(corruptCache, `${first.checksum}.bin`)
    await writeFile(binPath, Buffer.from('donnees-corrompues'))

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const second = await client.fetch(target)

    expect(corruptHits).toBe(2)
    expect(second.checksum).toBe(first.checksum)
    expect(second.bytes).toBe(first.bytes)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()

    await new Promise<void>((resolve) => corruptServer.close(() => resolve()))
    await rm(corruptCache, { recursive: true, force: true })
  })
})
