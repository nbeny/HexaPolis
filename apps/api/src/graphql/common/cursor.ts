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

/**
 * Traduit une demande de page en offset de départ.
 *
 * Il n'y a délibérément pas d'argument `last` en pendant de `first` : sur des
 * curseurs-offsets, reculer d'une page se calcule à partir de la taille de
 * page déjà demandée. Ajouter `last` doublerait les chemins à tester sans
 * rien exprimer de plus.
 *
 * `before` est borné à zéro. Un curseur forgé pointant avant le début ne rend
 * donc jamais de page vide : il rend la première page, ce qui est la réponse
 * honnête à « la page qui précède le début ».
 */
export function resolveOffset(
  after: string | null | undefined,
  before: string | null | undefined,
  pageSize: number,
): number {
  if (after != null && before != null) {
    throw new Error(
      'Les curseurs `after` et `before` ne peuvent pas être fournis ensemble : la page demandée serait ambiguë.',
    )
  }
  if (after != null) return decodeCursor(after)
  if (before != null) return Math.max(0, decodeCursor(before) - pageSize)
  return 0
}
