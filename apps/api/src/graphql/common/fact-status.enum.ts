import { registerEnumType } from '@nestjs/graphql'

/**
 * Statut d'un fait, spec §5.7 : `OFFICIAL` (publié tel quel par une source),
 * `NORMALIZED` (typé/dédupliqué mais fidèle à la source), `COMPUTED` (produit
 * par un agrégat, ex. les vues `gold`). Aucune valeur produite par un
 * traitement ne peut porter `OFFICIAL`.
 *
 * C'est le mécanisme choisi pour rendre les données calculées distinguables
 * des faits publiés (point 1 de la tâche) : `VotingSummary.status` vaut
 * toujours `COMPUTED`, exposé explicitement plutôt que laissé à deviner par
 * le nom du champ.
 */
export enum FactStatus {
  OFFICIAL = 'OFFICIAL',
  NORMALIZED = 'NORMALIZED',
  COMPUTED = 'COMPUTED',
}

registerEnumType(FactStatus, {
  name: 'FactStatus',
  description:
    "Distingue un fait publié tel quel (OFFICIAL), normalisé mais fidèle (NORMALIZED), d'un agrégat calculé par PoliGraph (COMPUTED).",
})
