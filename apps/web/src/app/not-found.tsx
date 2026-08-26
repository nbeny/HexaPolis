import Link from 'next/link'

/**
 * Page atteinte quand l'API a répondu correctement qu'aucun député ne porte ce
 * slug — jamais quand l'API est en panne, ce cas-là remonte en page d'erreur.
 * Le texte rappelle donc le périmètre du site (spec §2) plutôt que d'évoquer un
 * incident : la cause la plus probable est qu'on cherche ici quelqu'un qui n'y
 * est pas.
 */
export default function NotFound() {
  return (
    <section>
      <h1 className="text-2xl font-semibold text-stone-900">Page introuvable</h1>
      <p className="mt-3 text-sm text-stone-700">
        Aucun député ne correspond à cette adresse.
      </p>
      <p className="mt-2 text-sm text-stone-600">
        PoliGraph ne couvre que les députés de la 17e législature de l&apos;Assemblée nationale.
        Un sénateur, un maire ou un député d&apos;une législature antérieure n&apos;y a pas de
        fiche.
      </p>
      <p className="mt-4 text-sm">
        <Link className="underline underline-offset-2" href="/deputes">
          Voir la liste des députés
        </Link>
      </p>
    </section>
  )
}
