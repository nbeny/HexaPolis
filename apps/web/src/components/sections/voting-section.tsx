import { ComputedBadge } from '@/components/computed-badge'
import { FactList, type Fact } from '@/components/fact-list'
import { SectionCard, type SectionSource } from '@/components/section-card'
import type { DeputyQuery } from '@/gql/generated'
import { formatDate, formatInteger, formatPercent } from '@/lib/format'

type Deputy = NonNullable<DeputyQuery['deputy']>
type VotingSummary = Deputy['votingSummary']
type BallotPositions = Deputy['ballotPositions']
type BallotPosition = NonNullable<BallotPositions['edges'][number]>['node']

/**
 * Les catégories de vote voyagent depuis l'AN sans transformation
 * (`silver.ballot_position.position`). On leur donne un libellé français
 * lisible, et on retombe sur la valeur brute pour toute catégorie inconnue :
 * afficher un code non traduit vaut mieux que d'en inventer le sens.
 */
const POSITION_LABELS: Record<string, string> = {
  POUR: 'Pour',
  CONTRE: 'Contre',
  ABSTENTION: 'Abstention',
  NON_VOTANT: 'Non-votant',
}

function positionLabel(position: string): string {
  return POSITION_LABELS[position] ?? position
}

/**
 * Fiche du scrutin sur le site de l'AN. Construite uniquement quand le numéro
 * de scrutin et la législature sont tous deux connus : un lien deviné mènerait
 * à une autre page que celle qu'il prétend citer.
 */
function ballotUrl(node: BallotPosition): string | null {
  if (!node.ballotNumber || node.legislatureNumber === null) return null
  return `https://www.assemblee-nationale.fr/dyn/${node.legislatureNumber}/scrutins/${node.ballotNumber}`
}

function summaryFacts(summary: VotingSummary): Fact[] {
  const computed = summary.status === 'COMPUTED'
  const badge = computed ? <ComputedBadge /> : undefined

  return [
    // Les trois chiffres de synthèse portent sur la seule 17e législature —
    // c'est le périmètre de `gold.deputy_card`. La liste ci-dessous, elle, ne
    // filtre pas : les libellés le disent des deux côtés, faute de quoi deux
    // totaux différents se liraient comme une contradiction.
    {
      label: 'Positions enregistrées (17e législature)',
      value: formatInteger(summary.voteCount),
      badge,
    },
    {
      label: 'Scrutins retenus pour le calcul (17e législature)',
      value:
        summary.participationVoteCount === null || summary.participationBallotCount === null
          ? null
          : `${formatInteger(summary.participationVoteCount)} sur ${formatInteger(summary.participationBallotCount)}`,
      absentWhy:
        "Aucun scrutin publié en décompte nominatif ne recoupe un mandat tenu par ce député : le dénominateur n'existe pas.",
      badge,
    },
    {
      label: 'Taux de participation (17e législature)',
      // `gold.deputy_card.participation_rate` est un ratio arrondi à quatre
      // décimales (`ROUND(voted / eligible, 4)`), pas des points de
      // pourcentage. La multiplication par 100 change l'unité, pas la valeur —
      // c'est la seule du front, et elle ne s'étend à aucun autre chiffre.
      value: summary.participationRate === null ? null : formatPercent(summary.participationRate * 100),
      absentWhy:
        "Taux non calculable : le dénominateur (scrutins éligibles pendant le mandat) est invérifiable pour ce député. PoliGraph préfère ne rien afficher plutôt qu'un 0 % qui se lirait comme une absence totale.",
      badge,
    },
  ]
}

export function VotingSection({
  summary,
  positions,
  sources,
}: {
  summary: VotingSummary
  positions: BallotPositions
  sources: SectionSource[]
}) {
  return (
    <SectionCard title="Activité de vote" sources={sources}>
      <FactList facts={summaryFacts(summary)} />

      {/*
        Avertissement obligatoire, pas décoratif : sans lui, un lecteur qui
        compare le nombre de positions au nombre de scrutins en déduirait des
        absences qui n'ont jamais été constatées. Ce serait un fait inventé sur
        une personne réelle.
      */}
      <p className="mt-4 rounded border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
        L&apos;Assemblée nationale ne publie pas le détail nominatif de tous les scrutins. Sur un
        scrutin publié en « décompte des dissidents et position de groupe », seuls les dissidents
        et les non-votants sont nommés : l&apos;absence d&apos;une position pour un député y
        signifie que la source ne l&apos;a pas nommé, jamais qu&apos;il était absent. Un écart
        entre le nombre de positions et le nombre de scrutins ne se lit donc pas comme un nombre
        d&apos;absences.
      </p>

      <h3 className="mt-5 text-sm font-medium text-stone-900">
        {positions.edges.length === 0
          ? 'Derniers scrutins'
          : `Derniers scrutins (${formatInteger(positions.edges.length)} affichés sur ${formatInteger(positions.totalCount)} positions, toutes législatures confondues)`}
      </h3>

      {positions.edges.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500 italic">
          Aucune position de vote n&apos;est rattachée à ce député, toutes législatures
          confondues.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-stone-100">
          {positions.edges.map((edge) => {
            const node = edge.node
            const url = ballotUrl(node)
            const date = formatDate(node.ballotDate)
            return (
              <li key={edge.cursor} className="py-2">
                <p className="text-sm text-stone-900">
                  {positionLabel(node.position)}
                  {node.byDelegation ? ' (par délégation)' : ''}
                  {node.groupShortLabelAtVote ? ` — groupe ${node.groupShortLabelAtVote} au moment du vote` : ''}
                </p>
                <p className="text-sm text-stone-600">
                  {url ? (
                    <a
                      className="underline underline-offset-2 hover:text-stone-900"
                      href={url}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      {node.ballotTitle ?? `Scrutin n° ${node.ballotNumber}`}
                    </a>
                  ) : (
                    (node.ballotTitle ?? 'Intitulé du scrutin non publié')
                  )}
                </p>
                <p className="text-xs text-stone-500">
                  {date ?? 'Date de scrutin non publiée'}
                  {node.publicationMode ? ` · publication : ${node.publicationMode}` : ''}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </SectionCard>
  )
}
