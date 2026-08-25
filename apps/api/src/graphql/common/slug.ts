/**
 * Le slug d'un député est bâti sur son identifiant AN (`pa721234-xavier-breton`),
 * jamais sur le seul nom : quatre paires d'homonymes existent dans les
 * données réelles (ex. deux Jean Besson, deux Béatrice Descamps), et un slug
 * purement nominal en écraserait un. Le préfixe (avant le premier `-`) est le
 * seul segment interprété ; le reste n'est que du confort d'URL.
 */
const DIACRITICS = /\p{Diacritic}/gu

function slugifyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildDeputySlug(anId: string, displayName: string): string {
  return `${anId.toLowerCase()}-${slugifyName(displayName)}`
}

/**
 * Extrait le préfixe d'identifiant AN d'un slug. Ne valide pas le reste du
 * slug : `pa721234-n-importe-quoi` résout le même député que
 * `pa721234-xavier-breton`, exactement comme le préfixe seul le ferait.
 */
export function anIdFromSlug(slug: string): string {
  const [prefix] = slug.split('-')
  return (prefix ?? '').toUpperCase()
}
