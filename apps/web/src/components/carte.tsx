'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type * as Leaflet from 'leaflet'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { couleurDeGroupe, groupeMajoritaire } from '@/lib/carte-couleurs'

/**
 * Un député pour lequel la circonscription a un contour dans
 * `apps/web/public/geo/circonscriptions.json` — c'est-à-dire déjà exclu de
 * la liste des 18 sans contour calculée par `app/carte/page.tsx`.
 * `codeCirconscription` est la clé de jointure avec les propriétés du
 * GeoJSON (même forme, `9310`) : la traduction depuis `constituencyCode`
 * (`93-10`) a déjà eu lieu côté serveur, ce composant n'en a plus besoin.
 */
export interface ContourDepute {
  codeCirconscription: string
  departmentCode: string
  slug: string
  displayName: string
  constituencyLabel: string | null
  groupId: string | null
  groupShortLabel: string | null
  groupColor: string | null
}

interface CirconscriptionProperties {
  codeCirconscription: string
  codeDepartement: string
  nomDepartement: string
}

/**
 * Seuil de zoom Leaflet au-delà duquel la carte distingue chaque
 * circonscription (frontières internes visibles, couleur du député qui y
 * siège) ; en-deçà, elle masque ces frontières et colorie par groupe
 * majoritaire du département. Une constante unique et nommée, plutôt qu'une
 * valeur répétée à chaque endroit qui en dépend.
 */
const SEUIL_CIRCONSCRIPTIONS = 8

/**
 * Au-delà de ce délai sans réponse — asset indisponible, réseau défaillant —
 * l'attente bascule en erreur explicite. Même motif que `vote-history.tsx` :
 * « Chargement… » ne doit jamais être un état terminal.
 */
const TIMEOUT_MS = 15_000

const CENTRE_FRANCE: Leaflet.LatLngExpression = [46.6, 2.4]
const ZOOM_INITIAL = 6

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' }

export function Carte({ deputies }: { deputies: ContourDepute[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Leaflet.Map | null>(null)
  const [state, setState] = useState<State>({ status: 'loading' })
  const router = useRouter()

  useEffect(() => {
    let abandonne = false
    setState({ status: 'loading' })

    const delaiDepasse = setTimeout(() => {
      abandonne = true
      setState({
        status: 'error',
        message: `le chargement dépasse ${TIMEOUT_MS / 1000} secondes : le fichier des contours est probablement indisponible.`,
      })
    }, TIMEOUT_MS)

    async function monter() {
      // Import dynamique : Leaflet référence `window` dès son chargement, ce
      // qui casserait le rendu serveur si le module était importé au niveau
      // du fichier. `useEffect` ne s'exécute jamais côté serveur, c'est donc
      // le seul endroit sûr pour ce chargement.
      const leaflet = await import('leaflet')

      const response = await fetch('/geo/circonscriptions.json')
      if (!response.ok) {
        throw new Error(`l'API a répondu ${response.status} en chargeant les contours`)
      }
      const collection = (await response.json()) as FeatureCollection<
        Geometry,
        CirconscriptionProperties
      >

      if (abandonne || !containerRef.current) return

      const parCirconscription = new Map(deputies.map((d) => [d.codeCirconscription, d]))

      const parDepartement = new Map<string, ContourDepute[]>()
      for (const depute of deputies) {
        const liste = parDepartement.get(depute.departmentCode) ?? []
        liste.push(depute)
        parDepartement.set(depute.departmentCode, liste)
      }

      // Un seul calcul par département, pas par circonscription : le
      // résultat ne dépend pas du zoom, seul son usage en dépend.
      const majoriteParDepartement = new Map<string, ContourDepute | null>()
      for (const [codeDepartement, liste] of parDepartement) {
        const idMajoritaire = groupeMajoritaire(
          liste.map((d) => ({ id: d.groupId ?? d.groupShortLabel ?? d.slug })),
        )
        const representant = idMajoritaire
          ? (liste.find((d) => (d.groupId ?? d.groupShortLabel ?? d.slug) === idMajoritaire) ??
            null)
          : null
        majoriteParDepartement.set(codeDepartement, representant)
      }

      const map = leaflet.map(containerRef.current).setView(CENTRE_FRANCE, ZOOM_INITIAL)
      mapRef.current = map

      // Attribution OSM : condition de la licence des tuiles, pas une option.
      leaflet
        .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noreferrer noopener" target="_blank">OpenStreetMap</a>',
          maxZoom: 18,
        })
        .addTo(map)

      function styleDe(feature?: Feature<Geometry, CirconscriptionProperties>): Leaflet.PathOptions {
        const props = feature?.properties
        if (!props) return { fillColor: couleurDeGroupe(null), fillOpacity: 0.75, weight: 0 }

        if (map.getZoom() >= SEUIL_CIRCONSCRIPTIONS) {
          const depute = parCirconscription.get(props.codeCirconscription)
          return {
            fillColor: couleurDeGroupe(depute?.groupColor),
            fillOpacity: 0.8,
            color: '#44403c',
            weight: 1,
          }
        }

        const majoritaire = majoriteParDepartement.get(props.codeDepartement)
        return {
          // Bordure transparente et non nulle : la géométrie garde une
          // frontière technique (Leaflet en a besoin pour le survol), mais
          // rien de visible ne distingue plus une circonscription de sa
          // voisine du même département.
          fillColor: couleurDeGroupe(majoritaire?.groupColor ?? null),
          fillOpacity: 0.8,
          color: 'transparent',
          weight: 1,
        }
      }

      const couche = leaflet
        .geoJSON(collection, {
          style: styleDe,
          onEachFeature: (feature: Feature<Geometry, CirconscriptionProperties>, layer) => {
            const depute = parCirconscription.get(feature.properties.codeCirconscription)
            if (!depute) return
            layer.bindTooltip(
              `${depute.displayName} — ${depute.groupShortLabel ?? 'groupe non publié'} — ${
                depute.constituencyLabel ?? feature.properties.codeCirconscription
              }`,
            )
            layer.on('click', () => router.push(`/deputes/${depute.slug}`))
          },
        })
        .addTo(map)

      map.on('zoomend', () => couche.setStyle(styleDe))

      clearTimeout(delaiDepasse)
      setState({ status: 'ready' })
    }

    monter().catch((error: unknown) => {
      if (abandonne) return
      clearTimeout(delaiDepasse)
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })

    return () => {
      abandonne = true
      clearTimeout(delaiDepasse)
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deputies` vient du serveur et ne change jamais après le premier rendu ; `router` est stable.
  }, [])

  return (
    <div className="mt-2">
      {/*
        Sans JavaScript, la carte ne peut tout simplement pas se dessiner —
        aucun rendu serveur possible pour Leaflet. `<noscript>` est la seule
        chose qu'un navigateur sans JS affiche réellement ici ; la liste des
        18 députés sans contour et la ligne de provenance, elles, restent
        lisibles sans JavaScript puisqu'elles sont rendues par le serveur
        dans `app/carte/page.tsx`.
      */}
      <noscript>
        <p className="text-sm text-stone-600">
          La carte nécessite JavaScript pour s&apos;afficher. La liste des députés reste
          consultable sur la page{' '}
          <a href="/deputes" className="underline underline-offset-2">
            Députés
          </a>
          .
        </p>
      </noscript>
      {state.status === 'loading' && (
        <p className="text-sm text-stone-600">Chargement de la carte…</p>
      )}
      {state.status === 'error' && (
        <p className="rounded border border-dashed border-stone-300 bg-stone-100/60 p-4 text-sm text-stone-700">
          La carte n&apos;a pas pu être chargée : {state.message}
        </p>
      )}
      <div
        ref={containerRef}
        className="mt-2 h-[600px] w-full rounded border border-stone-200"
        aria-hidden={state.status !== 'ready'}
      />
    </div>
  )
}
