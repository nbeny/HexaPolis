import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import type { SourceKey } from '../contract.js'

/** Un enregistrement source désigné par sa source et sa clé externe (ex. AN / `PA721234`). */
export interface IdentityRecordRef {
  source: SourceKey
  key: string
}

/** MERGE : même personne. SPLIT : personnes distinctes malgré l'algorithme. */
export type IdentityDecisionVerb = 'MERGE' | 'SPLIT'

/** Un arbitrage humain sur une paire d'enregistrements, prioritaire sur la cascade et jamais redemandé. */
export interface IdentityDecision {
  decision: IdentityDecisionVerb
  left: IdentityRecordRef
  right: IdentityRecordRef
  reason: string
  decidedOn: string
}

/** Erreur explicite nommant le fichier fautif : un import doit s'arrêter plutôt qu'ignorer un arbitrage. */
export class IdentityDecisionsFileError extends Error {}

const VERBS: readonly IdentityDecisionVerb[] = ['MERGE', 'SPLIT']

function isRecordRef(value: unknown): value is IdentityRecordRef {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.source === 'string' && typeof v.key === 'string'
}

function validateDecision(entry: unknown, index: number, path: string): IdentityDecision {
  if (typeof entry !== 'object' || entry === null) {
    throw new IdentityDecisionsFileError(`${path} : décision #${index} invalide (attendu un objet)`)
  }
  const e = entry as Record<string, unknown>

  if (!VERBS.includes(e.decision as IdentityDecisionVerb)) {
    throw new IdentityDecisionsFileError(
      `${path} : décision #${index} a un verbe inconnu "${String(e.decision)}" (attendu MERGE ou SPLIT)`,
    )
  }
  if (!isRecordRef(e.left) || !isRecordRef(e.right)) {
    throw new IdentityDecisionsFileError(
      `${path} : décision #${index} (${e.decision}) doit avoir "left" et "right", chacun avec "source" et "key"`,
    )
  }
  // Une décision sans raison est inutilisable des mois plus tard : ce fichier
  // existe précisément pour être relu bien après que le contexte se soit envolé.
  if (typeof e.reason !== 'string' || e.reason.trim() === '') {
    throw new IdentityDecisionsFileError(`${path} : décision #${index} (${e.decision}) sans "reason"`)
  }
  if (typeof e.decidedOn !== 'string' || e.decidedOn.trim() === '') {
    throw new IdentityDecisionsFileError(`${path} : décision #${index} (${e.decision}) sans "decidedOn"`)
  }

  return {
    decision: e.decision as IdentityDecisionVerb,
    left: e.left,
    right: e.right,
    reason: e.reason,
    decidedOn: e.decidedOn,
  }
}

/**
 * Lit et valide le fichier d'arbitrages d'identité versionné.
 *
 * Un fichier absent est un état normal — aucun arbitrage n'a encore été pris —
 * et renvoie une liste vide sans erreur. Un fichier présent mais invalide
 * (YAML malformé, décision incomplète, verbe inconnu) lève une erreur nommant
 * le fichier : un import qui s'arrête vaut mieux qu'un arbitrage ignoré en silence.
 */
export async function readDecisions(path: string): Promise<IdentityDecision[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  let doc: unknown
  try {
    doc = parse(raw)
  } catch (cause) {
    throw new IdentityDecisionsFileError(
      `${path} : YAML invalide (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    )
  }

  const decisions = (doc as { decisions?: unknown } | null)?.decisions
  if (!Array.isArray(decisions)) {
    throw new IdentityDecisionsFileError(`${path} : la clé "decisions" doit être une liste`)
  }

  return decisions.map((entry, index) => validateDecision(entry, index, path))
}
