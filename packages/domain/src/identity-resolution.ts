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
}

export interface IdentityCandidate {
  matchKey: string
  birthDate: string | null
  externalIds: ExternalIdRef[]
  districtCode: string | null
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

  const homonymes = known.filter((person) => person.matchKey === candidate.matchKey)
  if (homonymes.length === 0) return unmatched

  // Niveau 2 — nom et date de naissance.
  if (candidate.birthDate) {
    const exacts = homonymes.filter((person) => person.birthDate === candidate.birthDate)
    if (exacts.length === 1 && exacts[0]) {
      return {
        confidence: 'CONFIRMED',
        personId: exacts[0].personId,
        autoMergeable: true,
        evidence: ['NAME', 'BIRTH_DATE'],
        alternatives: [],
      }
    }
    // Une date connue des deux côtés et différente écarte le rapprochement :
    // ce n'est pas la même personne, et le dire vaut mieux que le taire.
    const datesConnues = homonymes.filter((person) => person.birthDate !== null)
    if (exacts.length === 0 && datesConnues.length === homonymes.length) return unmatched
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
