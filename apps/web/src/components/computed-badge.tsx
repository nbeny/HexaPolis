/**
 * Marque un chiffre produit par PoliGraph et non publié par une source
 * (spec §5.7, statut `COMPUTED`). L'information est portée par du texte et un
 * attribut `title`, pas par la seule couleur : la distinction doit survivre
 * à un lecteur d'écran comme à une impression en noir et blanc.
 */
export function ComputedBadge() {
  return (
    <span
      className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[0.7rem] font-medium uppercase tracking-wide text-amber-800"
      title="Ce chiffre est calculé par PoliGraph à partir des données officielles. Ce n'est pas un chiffre publié par une source."
    >
      Calculé par PoliGraph
    </span>
  )
}
