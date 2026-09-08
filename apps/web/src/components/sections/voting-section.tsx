import { ComputedBadge } from '@/components/computed-badge'
import { FactList, type Fact } from '@/components/fact-list'
import { SectionCard, type SectionSource } from '@/components/section-card'
import { VoteHistory } from '@/components/vote-history'
import type { DeputyQuery } from '@/gql/generated'
import { formatDate, formatInteger, formatPercent } from '@/lib/format'

type Deputy = NonNullable<DeputyQuery['deputy']>
type VotingSummary = Deputy['votingSummary']

/**
 * `gold.deputy_card` laisse les colonnes `participation_*` à `null` pour deux
 * raisons distinctes, et les confondre reviendrait à écrire une phrase fausse
 * sur une personne nommée :
 *
 * - le **dénominateur** manque : aucun scrutin publié en décompte nominatif ne
 *   tombe dans un mandat tenu par le député (arrivée tardive), ou une date de
 *   début de mandat est inconnue et rend la fenêtre invérifiable ;
 * - le **numérateur** manque alors que le dénominateur existe : la source ne
 *   nomme le député sur aucun de ces scrutins. Ce n'est pas « il n'a participé
 *   à aucun » — l'import conserve les positions `NON_VOTANT`, donc un député
 *   qui siège sans voter aurait quand même une ligne par scrutin. Le silence
 *   de la source ne s'écrit ni « 0 sur N », ni « 0 % ».
 *
 * Chaque ligne de la décomposition reçoit le motif qui la concerne : une seule
 * phrase pour les cinq lignes en dirait forcément une de trop ou une de faux.
 */
function participationAbsence(summary: VotingSummary): {
  ballotWhy: string
  namedWhy: string
  breakdownWhy: string
  rateWhy: string
} {
  if (summary.participationBallotCount === null) {
    const denominateur =
      "Aucun scrutin publié en décompte nominatif ne recoupe un mandat tenu par ce député : le dénominateur n'existe pas."
    return {
      ballotWhy: denominateur,
      namedWhy: denominateur,
      breakdownWhy: denominateur,
      rateWhy:
        "Taux non calculable : le dénominateur (scrutins éligibles pendant le mandat) est invérifiable pour ce député. PoliGraph préfère ne rien afficher plutôt qu'un 0 % qui se lirait comme une absence totale.",
    }
  }

  const total = formatInteger(summary.participationBallotCount)
  return {
    // Inatteignable dans cette branche — le dénominateur est connu, donc sa
    // ligne porte une valeur. Renseigné quand même : un motif d'absence vide
    // afficherait une absence sans la dire.
    ballotWhy:
      "Le nombre de scrutins éligibles n'est pas déterminé pour ce député.",
    namedWhy: `${total} scrutins publiés en décompte nominatif recoupent un mandat tenu par ce député, mais l'Assemblée nationale ne le nomme sur aucun d'eux : le numérateur est introuvable, il ne vaut pas zéro.`,
    breakdownWhy: `L'Assemblée nationale ne nomme ce député sur aucun des ${total} scrutins éligibles de son mandat : ni les positions exprimées ni les non-votes ne peuvent être décomptés. Zéro serait un chiffre inventé.`,
    rateWhy: `Taux non calculable : l'Assemblée nationale ne nomme ce député sur aucun des ${total} scrutins éligibles de son mandat. Un silence de la source n'établit pas qu'il fut absent, et PoliGraph n'en tire pas un 0 %.`,
  }
}

/**
 * La participation n'est pas publiée comme un chiffre unique, et c'est le
 * fond du problème que cette liste corrige.
 *
 * Un « taux de participation » de 100 % était affiché pour la présidente de
 * l'Assemblée nationale, dont 8 341 des 8 434 positions de la 17e législature
 * sont des NON_VOTANT : le taux comptait les non-votes comme de la
 * participation. Sortir les NON_VOTANT du numérateur sous le même libellé
 * aurait affiché 1,10 % — un député qui ne siégerait jamais. Les deux lectures
 * sortent du même chiffre selon un fait que le chiffre ne porte pas ; aucun
 * pourcentage seul ne peut trancher.
 *
 * D'où une décomposition, ordonnée du plus large au plus étroit, où chaque
 * ligne est un décompte observé et où le taux arrive en dernier, après les
 * chiffres dont il est tiré :
 *
 *   scrutins éligibles ⊇ scrutins où l'Assemblée nomme le député
 *                        ⊇ positions exprimées | non-votes
 *
 * Les deux sous-lignes sont introduites par « dont » — un sous-ensemble, pas
 * une partition : si l'Assemblée publiait une cinquième catégorie de position,
 * leur somme cesserait d'égaler la ligne au-dessus sans que la fiche ait
 * affirmé le contraire.
 *
 * Ce que la fiche n'écrit pas : pourquoi tel député est non-votant. La source
 * ne publie pas de motif, PoliGraph n'en invente pas, et aucun député ne reçoit
 * de traitement particulier — les décomptes sont rendus tels quels.
 */
function summaryFacts(summary: VotingSummary, takingOfficeDate: string | null): Fact[] {
  const computed = summary.status === 'COMPUTED'
  const badge = computed ? <ComputedBadge /> : undefined
  const absence = participationAbsence(summary)
  const { participationBallotCount, participationNamedCount } = summary

  return [
    // Le total de tête porte sur la seule 17e législature — c'est le périmètre
    // de `gold.deputy_card`. La liste des derniers scrutins, elle, ne filtre
    // pas : les libellés le disent des deux côtés, faute de quoi deux totaux
    // différents se liraient comme une contradiction.
    {
      label: 'Positions enregistrées (17e législature)',
      value: formatInteger(summary.voteCount),
      badge,
    },
    {
      // Placée juste avant le dénominateur, parce que c'est elle qui l'explique.
      // Sans elle, « 17 scrutins éligibles » et « 8 434 scrutins éligibles »
      // s'affichent sous le même libellé, et les taux qui en sortent se
      // comparent comme s'ils portaient la même chose.
      //
      // Pas de badge « Calculé par PoliGraph » : cette date est publiée par
      // l'Assemblée nationale (`mandature.datePriseFonction`), elle n'est pas
      // un agrégat. Les lignes suivantes, elles, en portent un.
      label: 'Entrée en fonction (mandat en cours)',
      value: formatDate(takingOfficeDate),
      absentWhy:
        "L'Assemblée nationale ne publie pas de date d'entrée en fonction pour le mandat en cours de ce député. Le décompte ci-dessous s'ouvre alors à la date de début de mandat, indiquée dans la section « Mandats ».",
    },
    {
      label: 'Scrutins éligibles au calcul (17e législature)',
      value: formatInteger(participationBallotCount),
      absentWhy: absence.ballotWhy,
      badge,
    },
    {
      // Être nommé n'est pas avoir voté : c'est exactement la confusion que
      // l'ancien « taux de participation » commettait. Le libellé dit
      // « nomme », les deux lignes suivantes disent ce que ce nom recouvre.
      label: 'Scrutins où l’Assemblée nomme ce député',
      value:
        participationNamedCount === null || participationBallotCount === null
          ? null
          : `${formatInteger(participationNamedCount)} sur ${formatInteger(participationBallotCount)}`,
      absentWhy: absence.namedWhy,
      badge,
    },
    {
      label: 'dont position exprimée (pour, contre, abstention)',
      value: formatInteger(summary.participationExpressedCount),
      absentWhy: absence.breakdownWhy,
      badge,
    },
    {
      // La ligne qui rend le reste lisible. Sans elle, un taux de 1,10 % et un
      // taux de 100 % se ressemblent : ils ne disent pas d'où ils viennent.
      label: 'dont non-votant',
      value: formatInteger(summary.participationNonVotingCount),
      absentWhy: absence.breakdownWhy,
      badge,
    },
    {
      // Le libellé nomme son numérateur et son dénominateur. Il ne contient
      // pas « participation » : ce mot est précisément celui qui autorisait
      // les deux lectures opposées.
      label: 'Positions exprimées rapportées aux scrutins éligibles',
      // `gold.deputy_card.participation_expressed_rate` est un ratio arrondi à
      // quatre décimales (`ROUND(exprimées / éligibles, 4)`), pas des points de
      // pourcentage. La multiplication par 100 change l'unité, pas la valeur —
      // c'est la seule du front, et elle ne s'étend à aucun autre chiffre.
      value:
        summary.participationExpressedRate === null
          ? null
          : formatPercent(summary.participationExpressedRate * 100),
      absentWhy: absence.rateWhy,
      badge,
    },
  ]
}

export function VotingSection({
  summary,
  slug,
  takingOfficeDate,
  sources,
}: {
  summary: VotingSummary
  /**
   * Slug du député, transmis à `VoteHistory` : l'historique de vote est
   * chargé depuis le navigateur, pas par la requête serveur de la fiche —
   * voir `vote-history.tsx`.
   */
  slug: string
  /**
   * `Deputy.takingOfficeDate` : date d'entrée en fonction publiée par
   * l'Assemblée pour le mandat en cours. Passée ici, et non lue dans
   * `summary`, parce que ce n'est pas un agrégat — voir le champ dans
   * `deputy.model.ts`.
   */
  takingOfficeDate: string | null
  sources: SectionSource[]
}) {
  return (
    <SectionCard title="Activité de vote" sources={sources}>
      <FactList facts={summaryFacts(summary, takingOfficeDate)} />

      {/*
        Avertissements obligatoires, pas décoratifs. Le premier empêche de lire
        l'écart entre scrutins éligibles et scrutins nommés comme un nombre
        d'absences ; le second empêche de lire le décompte des non-votes comme
        un jugement. Sans eux, la décomposition ci-dessus se refermerait sur
        les mêmes conclusions fausses que le taux unique qu'elle remplace.
      */}
      <p className="mt-4 rounded border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
        L&apos;Assemblée nationale ne publie pas le détail nominatif de tous les scrutins, et sur
        ceux qu&apos;elle publie ainsi, elle ne nomme pas tous les députés : n&apos;y figurent que
        ceux pour lesquels une position a été enregistrée. Sur un scrutin publié en « décompte des
        dissidents et position de groupe », seuls les dissidents et les non-votants sont nommés.
        L&apos;absence d&apos;une ligne pour un député signifie donc que la source ne l&apos;a pas
        nommé, jamais qu&apos;il était absent : l&apos;écart entre le nombre de scrutins éligibles
        et le nombre de scrutins où l&apos;Assemblée le nomme ne se lit pas comme un nombre
        d&apos;absences, et PoliGraph n&apos;en publie aucun.
      </p>

      <p className="mt-2 rounded border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
        « Non-votant » est la catégorie que l&apos;Assemblée nationale enregistre pour un député
        qu&apos;elle nomme sur un scrutin sans y porter de position pour, contre ou abstention.
        Elle est publiée sans motif et recouvre des situations sans rapport entre elles. PoliGraph
        ne les distingue pas, n&apos;en publie aucune explication et n&apos;applique de traitement
        particulier à aucun député : le décompte est rendu tel quel. C&apos;est aussi pourquoi le
        taux ci-dessus n&apos;est jamais affiché seul — il ne dit pas, à lui seul, ce qui le rend
        haut ou bas.
      </p>

      {/*
        Troisième avertissement, ajouté avec l'entrée en fonction. Les deux
        précédents empêchent de mal lire le numérateur ; celui-ci empêche de
        mal lire le dénominateur, et surtout de comparer deux taux qui ne
        reposent pas sur le même nombre de scrutins. Il énonce une règle de
        lecture valable pour les 577 fiches, sans qualifier aucun député : les
        dates et les décomptes sont ceux que la source publie.
      */}
      <p className="mt-2 rounded border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
        Le décompte des scrutins éligibles s&apos;ouvre à la date d&apos;entrée en fonction
        ci-dessus, et non à l&apos;ouverture de la législature : un député qui remplace un
        collègue nommé au gouvernement ou en mission ne pouvait pas voter les scrutins tenus
        avant son arrivée, et les compter contre lui produirait un taux proche de zéro. En
        contrepartie, un taux calculé sur quelques dizaines de scrutins et un taux calculé sur
        plusieurs milliers ne se comparent pas : le pourcentage seul ne dit pas combien de
        scrutins il résume, c&apos;est pourquoi le nombre de scrutins éligibles est affiché à
        côté de lui et jamais séparé.
      </p>

      <h3 className="mt-5 text-sm font-medium text-stone-900">Scrutins</h3>
      <VoteHistory slug={slug} />
    </SectionCard>
  )
}
