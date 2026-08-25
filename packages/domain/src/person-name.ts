/** Décrit les composants bruts d'un nom de personne, tels que fournis par une source de données. */
export interface NameParts {
  civ: string | null
  prenom: string
  nom: string
}

function normalizeToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Produit une clé de comparaison prénom|nom insensible à la casse, aux accents, aux apostrophes et aux tirets ; sert uniquement à rapprocher des personnes, jamais à afficher un nom. */
export function normalizeNameForMatching(prenom: string, nom: string): string {
  return `${normalizeToken(prenom)}|${normalizeToken(nom)}`
}

/** Assemble un nom affichable (prénom puis nom) à partir des composants bruts, en tolérant l'absence de civilité. */
export function buildDisplayName(parts: NameParts): string {
  return `${parts.prenom} ${parts.nom}`.replace(/\s+/g, ' ').trim()
}
