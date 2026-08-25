import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readScrutins } from '../src/adapters/an/scrutins-reader.js'

const ECLATES = fileURLToPath(new URL('../fixtures/an-scrutins-eclates-sample.zip', import.meta.url))
const MONOLITHE = fileURLToPath(
  new URL('../fixtures/an-scrutins-monolithe-sample.zip', import.meta.url),
)

async function collect(path: string) {
  const out: { entryName: string; uid: string }[] = []
  for await (const item of readScrutins(path)) {
    out.push({ entryName: item.entryName, uid: String(item.scrutin.uid) })
  }
  return out
}

describe('readScrutins', () => {
  it('lit une archive éclatée, un fichier par scrutin', async () => {
    const items = await collect(ECLATES)
    expect(items).toHaveLength(5)
    expect(items.every((i) => i.entryName.startsWith('json/'))).toBe(true)
    expect(items.map((i) => i.uid).sort()).toEqual([
      'VTANR5L15V2944',
      'VTANR5L16V2004',
      'VTANR5L17V2657',
      'VTANR5L17V6722',
      'VTCGR5L16V1',
    ])
  })

  it('lit une archive monolithique, tous les scrutins dans un seul fichier', async () => {
    const items = await collect(MONOLITHE)
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.uid)).toEqual(['VTANR5L14V1', 'VTANR5L14V2'])
    // Le nom d'entrée reste celui du fichier unique : c'est la référence bronze.
    expect(items.every((i) => i.entryName === 'Scrutins_XIV.json')).toBe(true)
  })

  it('expose le scrutin sans le nœud enveloppe', async () => {
    for await (const item of readScrutins(ECLATES)) {
      expect(item.scrutin).toHaveProperty('uid')
      expect(item.scrutin).toHaveProperty('syntheseVote')
      expect(item.scrutin).not.toHaveProperty('scrutin')
      return
    }
    throw new Error('aucun scrutin lu')
  })

  it('ferme l’archive même si le consommateur s’arrête en cours de route', async () => {
    let lus = 0
    for await (const _ of readScrutins(ECLATES)) {
      lus++
      if (lus === 2) break
    }
    expect(lus).toBe(2)

    // Une relecture complète juste après doit fonctionner : preuve que le
    // handle précédent a bien été libéré par le `finally` du générateur.
    const items = await collect(ECLATES)
    expect(items).toHaveLength(5)
  })
})
