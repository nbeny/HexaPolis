import { open } from 'yauzl-promise'

export interface JsonEntry {
  name: string
  json: unknown
}

export async function* readJsonEntries(
  archivePath: string,
  prefix: string,
): AsyncGenerator<JsonEntry> {
  const zip = await open(archivePath)
  try {
    for await (const entry of zip) {
      if (!entry.filename.startsWith(prefix)) continue
      const stream = await entry.openReadStream()
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(chunk as Buffer)
      yield { name: entry.filename, json: JSON.parse(Buffer.concat(chunks).toString('utf-8')) }
    }
  } finally {
    await zip.close()
  }
}
