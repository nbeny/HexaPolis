import { open } from 'yauzl-promise'
import { asArray } from '@poligraph/domain'

export interface ScrutinEntry {
  /** Entrée d'archive dont provient le scrutin : c'est la référence conservée en bronze. */
  entryName: string
  scrutin: Record<string, unknown>
}

/**
 * Rend les scrutins d'une archive, quel que soit son conditionnement.
 * La 14e législature publie un unique fichier contenant tous les scrutins ;
 * les 15e, 16e et 17e publient un fichier par scrutin.
 */
export async function* readScrutins(archivePath: string): AsyncGenerator<ScrutinEntry> {
  const zip = await open(archivePath)
  try {
    for await (const entry of zip) {
      if (!entry.filename.endsWith('.json')) continue

      const stream = await entry.openReadStream()
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(chunk)
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>

      const monolithe = (parsed as { scrutins?: { scrutin?: unknown } }).scrutins?.scrutin
      if (monolithe !== undefined) {
        for (const scrutin of asArray(monolithe)) {
          yield { entryName: entry.filename, scrutin: scrutin as Record<string, unknown> }
        }
        continue
      }

      const unique = (parsed as { scrutin?: unknown }).scrutin
      if (unique !== undefined) {
        yield { entryName: entry.filename, scrutin: unique as Record<string, unknown> }
      }
    }
  } finally {
    await zip.close()
  }
}
