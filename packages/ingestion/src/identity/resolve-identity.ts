import type { PrismaClient } from '@poligraph/db'
import {
  resolveIdentity,
  type ExternalIdRef,
  type IdentityCandidate,
  type IdentityVerdict,
  type KnownPerson,
} from '@poligraph/domain'
import type { SourceKey } from '../contract.js'
import type { IdentityDecision, IdentityRecordRef } from './decisions-file.js'

function externalIdKey(source: string, kind: string, value: string): string {
  return `${source}|${kind}|${value}`
}

/**
 * Index des personnes déjà en base, construit une seule fois par import et
 * réutilisé pour chaque candidat. Reconstruire cet index par ligne coûterait
 * une requête (voire un `findMany` complet) par ligne importée — déjà sensible
 * à 3 119 personnes, rédhibitoire aux 6 292 candidats CNCCFP.
 */
export interface KnownPersonIndex {
  /** Personnes partageant un même `matchKey` (homonymes). */
  byMatchKey: Map<string, KnownPerson[]>
  /** Personnes retrouvables par un identifiant externe déjà connu (niveau 1). */
  byExternalId: Map<string, KnownPerson>
}

/**
 * Charge toutes les personnes et construit l'index en deux requêtes au total
 * (personnes + mandats + territoires, puis identifiants externes), quel que
 * soit le nombre de lignes à résoudre ensuite.
 */
export async function buildKnownPersonIndex(prisma: PrismaClient): Promise<KnownPersonIndex> {
  const persons = await prisma.person.findMany({
    select: {
      id: true,
      matchKey: true,
      birthDate: true,
      mandates: { select: { territory: { select: { code: true } } } },
    },
  })

  const externalIdentifiers = await prisma.externalIdentifier.findMany({
    where: { ownerType: 'Person' },
    select: { ownerId: true, sourceId: true, kind: true, value: true },
  })
  const externalIdsByPerson = new Map<string, ExternalIdRef[]>()
  for (const identifier of externalIdentifiers) {
    const list = externalIdsByPerson.get(identifier.ownerId) ?? []
    list.push({ source: identifier.sourceId, kind: identifier.kind, value: identifier.value })
    externalIdsByPerson.set(identifier.ownerId, list)
  }

  const byMatchKey = new Map<string, KnownPerson[]>()
  const byExternalId = new Map<string, KnownPerson>()

  for (const person of persons) {
    const known: KnownPerson = {
      personId: person.id,
      matchKey: person.matchKey,
      birthDate: person.birthDate ? person.birthDate.toISOString().slice(0, 10) : null,
      externalIds: externalIdsByPerson.get(person.id) ?? [],
      districtCodes: [
        ...new Set(
          person.mandates.map((mandate) => mandate.territory?.code).filter((code): code is string => Boolean(code)),
        ),
      ],
    }

    const bucket = byMatchKey.get(known.matchKey) ?? []
    bucket.push(known)
    byMatchKey.set(known.matchKey, bucket)

    for (const externalId of known.externalIds) {
      byExternalId.set(externalIdKey(externalId.source, externalId.kind, externalId.value), known)
    }
  }

  return { byMatchKey, byExternalId }
}

/**
 * Personnes pertinentes pour un candidat : ses homonymes, plus toute personne
 * déjà reliée par l'un de ses identifiants externes (utile au réimport : le
 * candidat porte alors son propre identifiant dérivé, déjà attaché à une
 * personne lors d'un run précédent).
 */
function relevantKnownPersons(index: KnownPersonIndex, candidate: IdentityCandidate): KnownPerson[] {
  const found = new Map<string, KnownPerson>()
  for (const person of index.byMatchKey.get(candidate.matchKey) ?? []) found.set(person.personId, person)
  for (const externalId of candidate.externalIds) {
    const person = index.byExternalId.get(externalIdKey(externalId.source, externalId.kind, externalId.value))
    if (person) found.set(person.personId, person)
  }
  return [...found.values()]
}

function decisionTargets(decision: IdentityDecision, sourceId: SourceKey, sourceKey: string): IdentityRecordRef | null {
  if (decision.left.source === sourceId && decision.left.key === sourceKey) return decision.right
  if (decision.right.source === sourceId && decision.right.key === sourceKey) return decision.left
  return null
}

/**
 * Vérifie que chaque décision visant cette source cible un enregistrement
 * effectivement rencontré dans cet import. Une clé qui ne correspond plus à
 * rien — source renommée, faute de frappe, ligne disparue du fichier publié —
 * doit arrêter l'import : c'est exactement le risque que ce fichier
 * d'arbitrage existe pour prévenir. La laisser passer en silence reviendrait
 * à ignorer un arbitrage humain sans que personne ne s'en aperçoive.
 */
export function assertDecisionsAreResolvable(
  decisions: IdentityDecision[],
  sourceId: SourceKey,
  knownSourceKeys: ReadonlySet<string>,
  decisionsPath: string,
): void {
  for (const decision of decisions) {
    for (const ref of [decision.left, decision.right]) {
      if (ref.source !== sourceId) continue
      if (!knownSourceKeys.has(ref.key)) {
        throw new Error(
          `${decisionsPath} : la décision ${decision.decision} référence ${ref.source}/${ref.key}, ` +
            `introuvable parmi les enregistrements importés cette fois-ci (raison archivée : "${decision.reason}")`,
        )
      }
    }
  }
}

/** Retrouve la personne désignée par un enregistrement d'une source, qu'il
 * s'agisse d'un identifiant externe déjà attaché (AN) ou d'un rapprochement
 * déjà résolu (RNE, CNCCFP), en passant par la table `IdentityMatch`. */
async function resolvePersonForRecord(prisma: PrismaClient, ref: IdentityRecordRef): Promise<string | null> {
  const external = await prisma.externalIdentifier.findFirst({
    where: { sourceId: ref.source, value: ref.key, ownerType: 'Person' },
    select: { ownerId: true },
  })
  if (external) return external.ownerId

  const match = await prisma.identityMatch.findFirst({
    where: { sourceId: ref.source, sourceKey: ref.key, personId: { not: null } },
    select: { personId: true },
  })
  return match?.personId ?? null
}

export interface ResolveAndRecordInput {
  sourceId: SourceKey
  /** Identifiant du candidat au sein de sa source ; sert de clé aux décisions d'arbitrage. */
  sourceKey: string
  candidate: IdentityCandidate
  /** Attaché à la personne quand le verdict est fusionnable automatiquement. */
  attachExternalIdentifier?: { kind: string; value: string }
}

async function decideVerdict(
  prisma: PrismaClient,
  index: KnownPersonIndex,
  decisions: IdentityDecision[],
  input: ResolveAndRecordInput,
): Promise<{ verdict: IdentityVerdict; decidedByHuman: boolean }> {
  for (const decision of decisions) {
    const other = decisionTargets(decision, input.sourceId, input.sourceKey)
    if (!other) continue

    if (decision.decision === 'MERGE') {
      const personId = await resolvePersonForRecord(prisma, other)
      if (!personId) {
        throw new Error(
          `Décision MERGE irréalisable : ${other.source}/${other.key} ne correspond à aucune personne connue ` +
            `(raison archivée : "${decision.reason}")`,
        )
      }
      return {
        decidedByHuman: true,
        verdict: { confidence: 'CONFIRMED', personId, autoMergeable: true, evidence: ['DECISION'], alternatives: [] },
      }
    }

    // SPLIT : l'humain a écarté un rapprochement précis. On ne sait pas pour
    // autant qui est le candidat — seulement qu'il n'est pas la personne
    // désignée par l'autre côté du SPLIT. On l'exclut donc des personnes
    // connues avant de laisser la cascade suivre son cours normalement.
    const excludedPersonId = await resolvePersonForRecord(prisma, other)
    const known = relevantKnownPersons(index, input.candidate).filter(
      (person) => person.personId !== excludedPersonId,
    )
    return { decidedByHuman: true, verdict: resolveIdentity(input.candidate, known) }
  }

  return {
    decidedByHuman: false,
    verdict: resolveIdentity(input.candidate, relevantKnownPersons(index, input.candidate)),
  }
}

/**
 * Applique la cascade (après priorité donnée à un éventuel arbitrage humain) à
 * un candidat, puis enregistre le résultat : un `IdentityMatch` dans tous les
 * cas, et — seulement si le verdict est fusionnable automatiquement —
 * l'identifiant externe qui permettra à un futur import de retrouver la
 * personne au niveau 1 sans tout recalculer.
 *
 * N'écrit jamais de `Person` : ce n'est pas le rôle de cette fonction. Un
 * verdict qui n'est pas fusionnable automatiquement s'arrête au
 * `IdentityMatch`, en attente d'arbitrage.
 */
export async function resolveAndRecordIdentity(
  prisma: PrismaClient,
  index: KnownPersonIndex,
  decisions: IdentityDecision[],
  input: ResolveAndRecordInput,
): Promise<IdentityVerdict> {
  const { verdict, decidedByHuman } = await decideVerdict(prisma, index, decisions, input)

  const naturalKey = `${input.sourceId}|${input.sourceKey}`
  await prisma.identityMatch.upsert({
    where: { naturalKey },
    update: {
      personId: verdict.personId,
      confidence: verdict.confidence,
      evidence: verdict.evidence,
      alternatives: verdict.alternatives,
      decidedBy: decidedByHuman ? 'HUMAN' : 'AUTO',
    },
    create: {
      naturalKey,
      sourceId: input.sourceId,
      sourceKey: input.sourceKey,
      personId: verdict.personId,
      confidence: verdict.confidence,
      evidence: verdict.evidence,
      alternatives: verdict.alternatives,
      decidedBy: decidedByHuman ? 'HUMAN' : 'AUTO',
    },
  })

  if (verdict.autoMergeable && verdict.personId && input.attachExternalIdentifier) {
    await prisma.externalIdentifier.upsert({
      where: {
        sourceId_kind_value: {
          sourceId: input.sourceId,
          kind: input.attachExternalIdentifier.kind,
          value: input.attachExternalIdentifier.value,
        },
      },
      update: {},
      create: {
        ownerType: 'Person',
        ownerId: verdict.personId,
        sourceId: input.sourceId,
        kind: input.attachExternalIdentifier.kind,
        value: input.attachExternalIdentifier.value,
      },
    })
  }

  return verdict
}
