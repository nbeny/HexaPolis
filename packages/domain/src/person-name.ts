/** Décrit les composants bruts d'un nom de personne, tels que fournis par une source de données. */
export interface NameParts {
  civ: string | null
  prenom: string
  nom: string
}

/**
 * Lettres latines que `normalize('NFD')` ne décompose pas (ligatures, lettres
 * nordiques/est-européennes) et que le filtre de liste blanche supprimerait
 * sinon silencieusement. Clés en minuscule car appliquée après `toLowerCase`.
 */
const LATIN_TRANSLITERATIONS: Record<string, string> = {
  œ: 'oe',
  æ: 'ae',
  ø: 'o',
  ß: 'ss',
  ð: 'd',
  đ: 'd',
  þ: 'th',
  ł: 'l',
}

function stripTrailingParenthesizedQualifier(raw: string): string {
  // Un qualificatif éditorial entre parenthèses en fin de nom (ex. « Martin
  // (Gironde) ») n'appartient pas au patronyme et ne doit jamais entrer dans
  // la clé de rapprochement. On ne retire que ce groupe final, pas des
  // parenthèses apparaissant ailleurs dans le jeton.
  return raw.replace(/\s*\([^()]*\)\s*$/, '')
}

function normalizeToken(raw: string): string {
  return stripTrailingParenthesizedQualifier(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[/'’]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s/g, ' ')
    .replace(/[œæøßðđþł]/g, (char) => LATIN_TRANSLITERATIONS[char] ?? char)
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Produit une clé de comparaison prénom|nom insensible à la casse, aux accents, aux apostrophes, aux tirets, aux slashs et aux espaces Unicode ; sert uniquement à rapprocher des personnes, jamais à afficher un nom. Lève une erreur si les deux composants sont vides après normalisation, pour ne jamais fusionner silencieusement deux enregistrements sans nom. */
export function normalizeNameForMatching(prenom: string, nom: string): string {
  const normalizedPrenom = normalizeToken(prenom)
  const normalizedNom = normalizeToken(nom)
  if (normalizedPrenom === '' && normalizedNom === '') {
    throw new Error(
      "normalizeNameForMatching : le prénom et le nom sont tous deux vides après normalisation, impossible de construire une clé de rapprochement fiable",
    )
  }
  return `${normalizedPrenom}|${normalizedNom}`
}

/** Assemble un nom affichable (prénom puis nom) à partir des composants bruts, en tolérant l'absence de civilité. */
export function buildDisplayName(parts: NameParts): string {
  return `${parts.prenom} ${parts.nom}`.replace(/\s+/g, ' ').trim()
}
