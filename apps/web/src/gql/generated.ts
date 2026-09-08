export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** A date-time string at UTC, such as 2019-12-03T09:54:33Z, compliant with the date-time format. */
  DateTime: { input: string; output: string; }
};

export type BallotPosition = {
  ballotDate: Maybe<Scalars['DateTime']['output']>;
  ballotId: Scalars['ID']['output'];
  ballotNumber: Maybe<Scalars['String']['output']>;
  ballotTitle: Maybe<Scalars['String']['output']>;
  byDelegation: Scalars['Boolean']['output'];
  groupColorAtVote: Maybe<Scalars['String']['output']>;
  groupLabelAtVote: Maybe<Scalars['String']['output']>;
  groupShortLabelAtVote: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  legislatureNumber: Maybe<Scalars['Int']['output']>;
  position: Scalars['String']['output'];
  publicationMode: Maybe<Scalars['String']['output']>;
};

export type BallotPositionConnection = {
  edges: Array<BallotPositionEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type BallotPositionEdge = {
  cursor: Scalars['String']['output'];
  node: BallotPosition;
};

export type BodyMembership = {
  bodyColor: Maybe<Scalars['String']['output']>;
  bodyLabel: Scalars['String']['output'];
  bodyShortLabel: Maybe<Scalars['String']['output']>;
  bodyType: Scalars['String']['output'];
  endDate: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  quality: Maybe<Scalars['String']['output']>;
  startDate: Maybe<Scalars['DateTime']['output']>;
};

export type CampaignAccount = {
  currency: Scalars['String']['output'];
  decisionCode: Maybe<Scalars['String']['output']>;
  declaredDonations: Maybe<Scalars['Float']['output']>;
  declaredExpenses: Maybe<Scalars['Float']['output']>;
  declaredIncome: Maybe<Scalars['Float']['output']>;
  personalFunds: Maybe<Scalars['Float']['output']>;
  retainedExpenses: Maybe<Scalars['Float']['output']>;
  retainedIncome: Maybe<Scalars['Float']['output']>;
};

export type Candidacy = {
  account: Maybe<CampaignAccount>;
  displayName: Scalars['String']['output'];
  elected: Scalars['Boolean']['output'];
  electionLabel: Scalars['String']['output'];
  electionYear: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  nuance: Maybe<Scalars['String']['output']>;
  partyName: Maybe<Scalars['String']['output']>;
  round: Maybe<Scalars['Int']['output']>;
  territoryCode: Maybe<Scalars['String']['output']>;
  territoryLabel: Maybe<Scalars['String']['output']>;
  votePctExpressed: Maybe<Scalars['Float']['output']>;
  votePctRegistered: Maybe<Scalars['Float']['output']>;
  votes: Maybe<Scalars['Int']['output']>;
};

export type Deputy = {
  ballotPositions: BallotPositionConnection;
  birthDate: Maybe<Scalars['DateTime']['output']>;
  candidacies: Array<Candidacy>;
  civility: Maybe<Scalars['String']['output']>;
  committees: Array<BodyMembership>;
  constituencyCode: Maybe<Scalars['String']['output']>;
  constituencyLabel: Maybe<Scalars['String']['output']>;
  currentGroupColor: Maybe<Scalars['String']['output']>;
  currentGroupId: Maybe<Scalars['String']['output']>;
  currentGroupLabel: Maybe<Scalars['String']['output']>;
  currentGroupShortLabel: Maybe<Scalars['String']['output']>;
  departmentCode: Maybe<Scalars['String']['output']>;
  displayName: Scalars['String']['output'];
  firstName: Scalars['String']['output'];
  groupMemberships: Array<BodyMembership>;
  id: Scalars['ID']['output'];
  lastName: Scalars['String']['output'];
  mandates: Array<Mandate>;
  slug: Scalars['String']['output'];
  sources: Array<SourceRef>;
  takingOfficeDate: Maybe<Scalars['DateTime']['output']>;
  votingSummary: VotingSummary;
};


export type DeputyBallotPositionsArgs = {
  after: InputMaybe<Scalars['String']['input']>;
  before: InputMaybe<Scalars['String']['input']>;
  first: InputMaybe<Scalars['Int']['input']>;
  legislature: InputMaybe<Scalars['Int']['input']>;
};


export type DeputyVotingSummaryArgs = {
  legislature: InputMaybe<Scalars['Int']['input']>;
};

export type DeputyConnection = {
  edges: Array<DeputyEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type DeputyEdge = {
  cursor: Scalars['String']['output'];
  node: Deputy;
};

/** Distingue un fait publié tel quel (OFFICIAL), normalisé mais fidèle (NORMALIZED), d'un agrégat calculé par PoliGraph (COMPUTED). */
export type FactStatus =
  | 'COMPUTED'
  | 'NORMALIZED'
  | 'OFFICIAL';

export type Mandate = {
  endCause: Maybe<Scalars['String']['output']>;
  endDate: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  institutionLabel: Scalars['String']['output'];
  kind: Scalars['String']['output'];
  legislatureNumber: Maybe<Scalars['Int']['output']>;
  startDate: Maybe<Scalars['DateTime']['output']>;
  territoryCode: Maybe<Scalars['String']['output']>;
  territoryLabel: Maybe<Scalars['String']['output']>;
};

export type PageInfo = {
  endCursor: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
  hasPreviousPage: Scalars['Boolean']['output'];
  startCursor: Maybe<Scalars['String']['output']>;
};

export type ProvenanceRecord = {
  bronzeRef: Scalars['String']['output'];
  bronzeTable: Scalars['String']['output'];
  entityId: Scalars['ID']['output'];
  entityType: Scalars['String']['output'];
  field: Maybe<Scalars['String']['output']>;
  importRunId: Scalars['ID']['output'];
  source: Maybe<SourceRef>;
  status: FactStatus;
};

export type Query = {
  deputies: DeputyConnection;
  deputy: Maybe<Deputy>;
  provenance: Array<ProvenanceRecord>;
  search: Array<SearchHit>;
};


export type QueryDeputiesArgs = {
  after: InputMaybe<Scalars['String']['input']>;
  before: InputMaybe<Scalars['String']['input']>;
  departmentCode: InputMaybe<Scalars['String']['input']>;
  first: InputMaybe<Scalars['Int']['input']>;
  groupId: InputMaybe<Scalars['ID']['input']>;
  legislature: InputMaybe<Scalars['Int']['input']>;
};


export type QueryDeputyArgs = {
  slug: Scalars['String']['input'];
};


export type QueryProvenanceArgs = {
  entityId: Scalars['ID']['input'];
  entityType: Scalars['String']['input'];
  field: InputMaybe<Scalars['String']['input']>;
};


export type QuerySearchArgs = {
  first: InputMaybe<Scalars['Int']['input']>;
  query: Scalars['String']['input'];
};

export type SearchHit = {
  constituencyLabel: Maybe<Scalars['String']['output']>;
  currentGroupLabel: Maybe<Scalars['String']['output']>;
  displayName: Scalars['String']['output'];
  personId: Scalars['ID']['output'];
  slug: Scalars['String']['output'];
};

export type SourceRef = {
  importedAt: Maybe<Scalars['DateTime']['output']>;
  label: Scalars['String']['output'];
  sourceId: Scalars['ID']['output'];
};

export type VotingSummary = {
  committeeCount: Scalars['Int']['output'];
  mandateCount: Scalars['Int']['output'];
  participationBallotCount: Maybe<Scalars['Int']['output']>;
  participationExpressedCount: Maybe<Scalars['Int']['output']>;
  participationExpressedRate: Maybe<Scalars['Float']['output']>;
  participationNamedCount: Maybe<Scalars['Int']['output']>;
  participationNonVotingCount: Maybe<Scalars['Int']['output']>;
  status: FactStatus;
  voteCount: Scalars['Int']['output'];
};

export type DeputyQueryVariables = Exact<{
  slug: Scalars['String']['input'];
}>;


export type DeputyQuery = { deputy: { id: string, slug: string, displayName: string, firstName: string, lastName: string, civility: string | null, birthDate: string | null, constituencyCode: string | null, constituencyLabel: string | null, departmentCode: string | null, takingOfficeDate: string | null, currentGroupLabel: string | null, currentGroupShortLabel: string | null, currentGroupColor: string | null, votingSummary: { status: FactStatus, mandateCount: number, committeeCount: number, voteCount: number, participationBallotCount: number | null, participationNamedCount: number | null, participationExpressedCount: number | null, participationNonVotingCount: number | null, participationExpressedRate: number | null }, mandates: Array<{ id: string, kind: string, institutionLabel: string, legislatureNumber: number | null, territoryCode: string | null, territoryLabel: string | null, startDate: string | null, endDate: string | null, endCause: string | null }>, groupMemberships: Array<{ id: string, bodyLabel: string, bodyShortLabel: string | null, bodyColor: string | null, quality: string | null, startDate: string | null, endDate: string | null }>, committees: Array<{ id: string, bodyLabel: string, quality: string | null, startDate: string | null, endDate: string | null }>, candidacies: Array<{ id: string, electionLabel: string, electionYear: number, round: number | null, territoryCode: string | null, territoryLabel: string | null, nuance: string | null, partyName: string | null, votes: number | null, votePctExpressed: number | null, elected: boolean, account: { currency: string, declaredExpenses: number | null, declaredIncome: number | null, declaredDonations: number | null, personalFunds: number | null, retainedExpenses: number | null, retainedIncome: number | null, decisionCode: string | null } | null }>, sources: Array<{ sourceId: string, label: string, importedAt: string | null }> } | null };

export type VoteHistoryQueryVariables = Exact<{
  slug: Scalars['String']['input'];
  first: InputMaybe<Scalars['Int']['input']>;
  after: InputMaybe<Scalars['String']['input']>;
  before: InputMaybe<Scalars['String']['input']>;
}>;


export type VoteHistoryQuery = { deputy: { ballotPositions: { totalCount: number, pageInfo: { startCursor: string | null, endCursor: string | null, hasNextPage: boolean, hasPreviousPage: boolean }, edges: Array<{ node: { id: string, ballotDate: string | null, ballotTitle: string | null, ballotNumber: string | null, legislatureNumber: number | null, position: string, byDelegation: boolean, groupShortLabelAtVote: string | null, publicationMode: string | null } }> } } | null };

export type DeputiesQueryVariables = Exact<{
  legislature: InputMaybe<Scalars['Int']['input']>;
  groupId: InputMaybe<Scalars['ID']['input']>;
  departmentCode: InputMaybe<Scalars['String']['input']>;
  first: InputMaybe<Scalars['Int']['input']>;
  after: InputMaybe<Scalars['String']['input']>;
  before: InputMaybe<Scalars['String']['input']>;
}>;


export type DeputiesQuery = { deputies: { totalCount: number, pageInfo: { startCursor: string | null, endCursor: string | null, hasNextPage: boolean, hasPreviousPage: boolean }, edges: Array<{ cursor: string, node: { id: string, slug: string, displayName: string, constituencyCode: string | null, constituencyLabel: string | null, departmentCode: string | null, currentGroupId: string | null, currentGroupShortLabel: string | null, currentGroupColor: string | null } }> } };

export type FilterOptionsQueryVariables = Exact<{
  first: InputMaybe<Scalars['Int']['input']>;
  after: InputMaybe<Scalars['String']['input']>;
}>;


export type FilterOptionsQuery = { deputies: { pageInfo: { hasNextPage: boolean, endCursor: string | null }, edges: Array<{ node: { departmentCode: string | null, constituencyLabel: string | null, currentGroupId: string | null, currentGroupLabel: string | null } }> } };

export type SearchQueryVariables = Exact<{
  query: Scalars['String']['input'];
  first: InputMaybe<Scalars['Int']['input']>;
}>;


export type SearchQuery = { search: Array<{ personId: string, slug: string, displayName: string, constituencyLabel: string | null, currentGroupLabel: string | null }> };
