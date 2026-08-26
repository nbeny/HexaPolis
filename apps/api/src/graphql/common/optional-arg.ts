/**
 * GraphQL livre `null` pour un argument nullable explicitement passé par le
 * client — c'est la façon naturelle dont un client généré exprime « pas de
 * filtre » (`InputMaybe<T> = T | null` côté frontend), et c'est aussi ce que
 * produit une variable non fournie mappée à `null` par certains clients.
 * `undefined`, lui, ne représente qu'une absence côté TypeScript/JavaScript.
 *
 * Les dépôts (`GoldRepository`, `SilverRepository`) testent leurs filtres
 * avec `!== undefined` ou `=== undefined` : leur contrat `| undefined` est
 * honnête et ne doit pas changer. C'est la frontière avec GraphQL qui ment
 * en typant ses arguments `number | undefined` alors qu'elle peut recevoir
 * `null`. Cette fonction normalise `null` en `undefined` au moment où
 * l'argument quitte le resolveur — jamais plus loin — pour que les dépôts
 * continuent de recevoir exactement ce que leur signature promet.
 */
export function optionalArg<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined
}
