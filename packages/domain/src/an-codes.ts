export type BodyType = 'PARLIAMENTARY_GROUP' | 'COMMITTEE' | 'DELEGATION'
export type MandateKind = 'PARLIAMENTARY' | 'PARTY_AFFILIATION' | 'BODY_MEMBERSHIP'

const BODY_TYPES: Record<string, BodyType> = {
  GP: 'PARLIAMENTARY_GROUP',
  COMPER: 'COMMITTEE',
  COMNL: 'COMMITTEE',
  COMSPSENAT: 'COMMITTEE',
  CMP: 'COMMITTEE',
  DELEG: 'DELEGATION',
  DELEGBUREAU: 'DELEGATION',
  MISINFO: 'DELEGATION',
  MISINFOCOM: 'DELEGATION',
  MISINFOPRE: 'DELEGATION',
}

const MANDATE_KINDS: Record<string, MandateKind> = {
  ASSEMBLEE: 'PARLIAMENTARY',
  PARPOL: 'PARTY_AFFILIATION',
  GP: 'BODY_MEMBERSHIP',
  COMPER: 'BODY_MEMBERSHIP',
  COMNL: 'BODY_MEMBERSHIP',
}

/** Associe un `codeType` d'organe AN à un type de `Body` PoliGraph ; renvoie `null` pour un code non modélisé (ex. `CIRCONSCRIPTION`, qui est un territoire). */
export function bodyTypeFromOrganeCode(code: string): BodyType | null {
  return BODY_TYPES[code] ?? null
}

/** Associe un `typeOrgane` de mandat AN à une catégorie de mandat PoliGraph ; renvoie `null` pour un code non modélisé. */
export function mandateTypeFromTypeOrgane(code: string): MandateKind | null {
  return MANDATE_KINDS[code] ?? null
}
