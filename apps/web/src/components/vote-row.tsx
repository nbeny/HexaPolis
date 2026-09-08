import type { VoteHistoryQuery } from '@/gql/generated'
import { formatDate } from '@/lib/format'

export type VoteNode = NonNullable<
  VoteHistoryQuery['deputy']
>['ballotPositions']['edges'][number]['node']

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
function ballotUrl(node: VoteNode): string | null {
  if (!node.ballotNumber || node.legislatureNumber === null) return null
  return `https://www.assemblee-nationale.fr/dyn/${node.legislatureNumber}/scrutins/${node.ballotNumber}`
}

/*
 * Le corps de ce composant reprend tel quel le `map` qui vivait dans
 * `voting-section.tsx` (trois paragraphes : position, intitulé/lien, puis
 * date + mode de publication). Une version plus courte a circulé pendant la
 * rédaction de cette tâche, qui fusionnait la date dans le deuxième
 * paragraphe et perdait le mode de publication et le repli « Date de scrutin
 * non publiée » — un changement de HTML, pas une extraction. Elle n'a pas été
 * retenue.
 */
export function VoteRow({ vote }: { vote: VoteNode }) {
  const url = ballotUrl(vote)
  const date = formatDate(vote.ballotDate)
  return (
    <li className="py-2">
      <p className="text-sm text-stone-900">
        {positionLabel(vote.position)}
        {vote.byDelegation ? ' (par délégation)' : ''}
        {vote.groupShortLabelAtVote
          ? ` — groupe ${vote.groupShortLabelAtVote} au moment du vote`
          : ''}
      </p>
      <p className="text-sm text-stone-600">
        {url ? (
          <a
            className="underline underline-offset-2 hover:text-stone-900"
            href={url}
            rel="noreferrer noopener"
            target="_blank"
          >
            {vote.ballotTitle ?? `Scrutin n° ${vote.ballotNumber}`}
          </a>
        ) : (
          (vote.ballotTitle ?? 'Intitulé du scrutin non publié')
        )}
      </p>
      <p className="text-xs text-stone-500">
        {date ?? 'Date de scrutin non publiée'}
        {vote.publicationMode ? ` · publication : ${vote.publicationMode}` : ''}
      </p>
    </li>
  )
}
