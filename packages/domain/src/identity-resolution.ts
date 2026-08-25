export type MatchConfidence =
  | 'CONFIRMED'
  | 'PROBABLE'
  | 'POSSIBLE'
  | 'AMBIGUOUS'
  | 'CONFLICT'
  | 'UNMATCHED'

export interface ExternalIdRef {
  source: string
  kind: string
  value: string
}

export interface KnownPerson {
  personId: string
  matchKey: string
  birthDate: string | null
  externalIds: ExternalIdRef[]
  districtCodes: string[]
  /** Mandats connus, pour corroborer une candidature par le mandat qui l'a suivie. */
  mandates: { territoryCode: string; startDate: string | null }[]
}

export interface IdentityCandidate {
  matchKey: string
  birthDate: string | null
  externalIds: ExternalIdRef[]
  districtCode: string | null
  /** Date de l'élection à laquelle se rapporte ce candidat, si la source en désigne une. */
  electionDate: string | null
  /** Vrai si un seul candidat de ce nom se présentait dans cette circonscription. */
  uniqueInDistrict: boolean
}

export interface IdentityVerdict {
  confidence: MatchConfidence
  personId: string | null
  /** Seuls les niveaux 1 et 2 autorisent une fusion sans intervention humaine. */
  autoMergeable: boolean
  evidence: string[]
  /** Personnes également plausibles ; non vide quand la confiance est AMBIGUOUS. */
  alternatives: string[]
}

function sameExternalId(a: ExternalIdRef, b: ExternalIdRef): boolean {
  return a.source === b.source && a.kind === b.kind && a.value === b.value
}

/**
 * Applique la cascade de résolution d'identité décrite dans la spec §7.2.
 *
 * Ne fusionne automatiquement que sur preuve forte : un identifiant externe
 * déjà connu, ou un nom accompagné d'une date de naissance identique. Tout le
 * reste attend un arbitrage humain — fusionner deux personnes distinctes est
 * la pire défaillance possible pour ce projet.
 */
export function resolveIdentity(
  candidate: IdentityCandidate,
  known: KnownPerson[],
): IdentityVerdict {
  const unmatched: IdentityVerdict = {
    confidence: 'UNMATCHED',
    personId: null,
    autoMergeable: false,
    evidence: [],
    alternatives: [],
  }

  // Niveau 1 — un identifiant externe déjà connu.
  for (const person of known) {
    const shared = person.externalIds.some((existing) =>
      candidate.externalIds.some((incoming) => sameExternalId(existing, incoming)),
    )
    if (!shared) continue

    // Une date de naissance discordante sur un identifiant partagé est une
    // contradiction : deux sources désignent la même personne différemment.
    if (candidate.birthDate && person.birthDate && candidate.birthDate !== person.birthDate) {
      return {
        confidence: 'CONFLICT',
        personId: person.personId,
        autoMergeable: false,
        evidence: ['EXTERNAL_ID', 'BIRTH_DATE_MISMATCH'],
        alternatives: [],
      }
    }
    return {
      confidence: 'CONFIRMED',
      personId: person.personId,
      autoMergeable: true,
      evidence: ['EXTERNAL_ID'],
      alternatives: [],
    }
  }

  const homonymesTrouves = known.filter((person) => person.matchKey === candidate.matchKey)
  if (homonymesTrouves.length === 0) return unmatched

  // Niveau 2 — nom et date de naissance.
  let homonymes = homonymesTrouves
  if (candidate.birthDate) {
    const exacts = homonymesTrouves.filter((person) => person.birthDate === candidate.birthDate)
    if (exacts.length === 1 && exacts[0]) {
      return {
        confidence: 'CONFIRMED',
        personId: exacts[0].personId,
        autoMergeable: true,
        evidence: ['NAME', 'BIRTH_DATE'],
        alternatives: [],
      }
    }
    // Une date connue et différente écarte le rapprochement : c'est une preuve
    // de non-identité, pas une absence de preuve. Une date nulle, elle, ne
    // désigne ni ne disqualifie personne et reste un candidat légitime.
    homonymes = homonymesTrouves.filter(
      (person) => person.birthDate === null || person.birthDate === candidate.birthDate,
    )
    if (homonymes.length === 0) return unmatched
  }

  // Niveau 2 bis — élection puis mandat.
  // Un député siégeant dans la circonscription où un candidat du même nom s'est
  // présenté, avec un mandat commençant après ce scrutin, EST ce candidat —
  // à condition qu'un seul candidat de ce nom s'y présentait. Deux homonymes
  // dans la même circonscription rendent la corroboration muette.
  if (candidate.districtCode && candidate.electionDate && candidate.uniqueInDistrict) {
    const corrobores = homonymes.filter((person) =>
      person.mandates.some(
        (mandat) =>
          mandat.territoryCode === candidate.districtCode &&
          mandat.startDate !== null &&
          mandat.startDate >= (candidate.electionDate as string),
      ),
    )
    if (corrobores.length === 1 && corrobores[0]) {
      return {
        confidence: 'CONFIRMED',
        personId: corrobores[0].personId,
        autoMergeable: true,
        evidence: ['NAME', 'DISTRICT', 'ELECTED_MANDATE'],
        alternatives: [],
      }
    }
    if (corrobores.length > 1) {
      return {
        confidence: 'AMBIGUOUS',
        personId: null,
        autoMergeable: false,
        evidence: ['NAME', 'DISTRICT', 'ELECTED_MANDATE'],
        alternatives: corrobores.map((person) => person.personId),
      }
    }
  }

  // Niveau 3 — circonscription.
  if (candidate.districtCode) {
    const memeCirconscription = homonymes.filter((person) =>
      person.districtCodes.includes(candidate.districtCode as string),
    )
    if (memeCirconscription.length === 1 && memeCirconscription[0]) {
      return {
        confidence: 'PROBABLE',
        personId: memeCirconscription[0].personId,
        autoMergeable: false,
        evidence: ['NAME', 'DISTRICT'],
        alternatives: [],
      }
    }
    if (memeCirconscription.length > 1) {
      return {
        confidence: 'AMBIGUOUS',
        personId: null,
        autoMergeable: false,
        evidence: ['NAME', 'DISTRICT'],
        alternatives: memeCirconscription.map((person) => person.personId),
      }
    }
  }

  // Niveau 4 — le nom seul.
  if (homonymes.length === 1 && homonymes[0]) {
    return {
      confidence: 'POSSIBLE',
      personId: homonymes[0].personId,
      autoMergeable: false,
      evidence: ['NAME'],
      alternatives: [],
    }
  }

  return {
    confidence: 'AMBIGUOUS',
    personId: null,
    autoMergeable: false,
    evidence: ['NAME'],
    alternatives: homonymes.map((person) => person.personId),
  }
}
