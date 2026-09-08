import { GraphQLError } from 'graphql'

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

/**
 * Un curseur illisible ou une combinaison d'arguments impossible est une
 * requête malformée du client, pas une panne du serveur. Un `Error` nu sort
 * en `INTERNAL_SERVER_ERROR` et fait logger une pile par NestJS : deux
 * mensonges, l'un au client, l'autre à l'exploitant.
 *
 * `GraphQLError` n'entame pas l'indépendance de ce module vis-à-vis de Nest
 * et de Prisma — `graphql` est une dépendance directe, ce fichier vit dans
 * la couche GraphQL, et c'est une simple sous-classe d'`Error`, levable et
 * testable sans démarrer d'application. Même choix qu'en `complexity.ts`,
 * qui émet `QUERY_TOO_COMPLEX` de cette façon.
 */
function invalidInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } })
}

export function encodeCursor(offset: number): string {
  return Buffer.from(`${CURSOR_PREFIX}${offset}`, 'utf8').toString('base64')
}

export function decodeCursor(cursor: string): number {
  // `Buffer.from(x, 'base64')` ne lève jamais : Node ignore silencieusement
  // les caractères hors alphabet base64 plutôt que de rejeter l'entrée. La
  // validation ne peut donc se faire qu'a posteriori, sur le texte obtenu.
  const decoded = Buffer.from(cursor, 'base64').toString('utf8')
  if (!decoded.startsWith(CURSOR_PREFIX)) {
    throw invalidInput(`Curseur invalide : ${cursor.slice(0, 32)}`)
  }
  const offset = Number(decoded.slice(CURSOR_PREFIX.length))
  if (!Number.isInteger(offset) || offset < 0) {
    throw invalidInput(`Curseur invalide : ${cursor.slice(0, 32)}`)
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
 * `pageSize` est la taille de page **effective**, déjà passée par
 * `clampPageSize` — jamais la valeur brute de `first`. `before` est borné à
 * zéro : ça ne rattrape pas un curseur négatif (`decodeCursor` le rejette
 * avant d'arriver ici), mais le cas courant d'un curseur valide dont
 * l'offset est plus petit que `pageSize` — ce qui arrive dès qu'un client
 * change de taille de page en cours de pagination.
 */
export function resolveOffset({
  after,
  before,
  pageSize,
}: {
  after: string | null | undefined
  before: string | null | undefined
  pageSize: number
}): number {
  if (after != null && before != null) {
    throw invalidInput(
      'Les curseurs `after` et `before` ne peuvent pas être fournis ensemble : la page demandée serait ambiguë.',
    )
  }
  if (after != null) return decodeCursor(after)
  if (before != null) return Math.max(0, decodeCursor(before) - pageSize)
  return 0
}
