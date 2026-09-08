/**
 * Fonctions pures de coloration de la carte des circonscriptions
 * (`apps/web/src/components/carte.tsx`) : quelle couleur pour un groupe
 * donné, et quel groupe représente un département quand la carte est trop
 * dézoomée pour distinguer chaque circonscription.
 */

/**
 * Teinte neutre affichée quand l'Assemblée n'a publié aucune couleur pour un
 * groupe. Ni blanc ni noir, pour rester visuellement distincte d'un vrai
 * groupe tout en signalant clairement une absence plutôt qu'un choix.
 */
const COULEUR_NEUTRE = '#d6d3d1'

/**
 * Rend la couleur publiée par l'Assemblée pour un groupe, ou la teinte
 * neutre quand elle manque. Ne jamais *inventer* une couleur — au pire, une
 * teinte neutre visible en dit plus qu'une couleur choisie au hasard qui
 * laisserait croire à une donnée réelle.
 */
export function couleurDeGroupe(color: string | null | undefined): string {
  return color ?? COULEUR_NEUTRE
}

/**
 * Rend l'identifiant du groupe le plus représenté parmi une liste de
 * députés (typiquement, les députés d'un même département), ou `null` :
 * - quand la liste est vide (aucun député rattaché au département) ;
 * - quand deux groupes ou plus sont à égalité au sommet.
 *
 * Trancher une égalité en prenant le premier trouvé afficherait une couleur
 * qui prétendrait à une majorité qui n'existe pas : c'est le même défaut que
 * publier un taux de participation de 0 % tiré d'un silence.
 */
export function groupeMajoritaire(deputies: readonly { id: string }[]): string | null {
  const counts = new Map<string, number>()
  for (const { id } of deputies) counts.set(id, (counts.get(id) ?? 0) + 1)
  if (counts.size === 0) return null

  const max = Math.max(...counts.values())
  const leaders = [...counts.entries()].filter(([, count]) => count === max)
  return leaders.length === 1 ? (leaders[0]?.[0] ?? null) : null
}
