import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FetchedFile, ResourceDescriptor } from '../contract.js'

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

export class AssembleeNationaleClient {
  constructor(private readonly cacheDir: string) {}

  async fetch(descriptor: ResourceDescriptor): Promise<FetchedFile> {
    await mkdir(this.cacheDir, { recursive: true })
    const pointer = join(this.cacheDir, `${descriptor.resourceExternalId}.checksum`)

    const cached = await this.readCached(pointer)
    if (cached) return { descriptor, ...cached }

    const response = await fetch(descriptor.url)
    if (!response.ok) {
      throw new Error(`Téléchargement échoué (${response.status}) : ${descriptor.url}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    const checksum = sha256(buffer)
    const localPath = join(this.cacheDir, `${checksum}.bin`)

    await writeFile(localPath, buffer)
    await writeFile(pointer, checksum, 'utf-8')

    return { descriptor, localPath, checksum, bytes: buffer.byteLength }
  }

  private async readCached(
    pointer: string,
  ): Promise<{ localPath: string; checksum: string; bytes: number } | null> {
    let recordedChecksum: string
    try {
      recordedChecksum = (await readFile(pointer, 'utf-8')).trim()
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }

    const localPath = join(this.cacheDir, `${recordedChecksum}.bin`)
    let buffer: Buffer
    try {
      buffer = await readFile(localPath)
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }

    const actualChecksum = sha256(buffer)
    if (actualChecksum !== recordedChecksum) {
      console.warn(
        `Fichier de cache rejeté : l'empreinte de ${localPath} ne correspond plus au checksum enregistré (${recordedChecksum}).`,
      )
      return null
    }

    return { localPath, checksum: actualChecksum, bytes: buffer.byteLength }
  }
}
