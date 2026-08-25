import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDecisions } from '../src/identity/decisions-file.js'

describe('readDecisions', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'poligraph-decisions-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('renvoie une liste vide si le fichier n’existe pas, sans erreur', async () => {
    const decisions = await readDecisions(join(dir, 'absent.yaml'))
    expect(decisions).toEqual([])
  })

  it('lit une décision MERGE avec ses deux côtés, sa raison et sa date', async () => {
    const path = join(dir, 'decisions.yaml')
    await writeFile(
      path,
      `decisions:
  - decision: MERGE
    left:  { source: CNCCFP, key: "legislatives-2022:075-09:ROUSSEAU Sandrine" }
    right: { source: AN, key: "PA721234" }
    reason: "Même circonscription, même parti, unique candidate de ce nom"
    decidedOn: 2026-08-25
`,
      'utf-8',
    )

    const decisions = await readDecisions(path)

    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toEqual({
      decision: 'MERGE',
      left: { source: 'CNCCFP', key: 'legislatives-2022:075-09:ROUSSEAU Sandrine' },
      right: { source: 'AN', key: 'PA721234' },
      reason: 'Même circonscription, même parti, unique candidate de ce nom',
      decidedOn: '2026-08-25',
    })
  })

  it('lit une décision SPLIT', async () => {
    const path = join(dir, 'decisions.yaml')
    await writeFile(
      path,
      `decisions:
  - decision: SPLIT
    left:  { source: CNCCFP, key: "legislatives-2022:075-10:ROUSSEAU Sandrine" }
    right: { source: CNCCFP, key: "legislatives-2022:075-11:ROUSSEAU Sandrine" }
    reason: "Deux candidates homonymes distinctes dans la même élection"
    decidedOn: 2026-08-25
`,
      'utf-8',
    )

    const decisions = await readDecisions(path)

    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.decision).toBe('SPLIT')
    expect(decisions[0]?.left).toEqual({
      source: 'CNCCFP',
      key: 'legislatives-2022:075-10:ROUSSEAU Sandrine',
    })
    expect(decisions[0]?.right).toEqual({
      source: 'CNCCFP',
      key: 'legislatives-2022:075-11:ROUSSEAU Sandrine',
    })
  })

  it('lève une erreur explicite nommant le fichier si le YAML est malformé', async () => {
    const path = join(dir, 'decisions.yaml')
    await writeFile(
      path,
      `decisions:
  - decision: MERGE
    left: { source: CNCCFP, key: "x"
    reason: "accolade jamais fermée"
`,
      'utf-8',
    )

    await expect(readDecisions(path)).rejects.toThrow(path)
  })

  it('lève une erreur si une décision n’a pas de raison', async () => {
    const path = join(dir, 'decisions.yaml')
    await writeFile(
      path,
      `decisions:
  - decision: MERGE
    left: { source: CNCCFP, key: "a" }
    right: { source: AN, key: "b" }
    decidedOn: 2026-08-25
`,
      'utf-8',
    )

    await expect(readDecisions(path)).rejects.toThrow(/reason/i)
  })

  it('lève une erreur nommant le verbe inconnu', async () => {
    const path = join(dir, 'decisions.yaml')
    await writeFile(
      path,
      `decisions:
  - decision: FUSIONNER
    left: { source: CNCCFP, key: "a" }
    right: { source: AN, key: "b" }
    reason: "verbe invalide"
    decidedOn: 2026-08-25
`,
      'utf-8',
    )

    await expect(readDecisions(path)).rejects.toThrow(/FUSIONNER/)
  })
})
