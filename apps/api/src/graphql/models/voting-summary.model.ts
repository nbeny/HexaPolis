import { Field, Int, Float, ObjectType } from '@nestjs/graphql'
import { FactStatus } from '../common/fact-status.enum.js'

/**
 * Agrégats de `gold.deputy_card` — jamais recalculés à l'affichage (spec
 * §8.3). `status` vaut toujours `COMPUTED` : c'est le marqueur explicite qui
 * distingue ces chiffres des faits officiels (point 1 de la tâche).
 *
 * Les cinq champs `participation*` sont nullable et RESTENT `null` quand la
 * donnée manque — dénominateur invérifiable (député arrivé après tous les
 * scrutins éligibles, intervalle de mandat de fenêtre inconnue) ou source qui
 * ne nomme le député sur aucun scrutin éligible. Jamais convertis en 0
 * (point 2 de la tâche).
 *
 * Ils forment une décomposition, et c'est délibéré : aucun d'eux ne se suffit
 * à lui-même. `participationExpressedRate` en particulier n'est pas un « taux
 * de participation » et ne doit jamais être affiché seul — un taux bas peut
 * venir de scrutins où le député est enregistré NON_VOTANT
 * (`participationNonVotingCount`) comme de scrutins où la source ne le nomme
 * pas (écart entre `participationNamedCount` et `participationBallotCount`),
 * deux situations qu'un unique pourcentage confond. Voir les commentaires de
 * colonne de `gold.deputy_card` dans la migration
 * 20260826174500_gold_participation_decomposee.
 */
@ObjectType()
export class VotingSummary {
  @Field(() => FactStatus)
  status!: FactStatus

  @Field(() => Int)
  mandateCount!: number

  @Field(() => Int)
  committeeCount!: number

  @Field(() => Int)
  voteCount!: number

  /** Dénominateur : scrutins éligibles tombant dans un mandat réellement tenu. */
  @Field(() => Int, { nullable: true })
  participationBallotCount?: number | null

  /** Ceux de ces scrutins où l'Assemblée nomme le député, toutes positions confondues. */
  @Field(() => Int, { nullable: true })
  participationNamedCount?: number | null

  /** Sous-ensemble du précédent : position POUR, CONTRE ou ABSTENTION. */
  @Field(() => Int, { nullable: true })
  participationExpressedCount?: number | null

  /** Sous-ensemble du précédent : position NON_VOTANT, publiée sans motif par la source. */
  @Field(() => Int, { nullable: true })
  participationNonVotingCount?: number | null

  /** participationExpressedCount / participationBallotCount. Voir l'en-tête : ne s'affiche pas seul. */
  @Field(() => Float, { nullable: true })
  participationExpressedRate?: number | null
}
