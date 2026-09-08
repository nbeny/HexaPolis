/**
 * La fiche demande tout en une requête : six sections, un aller-retour.
 * Attention à la profondeur — l'API refuse au-delà de 12 niveaux et
 * plafonne la complexité à 2000 (voir `apps/api/src/server.module.ts`).
 * `ballotPositions` est donc borné à 25, la valeur par défaut de l'API.
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
      ballotPositions(first: 25) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            id
            ballotId
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
