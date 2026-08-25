/**
 * Curseurs de pagination Relay, encodés en base64 autour d'un simple offset.
 *
 * Un vrai curseur Relay encode en général une position stable indépendante
 * du tri (ex. l'identifiant du dernier élément vu). Ici, `gold.deputy_vote`
 * est toujours parcouru dans un ordre total et stable (date de scrutin
 * décroissante, puis identifiant de position croissant en départage), si
 * bien qu'un offset numérique suffit et reste correct tant que la vue n'est
 * pas rafraîchie pendant la pagination d'une même requête cliente — un
 * compromis délibéré pour éviter une clé de curseur composite pour la V1.
 */
const CURSOR_PREFIX = 'offset:'

export function encodeCursor(offset: number): string {
  return Buffer.from(`${CURSOR_PREFIX}${offset}`, 'utf8').toString('base64')
}

export function decodeCursor(cursor: string): number {
  let decoded: string
  try {
    decoded = Buffer.from(cursor, 'base64').toString('utf8')
  } catch {
    throw new Error(`Curseur invalide : ${cursor}`)
  }
  if (!decoded.startsWith(CURSOR_PREFIX)) {
    throw new Error(`Curseur invalide : ${cursor}`)
  }
  const offset = Number(decoded.slice(CURSOR_PREFIX.length))
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`Curseur invalide : ${cursor}`)
  }
  return offset
}
