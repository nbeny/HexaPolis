export interface CnccfpName {
  civility: string | null
  lastName: string
  firstName: string
}

const CIVILITES = new Set(['M.', 'Mme', 'Mlle'])

function estMajuscule(mot: string): boolean {
  const lettres = [...mot.normalize('NFD')].filter((c) => /\p{L}/u.test(c) && !/\p{M}/u.test(c))
  return lettres.length > 0 && lettres.every((c) => c === c.toUpperCase())
}

/**
 * Décompose le champ `nom` de la CNCCFP, qui agglomère civilité, patronyme et
 * prénom : « Mme DE NICOLAY Axelle ». Le patronyme est en majuscules et peut
 * compter plusieurs mots ; le prénom est capitalisé.
 *
 * Renvoie `null` pour une ligne inexploitable, afin que l'appelant la rejette
 * avec trace plutôt que d'inventer une identité.
 */
export function splitCnccfpName(raw: string): CnccfpName | null {
  const mots = raw.trim().split(/\s+/).filter(Boolean)
  if (mots.length === 0) return null

  const civility = mots[0] && CIVILITES.has(mots[0]) ? (mots.shift() as string) : null

  const patronyme: string[] = []
  const prenom: string[] = []
  for (const mot of mots) {
    if (estMajuscule(mot) && prenom.length === 0) patronyme.push(mot)
    else prenom.push(mot)
  }

  if (patronyme.length === 0 || prenom.length === 0) return null
  return { civility, lastName: patronyme.join(' '), firstName: prenom.join(' ') }
}
