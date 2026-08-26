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

/**
 * Lit un CSV en conservant l'ordre brut des colonnes : chaque ligne rendue
 * est un tableau positionnel, en-tête compris (c'est la toute première
 * ligne rendue — au consommateur de la séparer des lignes de données).
 *
 * Existe à côté de `readCsvRows` pour le format large des résultats
 * électoraux (plan 5), qui ne convient pas à `readCsvRows` sur deux points :
 * ses en-têtes répétés par bloc candidat (« Voix 1 », « Voix 2 », …) sont
 * bien uniques donc lisibles par nom, mais le dépivotage doit rester
 * positionnel pour survivre à un intitulé de colonne qui change d'un
 * scrutin à l'autre ; et `columns: true` lève par défaut dès qu'une ligne a
 * moins de champs que l'en-tête (`Invalid Record Length`), alors qu'une
 * ligne tronquée doit être lue partiellement, jamais rejetée en bloc.
 */
export async function* readCsvRawRows(
  path: string,
  encoding: CsvEncoding,
  delimiter = ';',
): AsyncGenerator<string[]> {
  const stream = createReadStream(path).pipe(
    parse({
      delimiter,
      columns: false,
      relax_column_count: true,
      encoding: encoding === 'cp1252' ? 'latin1' : 'utf8',
    }),
  )
  for await (const row of stream) yield row as string[]
}
