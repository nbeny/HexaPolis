/**
 * Traduit un code de circonscription interne (`silver.territory.code`, de la
 * forme `93-10`) vers le code employé par le GeoJSON des contours
 * (`codeCirconscription`, de la forme `9310`).
 *
 * La correspondance n'est pas une simple concaténation : le fichier publié
 * emploie pour l'outre-mer les codes INSEE historiques à lettre, hérités
 * d'une nomenclature antérieure aux codes à trois chiffres. Elle est donc
 * écrite en clair et testée code par code, plutôt que dérivée d'une règle
 * qu'on aurait devinée.
 *
 * Rend `null` quand la source ne cartographie pas le territoire — c'est un
 * fait à afficher, pas une erreur à masquer : voir la liste des 18 députés
 * concernés dans la spec §4.3.
 */
const OUTRE_MER: Record<string, string> = {
  '971': 'ZA', // Guadeloupe
  '972': 'ZB', // Martinique
  '973': 'ZC', // Guyane
  '974': 'ZD', // La Réunion
  '975': 'ZS', // Saint-Pierre-et-Miquelon
  '976': 'ZM', // Mayotte
}

/**
 * Territoires que le fichier publié ne couvre pas. Énumérés plutôt que
 * déduits : « absent du GeoJSON » et « code que nous ne savons pas traduire »
 * sont deux choses différentes, et seule la première est un fait sur la
 * source.
 */
const SANS_CONTOUR = new Set([
  '099', // Français de l'étranger — aucun territoire cartographiable
  '977', // Saint-Martin / Saint-Barthélemy
  '986', // Wallis-et-Futuna
  '987', // Polynésie française
  '988', // Nouvelle-Calédonie
])

export function codeGeoDepuisCirconscription(code: string): string | null {
  const separateur = code.indexOf('-')
  if (separateur <= 0) return null

  const departement = code.slice(0, separateur)
  const rang = code.slice(separateur + 1)
  if (rang === '' || !/^\d+$/.test(rang)) return null

  if (SANS_CONTOUR.has(departement)) return null

  const prefixe = OUTRE_MER[departement] ?? departement
  // Les codes métropolitains à trois chiffres n'existent pas ; ceux de la
  // Corse (`2A`, `2B`) font déjà deux caractères. Le `padStart` ne sert donc
  // qu'aux départements à un chiffre, qui n'apparaissent pas dans nos données
  // mais que rien n'interdit de recevoir.
  if (prefixe.length > 2) return null

  return `${prefixe.padStart(2, '0')}${rang.padStart(2, '0')}`
}
