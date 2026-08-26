/**
 * Toutes ces fonctions rendent `null` quand la valeur est absente, jamais une
 * valeur de repli. C'est la règle centrale du produit : `0 €` et « pas de
 * compte de campagne déposé » sont deux faits différents, et les confondre
 * serait un mensonge sur la donnée. L'appelant reçoit `null` et affiche
 * `<Absent>` — il n'a pas le choix, le type l'y oblige.
 */

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const INTEGER_FORMAT = new Intl.NumberFormat('fr-FR')

export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return DATE_FORMAT.format(date)
}

export function formatAmount(
  value: number | null | undefined,
  currency: string,
): string | null {
  if (value === null || value === undefined) return null
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  // Le pourcentage vient de la source, déjà exprimé en points (52.31 = 52,31 %).
  // On ne divise pas par 100 et on ne recalcule rien : la spec §5.4 interdit
  // de retoucher un chiffre publié, arrondi maison compris.
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} %`
}

export function formatInteger(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return INTEGER_FORMAT.format(value)
}
