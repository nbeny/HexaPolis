import { createReadStream } from 'node:fs'
import { parse } from 'csv-parse'

export type CsvEncoding = 'utf-8' | 'cp1252'

/**
 * Lit un CSV ligne à ligne. L'encodage est paramétrable parce que les sources
 * françaises ne s'accordent pas : le RNE publie en UTF-8, la CNCCFP en cp1252.
 * Lire l'un avec l'autre corrompt silencieusement les accents.
 */
export async function* readCsvRows(
  path: string,
  encoding: CsvEncoding,
  delimiter = ';',
): AsyncGenerator<Record<string, string>> {
  const stream = createReadStream(path).pipe(
    parse({ delimiter, columns: true, encoding: encoding === 'cp1252' ? 'latin1' : 'utf8' }),
  )
  for await (const row of stream) yield row as Record<string, string>
}
