import { describe, expect, it } from 'vitest'
import { ResultatsAdapter } from '../src/adapters/resultats/resultats.adapter.js'
import { SourceFileClient } from '../src/http/source-file-client.js'

// Ni base ni réseau : on ne vérifie que les descripteurs.
const prisma = null as never
const client = new SourceFileClient('.data/test-unused')

describe('ResultatsAdapter.discover', () => {
  it('déclare deux ressources, une par tour, sous la source DATA_GOUV', async () => {
    const descriptors = await new ResultatsAdapter(prisma, client).discover()
    expect(descriptors).toHaveLength(2)
    expect(descriptors.every((d) => d.sourceKey === 'DATA_GOUV')).toBe(true)
    expect(descriptors.map((d) => d.datasetExternalId)).toEqual([
      'legislatives-2024-t1',
      'legislatives-2024-t2',
    ])
  })

  it('les deux ressources ont des noms de fichier distincts (les fichiers réels ne portent pas le même nom)', async () => {
    const descriptors = await new ResultatsAdapter(prisma, client).discover()
    const ids = descriptors.map((d) => d.resourceExternalId)
    expect(new Set(ids).size).toBe(2)
    expect(ids).toContain('resultats-definitifs-par-circonscriptions-legislatives.csv')
    expect(ids).toContain('resultats-definitifs-par-circonscription.csv')
  })

  it('déclare le format csv pour les deux ressources', async () => {
    const descriptors = await new ResultatsAdapter(prisma, client).discover()
    expect(descriptors.every((d) => d.format === 'csv')).toBe(true)
  })

  it('pointe vers les URL data.gouv.fr mesurées dans le plan p5', async () => {
    const descriptors = await new ResultatsAdapter(prisma, client).discover()
    const [t1, t2] = descriptors
    expect(t1?.url).toContain('resultats-definitifs-du-1er-tour')
    expect(t2?.url).toContain('resultats-definitifs-du-2nd-tour')
  })
})
