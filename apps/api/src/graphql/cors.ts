/**
 * Origines autorisées à interroger l'API depuis un navigateur.
 *
 * Jusqu'ici l'API n'était jointe que par le réseau interne, par le serveur
 * Next. La carte et l'historique de vote paginé l'appellent depuis le
 * navigateur : il faut donc du CORS, et une liste explicite plutôt qu'un
 * joker. Une API publique en lecture n'a pas besoin d'être appelable depuis
 * n'importe quelle page du web, et `*` interdit de toute façon d'envoyer un
 * jour des cookies.
 *
 * Le défaut est la liste vide — aucune origine — plutôt qu'une valeur
 * permissive : une variable oubliée en production doit casser la carte, pas
 * ouvrir l'API.
 */
export function corsOrigins(env: Record<string, string | undefined>): string[] {
  const raw = env.CORS_ALLOWED_ORIGINS
  if (raw === undefined) return []
  if (raw.includes('*')) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS ne peut pas contenir de joker : lister les origines une par une.',
    )
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '')
}
