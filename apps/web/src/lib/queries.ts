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
      currentGroupLabel
      currentGroupShortLabel
      currentGroupColor
      votingSummary {
        status
        mandateCount
        committeeCount
        voteCount
        participationBallotCount
        participationVoteCount
        participationRate
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
  query Deputies($legislature: Int, $groupId: ID, $departmentCode: String, $first: Int, $after: String) {
    deputies(
      legislature: $legislature
      groupId: $groupId
      departmentCode: $departmentCode
      first: $first
      after: $after
    ) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
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
