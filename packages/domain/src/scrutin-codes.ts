export type VotePosition = 'POUR' | 'CONTRE' | 'ABSTENTION' | 'NON_VOTANT'

/**
 * L'AN nomme les catégories de `decompteNominatif` tantôt au singulier, tantôt
 * au pluriel : la 14e écrit `pour`, la 17e `pours`, et la 16e emploie les deux
 * conventions au sein d'une même législature. Les deux formes sont acceptées.
 */
const CATEGORY_KEYS: Record<string, VotePosition> = {
  pour: 'POUR',
  pours: 'POUR',
  contre: 'CONTRE',
  contres: 'CONTRE',
  abstention: 'ABSTENTION',
  abstentions: 'ABSTENTION',
  nonVotant: 'NON_VOTANT',
  nonVotants: 'NON_VOTANT',
}

export const VOTE_CATEGORY_KEYS = Object.keys(CATEGORY_KEYS)

/** Associe une clé de `decompteNominatif` à une position ; `null` si la clé n'en est pas une. */
export function positionFromCategoryKey(key: string): VotePosition | null {
  return CATEGORY_KEYS[key] ?? null
}
