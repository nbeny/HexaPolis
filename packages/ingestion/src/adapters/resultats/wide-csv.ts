import type { CsvEncoding } from '../../csv.js'
import { readCsvRawRows } from '../../csv.js'

/** Colonnes fixes décrivant la circonscription, avant le premier bloc candidat. */
const FIXED_COLUMNS = 18

/**
 * Colonnes répétées par candidat, dans cet ordre : numéro de panneau,
 * nuance, nom, prénom, sexe, voix, % voix/inscrits, % voix/exprimés, élu.
 */
const BLOCK_SIZE = 9

export interface WideCandidate {
  /** Position du candidat dans la ligne (1-indexé) — c'est `rang` en bronze. */
  rang: number
  numeroPanneau: string
  nuance: string
  nom: string
  prenom: string
  sexe: string
  voix: string
  pctInscrits: string
  pctExprimes: string
  /** Non-vide en source → true. Vide → false. Jamais null : voir bronze `elu`. */
  elu: boolean
}

export interface WideResultRow {
  /** Numéro de ligne de données, 1-indexé — même convention que le RNE et la CNCCFP. */
  ligne: number
  /** Les 18 colonnes fixes décrivant la circonscription, telles quelles. */
  fixedColumns: string[]
  candidates: WideCandidate[]
}

/**
 * Déduit le nombre de blocs candidat à partir de la largeur de l'en-tête.
 * Jamais codé en dur (19 au 1er tour, 4 au 2nd) : un scrutin futur publiera
 * un nombre différent de candidats maximum. Une largeur qui ne se ramène pas
 * à 18 + un multiple de 9 lève une exception plutôt que de produire un
 * découpage tronqué en silence.
 */
export function countCandidateBlocks(columnCount: number): number {
  const blockColumns = columnCount - FIXED_COLUMNS
  if (blockColumns < 0 || blockColumns % BLOCK_SIZE !== 0) {
    throw new Error(
      `En-tête inattendu pour un fichier de résultats au format large : ` +
        `${columnCount} colonnes ne se ramènent pas à ${FIXED_COLUMNS} colonnes fixes ` +
        `plus un multiple de ${BLOCK_SIZE} colonnes par candidat.`,
    )
  }
  return blockColumns / BLOCK_SIZE
}

/**
 * Dépivote une ligne du format large : rend un enregistrement par bloc
 * candidat non vide.
 *
 * Le découpage est purement positionnel, jamais par nom de colonne. Les
 * fichiers réels numérotent chaque intitulé (« Voix 1 », « Voix 2 », …), ce
 * qui les rendrait lisibles par nom, mais rien ne garantit qu'un scrutin
 * futur reprenne exactement ces intitulés — l'ordre des 9 champs à
 * l'intérieur d'un bloc est le seul invariant que ce lecteur suppose.
 *
 * Un bloc dont le nom est vide n'est pas rendu : les colonnes sont remplies
 * jusqu'au nombre maximum de candidats du fichier, pas jusqu'au nombre réel
 * de candidats de cette circonscription.
 *
 * Une ligne plus courte que l'en-tête ne lève jamais : elle rend les blocs
 * complets qu'elle contient et s'arrête au premier bloc incomplet — les
 * blocs suivants, forcément plus courts encore, ne peuvent pas l'être moins.
 */
export function parseWideRow(header: readonly string[], row: readonly string[]): WideCandidate[] {
  const blocks = countCandidateBlocks(header.length)
  const candidates: WideCandidate[] = []

  for (let bloc = 0; bloc < blocks; bloc++) {
    const offset = FIXED_COLUMNS + bloc * BLOCK_SIZE
    if (offset + BLOCK_SIZE > row.length) break

    const nom = row[offset + 2] ?? ''
    if (nom.trim() === '') continue

    candidates.push({
      rang: bloc + 1,
      numeroPanneau: row[offset] ?? '',
      nuance: row[offset + 1] ?? '',
      nom,
      prenom: row[offset + 3] ?? '',
      sexe: row[offset + 4] ?? '',
      voix: row[offset + 5] ?? '',
      pctInscrits: row[offset + 6] ?? '',
      pctExprimes: row[offset + 7] ?? '',
      elu: (row[offset + 8] ?? '').trim() !== '',
    })
  }

  return candidates
}

/**
 * Lit un fichier de résultats au format large et rend une ligne dépivotée
 * par ligne source. La première ligne du fichier est l'en-tête : elle fixe
 * le nombre de blocs pour toutes les lignes suivantes, jamais recalculée à
 * chaque ligne.
 */
export async function* readWideCsvRows(
  path: string,
  encoding: CsvEncoding,
  delimiter = ';',
): AsyncGenerator<WideResultRow> {
  let header: string[] | undefined
  let ligne = 0

  for await (const row of readCsvRawRows(path, encoding, delimiter)) {
    if (!header) {
      header = row
      continue
    }
    ligne++
    yield {
      ligne,
      fixedColumns: row.slice(0, FIXED_COLUMNS),
      candidates: parseWideRow(header, row),
    }
  }
}
