import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FetchedFile, ResourceDescriptor } from '../contract.js'

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
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
    try {
      const checksum = (await readFile(pointer, 'utf-8')).trim()
      const localPath = join(this.cacheDir, `${checksum}.bin`)
      const info = await stat(localPath)
      return { localPath, checksum, bytes: info.size }
    } catch {
      return null
    }
  }
}
