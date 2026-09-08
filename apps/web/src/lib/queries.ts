/**
 * La fiche demande cinq sections en un aller-retour serveur : identité,
 * mandats, groupes/commissions, synthèse de vote, élections/financement.
 * Attention à la profondeur — l'API refuse au-delà de 12 niveaux et
 * plafonne la complexité à 2000 (voir `apps/api/src/server.module.ts`).
 *
 * L'historique de vote n'en fait plus partie : `ballotPositions` compte
 * jusqu'à plusieurs milliers de positions par député (2 518 pour Nicolas
 * Metzdorf), largement au-delà de ce qu'une seule page peut afficher.
 * `VOTES_QUERY`, ci-dessous, le requête séparément depuis le navigateur,
 * page par page — voir `vote-history.tsx`.
 */
export const DEPUTY_QUERY = /* GraphQL */ `
  query Deputy($slug: String!) {
    deputy(slug: $slug) {
      id
      slug
      displayName
      firstName
      lastName
      civility
      birthDate
      constituencyCode
      constituencyLabel
      departmentCode
      takingOfficeDate
      currentGroupLabel
      currentGroupShortLabel
      currentGroupColor
      votingSummary {
        status
        mandateCount
        committeeCount
        voteCount
        participationBallotCount
        participationNamedCount
        participationExpressedCount
        participationNonVotingCount
        participationExpressedRate
      }
      mandates {
        id
        kind
        institutionLabel
        legislatureNumber
        territoryCode
        territoryLabel
        startDate
        endDate
        endCause
      }
      groupMemberships {
        id
        bodyLabel
        bodyShortLabel
        bodyColor
        quality
        startDate
        endDate
      }
      committees {
        id
        bodyLabel
        quality
        startDate
        endDate
      }
      candidacies {
        id
        electionLabel
        electionYear
        round
        territoryCode
        territoryLabel
        nuance
        partyName
        votes
        votePctExpressed
        elected
        account {
          currency
          declaredExpenses
          declaredIncome
          declaredDonations
          personalFunds
          retainedExpenses
          retainedIncome
          decisionCode
        }
      }
      sources {
        sourceId
        label
        importedAt
      }
    }
  }
`

/**
 * Historique de vote complet, requêté depuis le navigateur (voir
 * `vote-history.tsx`) : c'est le premier point de la fiche que
 * `DEPUTY_QUERY` ne couvre plus, précisément parce qu'il ne tient pas dans
 * les 25 premières positions.
 */
export const VOTES_QUERY = /* GraphQL */ `
  query VoteHistory($slug: String!, $first: Int, $after: String, $before: String) {
    deputy(slug: $slug) {
      ballotPositions(first: $first, after: $after, before: $before) {
        totalCount
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges {
          node {
            id
            ballotDate
            ballotTitle
            ballotNumber
            legislatureNumber
            position
            byDelegation
            groupShortLabelAtVote
            publicationMode
          }
        }
      }
    }
  }
`

export const DEPUTIES_QUERY = /* GraphQL */ `
  query Deputies($legislature: Int, $groupId: ID, $departmentCode: String, $first: Int, $after: String, $before: String) {
    deputies(
      legislature: $legislature
      groupId: $groupId
      departmentCode: $departmentCode
      first: $first
      after: $after
      before: $before
    ) {
      totalCount
      pageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
      edges {
        cursor
        node {
          id
          slug
          displayName
          constituencyCode
          constituencyLabel
          departmentCode
          currentGroupId
          currentGroupShortLabel
          currentGroupColor
        }
      }
    }
  }
`

/**
 * Alimente les listes déroulantes de `/deputes`. Le schéma n'expose aucune
 * requête `groups` ni `departments` : les options sont donc *dérivées* des
 * députés eux-mêmes, page par page. C'est délibéré — une liste de groupes
 * parlementaires écrite à la main dans le front serait une donnée non sourcée,
 * et elle deviendrait fausse à la première scission de groupe sans que rien
 * ne le signale. Ici, une option n'existe à l'écran que parce qu'au moins un
 * député la porte en base.
 *
 * La requête ne sélectionne que les quatre champs nécessaires aux options :
 * le balayage complet (567 lignes, 3 pages de 200) reste léger, et son
 * résultat est mis en cache par `graphqlFetch`.
 */
export const FILTER_OPTIONS_QUERY = /* GraphQL */ `
  query FilterOptions($first: Int, $after: String) {
    deputies(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          departmentCode
          constituencyLabel
          currentGroupId
          currentGroupLabel
        }
      }
    }
  }
`

export const SEARCH_QUERY = /* GraphQL */ `
  query Search($query: String!, $first: Int) {
    search(query: $query, first: $first) {
      personId
      slug
      displayName
      constituencyLabel
      currentGroupLabel
    }
  }
`
